const { NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const {
  createEstimateSchema,
  listEstimatesQuerySchema,
  validateRequestBody,
  validateQueryParams,
} = require('@/lib/validation-schemas');
const { computeEstimateTotals, assertProjectBelongsToAccount } = require('@/lib/estimate-service');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

const ESTIMATE_LIST_SELECT = `
  id,
  account_id,
  project_id,
  title,
  status,
  currency,
  subtotal_minor,
  tax_minor,
  total_minor,
  notes,
  valid_until,
  created_by,
  sent_at,
  decided_at,
  idempotency_key,
  removed_at,
  created_at,
  updated_at,
  estimate_line_items (
    id,
    description,
    quantity,
    unit_amount_minor,
    amount_minor,
    sort_order
  )
`;

/**
 * GET /api/accounts/[accountId]/estimates
 * List estimates for an account (server-side filter by status / project).
 */
async function GET(request, { params }) {
  try {
    const { accountId } = await params;
    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const url = new URL(request.url);
    const queryValidation = validateQueryParams(listEstimatesQuerySchema, {
      status: url.searchParams.get('status') || undefined,
      projectId: url.searchParams.get('projectId') || undefined,
      includeRemoved: url.searchParams.get('includeRemoved') || undefined,
    });
    if (!queryValidation.success) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    let query = admin
      .from('estimates')
      .select(ESTIMATE_LIST_SELECT)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (!queryValidation.data.includeRemoved) {
      query = query.is('removed_at', null);
    }
    if (queryValidation.data.status) {
      query = query.eq('status', queryValidation.data.status);
    }
    if (queryValidation.data.projectId) {
      query = query.eq('project_id', queryValidation.data.projectId);
    }

    const { data, error } = await query;
    if (error) {
      logger.error('Failed to list estimates', { accountId }, error);
      return NextResponse.json({ error: 'Failed to list estimates' }, { status: 500 });
    }

    const estimates = (data || []).map((row) => ({
      ...row,
      estimate_line_items: (row.estimate_line_items || []).sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    }));

    return NextResponse.json({ estimates });
  } catch (error) {
    logger.error('Error in GET /api/accounts/[accountId]/estimates', {}, error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/accounts/[accountId]/estimates
 * Create a draft estimate. Requires Idempotency-Key header.
 */
async function POST(request, { params }) {
  try {
    const { accountId } = await params;
    if (!isValidUUID(accountId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    const user = await requireAuthAndPermission(
      Permission.MANAGE_ESTIMATES,
      { accountId },
      request,
    );

    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required for estimate creation' },
        { status: 400 },
      );
    }
    if (idempotencyKey.length > 128) {
      return NextResponse.json({ error: 'Idempotency-Key too long' }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const validation = validateRequestBody(createEstimateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    // Replay: same key + account → same estimate (no duplicate money documents)
    const { data: existing, error: existingError } = await admin
      .from('estimates')
      .select(ESTIMATE_LIST_SELECT)
      .eq('account_id', accountId)
      .eq('idempotency_key', idempotencyKey)
      .is('removed_at', null)
      .maybeSingle();

    if (existingError) {
      logger.error('Idempotency lookup failed', { accountId }, existingError);
      return NextResponse.json({ error: 'Failed to create estimate' }, { status: 500 });
    }

    if (existing) {
      return NextResponse.json(
        {
          estimate: {
            ...existing,
            estimate_line_items: (existing.estimate_line_items || []).sort(
              (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
            ),
          },
          idempotent: true,
        },
        { status: 200 },
      );
    }

    const input = validation.data;
    if (input.project_id) {
      const { data: project, error: projectError } = await admin
        .from('projects')
        .select('id, account_id')
        .eq('id', input.project_id)
        .maybeSingle();

      if (projectError) {
        logger.error('Project lookup failed', { accountId }, projectError);
        return NextResponse.json({ error: 'Failed to validate project' }, { status: 500 });
      }

      try {
        assertProjectBelongsToAccount(project, accountId);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Invalid project' },
          { status: 400 },
        );
      }
    }

    let totals;
    try {
      totals = computeEstimateTotals(input.line_items, input.tax_minor ?? 0);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid line items' },
        { status: 400 },
      );
    }

    const { data: estimate, error: insertError } = await admin
      .from('estimates')
      .insert({
        account_id: accountId,
        project_id: input.project_id || null,
        title: input.title,
        status: 'draft',
        currency: input.currency || 'USD',
        subtotal_minor: totals.subtotal_minor,
        tax_minor: totals.tax_minor,
        total_minor: totals.total_minor,
        notes: input.notes ?? null,
        valid_until: input.valid_until ?? null,
        created_by: user.id,
        idempotency_key: idempotencyKey,
      })
      .select('*')
      .single();

    if (insertError) {
      // Race on unique idempotency index — treat as replay
      if (insertError.code === '23505') {
        const { data: raced } = await admin
          .from('estimates')
          .select(ESTIMATE_LIST_SELECT)
          .eq('account_id', accountId)
          .eq('idempotency_key', idempotencyKey)
          .is('removed_at', null)
          .maybeSingle();

        if (raced) {
          return NextResponse.json(
            {
              estimate: {
                ...raced,
                estimate_line_items: (raced.estimate_line_items || []).sort(
                  (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
                ),
              },
              idempotent: true,
            },
            { status: 200 },
          );
        }
      }

      logger.error('Failed to insert estimate', { accountId }, insertError);
      return NextResponse.json({ error: 'Failed to create estimate' }, { status: 500 });
    }

    const lineRows = totals.lines.map((line) => ({
      estimate_id: estimate.id,
      description: line.description,
      quantity: line.quantity,
      unit_amount_minor: line.unit_amount_minor,
      amount_minor: line.amount_minor,
      sort_order: line.sort_order,
    }));

    const { data: lines, error: linesError } = await admin
      .from('estimate_line_items')
      .insert(lineRows)
      .select('*')
      .order('sort_order', { ascending: true });

    if (linesError) {
      // Compensate: soft-delete orphan header so we never leave unpaid totals without lines
      await admin
        .from('estimates')
        .update({ removed_at: new Date().toISOString() })
        .eq('id', estimate.id)
        .eq('account_id', accountId);
      logger.error('Failed to insert estimate lines', { estimateId: estimate.id }, linesError);
      return NextResponse.json({ error: 'Failed to create estimate line items' }, { status: 500 });
    }

    return NextResponse.json(
      {
        estimate: {
          ...estimate,
          estimate_line_items: lines || [],
        },
        idempotent: false,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('Error in POST /api/accounts/[accountId]/estimates', {}, error);
    return handleGuardError(error);
  }
}

exports.GET = GET;
exports.POST = POST;
