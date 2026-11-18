const { NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

/**
 * POST /api/projects/[projectId]/escrow/approve
 * Client approves the next milestone.
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

    const admin = createAdminSupabaseClient();
    if (!admin) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 500 });
    }

    const { data: escrow, error } = await admin
      .from('escrows')
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error('Escrow approve lookup failed', { projectId }, error);
      return NextResponse.json({ error: 'Failed to load escrow' }, { status: 500 });
    }
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }
    if (escrow.client_id !== user.id) {
      return NextResponse.json({ error: 'Only the escrow client can approve' }, { status: 403 });
    }
    if (escrow.milestones_approved >= escrow.total_milestones) {
      return NextResponse.json({ error: 'All milestones already approved' }, { status: 409 });
    }

    const nextApproved = escrow.milestones_approved + 1;
    const patch = {
      milestones_approved: nextApproved,
      status: nextApproved >= escrow.total_milestones && escrow.milestones_claimed >= nextApproved
        ? 'completed'
        : 'active',
    };

    const { data: updated, error: updateError } = await admin
      .from('escrows')
      .update(patch)
      .eq('id', escrow.id)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Escrow approve failed', { projectId }, updateError);
      return NextResponse.json({ error: 'Failed to approve milestone' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    logger.error('Error in POST escrow/approve', {}, error);
    return handleGuardError(error);
  }
}

exports.POST = POST;
