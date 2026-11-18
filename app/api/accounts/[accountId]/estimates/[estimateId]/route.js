const { NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const {
  updateEstimateDraftSchema,
  transitionEstimateSchema,
  validateRequestBody,
} = require('@/lib/validation-schemas');
const {
  computeEstimateTotals,
  assertProjectBelongsToAccount,
  applyLifecycleTransition,
  assertDraftEditable,
  assertCanSoftDelete,
} = require('@/lib/estimate-service');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

const ESTIMATE_DETAIL_SELECT = `
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

async function loadEstimate(admin, accountId, estimateId) {
  const { data, error } = await admin
    .from('estimates')
    .select(ESTIMATE_DETAIL_SELECT)
    .eq('id', estimateId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) return null;

  return {
    ...data,
    estimate_line_items: (data.estimate_line_items || []).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    ),
  };
}

/**
 * GET /api/accounts/[accountId]/estimates/[estimateId]
 */
async function GET(request, { params }) {
  try {
    const { accountId, estimateId } = await params;
    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.VIEW_ESTIMATES, { accountId }, request);

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const estimate = await loadEstimate(admin, accountId, estimateId);
    if (!estimate || estimate.removed_at) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    return NextResponse.json({ estimate });
  } catch (error) {
    logger.error('Error in GET estimate by id', {}, error);
    return handleGuardError(error);
  }
}

/**
 * PATCH /api/accounts/[accountId]/estimates/[estimateId]
 *
 * Body shapes:
 *   { action: 'send' | 'accept' | 'reject' }  — lifecycle transition
 *   { title, line_items, ... }                — draft edit (status must be draft)
 */
async function PATCH(request, { params }) {
  try {
    const { accountId, estimateId } = await params;
    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.MANAGE_ESTIMATES, { accountId }, request);

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const existing = await loadEstimate(admin, accountId, estimateId);
    if (!existing || existing.removed_at) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    // Lifecycle transition path
    if (body && typeof body.action === 'string') {
      const transitionValidation = validateRequestBody(transitionEstimateSchema, body);
      if (!transitionValidation.success) {
        return NextResponse.json({ error: transitionValidation.error }, { status: 400 });
      }

      let patch;
      try {
        patch = applyLifecycleTransition(existing.status, transitionValidation.data.action);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Invalid transition' },
          { status: 409 },
        );
      }

      const { error: updateError } = await admin
        .from('estimates')
        .update(patch)
        .eq('id', estimateId)
        .eq('account_id', accountId)
        .is('removed_at', null);

      if (updateError) {
        logger.error('Failed to transition estimate', { estimateId }, updateError);
        return NextResponse.json({ error: 'Failed to update estimate' }, { status: 500 });
      }

      const updated = await loadEstimate(admin, accountId, estimateId);
      return NextResponse.json({ estimate: updated });
    }

    // Draft edit path
    const draftValidation = validateRequestBody(updateEstimateDraftSchema, body);
    if (!draftValidation.success) {
      return NextResponse.json({ error: draftValidation.error }, { status: 400 });
    }

    try {
      assertDraftEditable(existing.status, existing.removed_at);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Estimate not editable' },
        { status: 409 },
      );
    }

    const input = draftValidation.data;
    const updates = {};

    if (input.title !== undefined) updates.title = input.title;
    if (input.currency !== undefined) updates.currency = input.currency;
    if (input.notes !== undefined) updates.notes = input.notes;
    if (input.valid_until !== undefined) updates.valid_until = input.valid_until;
    if (input.tax_minor !== undefined) updates.tax_minor = input.tax_minor;

    if (Object.prototype.hasOwnProperty.call(input, 'project_id')) {
      if (input.project_id) {
        const { data: project, error: projectError } = await admin
          .from('projects')
          .select('id, account_id')
          .eq('id', input.project_id)
          .maybeSingle();

        if (projectError) {
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
        updates.project_id = input.project_id;
      } else {
        updates.project_id = null;
      }
    }

    if (input.line_items) {
      let totals;
      try {
        totals = computeEstimateTotals(
          input.line_items,
          input.tax_minor !== undefined ? input.tax_minor : existing.tax_minor,
        );
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Invalid line items' },
          { status: 400 },
        );
      }

      updates.subtotal_minor = totals.subtotal_minor;
      updates.tax_minor = totals.tax_minor;
      updates.total_minor = totals.total_minor;

      const { error: deleteLinesError } = await admin
        .from('estimate_line_items')
        .delete()
        .eq('estimate_id', estimateId);

      if (deleteLinesError) {
        logger.error('Failed to replace line items', { estimateId }, deleteLinesError);
        return NextResponse.json({ error: 'Failed to update line items' }, { status: 500 });
      }

      const { error: insertLinesError } = await admin.from('estimate_line_items').insert(
        totals.lines.map((line) => ({
          estimate_id: estimateId,
          description: line.description,
          quantity: line.quantity,
          unit_amount_minor: line.unit_amount_minor,
          amount_minor: line.amount_minor,
          sort_order: line.sort_order,
        })),
      );

      if (insertLinesError) {
        logger.error('Failed to insert replacement lines', { estimateId }, insertLinesError);
        return NextResponse.json({ error: 'Failed to update line items' }, { status: 500 });
      }
    } else if (input.tax_minor !== undefined) {
      updates.total_minor = existing.subtotal_minor + input.tax_minor;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await admin
        .from('estimates')
        .update(updates)
        .eq('id', estimateId)
        .eq('account_id', accountId)
        .eq('status', 'draft')
        .is('removed_at', null);

      if (updateError) {
        logger.error('Failed to update draft estimate', { estimateId }, updateError);
        return NextResponse.json({ error: 'Failed to update estimate' }, { status: 500 });
      }
    }

    const updated = await loadEstimate(admin, accountId, estimateId);
    return NextResponse.json({ estimate: updated });
  } catch (error) {
    logger.error('Error in PATCH estimate', {}, error);
    return handleGuardError(error);
  }
}

/**
 * DELETE /api/accounts/[accountId]/estimates/[estimateId]
 * Soft-delete only (draft estimates).
 */
async function DELETE(request, { params }) {
  try {
    const { accountId, estimateId } = await params;
    if (!isValidUUID(accountId) || !isValidUUID(estimateId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.MANAGE_ESTIMATES, { accountId }, request);

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const existing = await loadEstimate(admin, accountId, estimateId);
    if (!existing || existing.removed_at) {
      return NextResponse.json({ error: 'Estimate not found' }, { status: 404 });
    }

    try {
      assertCanSoftDelete(existing.status, existing.removed_at);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Cannot remove estimate' },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from('estimates')
      .update({ removed_at: new Date().toISOString() })
      .eq('id', estimateId)
      .eq('account_id', accountId)
      .eq('status', 'draft')
      .is('removed_at', null);

    if (error) {
      logger.error('Failed to soft-delete estimate', { estimateId }, error);
      return NextResponse.json({ error: 'Failed to remove estimate' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error in DELETE estimate', {}, error);
    return handleGuardError(error);
  }
}

exports.GET = GET;
exports.PATCH = PATCH;
exports.DELETE = DELETE;
