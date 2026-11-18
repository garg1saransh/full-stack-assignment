const { NextResponse } = require('next/server');
const {
  createAdminSupabaseClient,
  createApiSupabaseClient,
  getUserProfileFromRequest,
} = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

/**
 * GET /api/projects/[projectId]/escrow
 * Returns the active escrow for a project (Supabase-backed).
 */
async function GET(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    await requireAuthAndPermission(Permission.VIEW_PROJECTS, { projectId }, request);

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const { data, error } = await admin
      .from('escrows')
      .select('*')
      .eq('project_id', projectId)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Failed to fetch escrow', { projectId }, error);
      return NextResponse.json({ error: 'Failed to fetch escrow' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    logger.error('Error in GET /api/projects/[projectId]/escrow', {}, error);
    return handleGuardError(error);
  }
}

/**
 * POST /api/projects/[projectId]/escrow
 * Body: { totalMilestones, amountPerMilestone (cents), contractorId }
 */
async function POST(request, { params }) {
  try {
    const { projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const user = await requireAuthAndPermission(
      Permission.MANAGE_PROJECTS,
      { projectId },
      request,
    );

    const supabase = createApiSupabaseClient(request);
    const profile =
      (await getUserProfileFromRequest(supabase)) ||
      user;

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const totalMilestones = Number(body.totalMilestones);
    const amountPerMilestone = Number(body.amountPerMilestone);
    const contractorId = body.contractorId;

    if (
      !Number.isInteger(totalMilestones) ||
      totalMilestones <= 0 ||
      !Number.isInteger(amountPerMilestone) ||
      amountPerMilestone <= 0 ||
      !isValidUUID(contractorId)
    ) {
      return NextResponse.json(
        {
          error:
            'totalMilestones (>0 int), amountPerMilestone (>0 cents int), and contractorId (uuid) are required',
        },
        { status: 400 },
      );
    }

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const { data: existing } = await admin
      .from('escrows')
      .select('id')
      .eq('project_id', projectId)
      .in('status', ['pending', 'active'])
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'An active escrow already exists for this project' },
        { status: 409 },
      );
    }

    const { data, error } = await admin
      .from('escrows')
      .insert({
        project_id: projectId,
        client_id: profile.id,
        contractor_id: contractorId,
        total_milestones: totalMilestones,
        milestones_approved: 0,
        milestones_claimed: 0,
        amount_per_milestone: amountPerMilestone,
        status: 'active',
      })
      .select('*')
      .single();

    if (error) {
      logger.error('Failed to create escrow', { projectId }, error);
      return NextResponse.json({ error: 'Failed to create escrow' }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    logger.error('Error in POST /api/projects/[projectId]/escrow', {}, error);
    return handleGuardError(error);
  }
}

exports.GET = GET;
exports.POST = POST;
