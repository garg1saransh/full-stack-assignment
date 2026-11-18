const { NextResponse } = require('next/server');
const { createAdminSupabaseClient } = require('@/lib/supabase-server');
const { requireAuthAndPermission, handleGuardError } = require('@/lib/server-guards');
const { Permission } = require('@/lib/permissions');
const { logger } = require('@/lib/debug-logger');
const { isValidUUID } = require('@/lib/validation-helpers');

/**
 * POST /api/projects/[projectId]/escrow/claim
 * Contractor claims the next approved milestone.
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
      logger.error('Escrow claim lookup failed', { projectId }, error);
      return NextResponse.json({ error: 'Failed to load escrow' }, { status: 500 });
    }
    if (!escrow) {
      return NextResponse.json({ error: 'Escrow not found' }, { status: 404 });
    }
    if (escrow.contractor_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the escrow contractor can claim' },
        { status: 403 },
      );
    }
    if (escrow.milestones_claimed >= escrow.milestones_approved) {
      return NextResponse.json(
        { error: 'No approved milestones available to claim' },
        { status: 409 },
      );
    }

    const nextClaimed = escrow.milestones_claimed + 1;
    const patch = {
      milestones_claimed: nextClaimed,
      status:
        nextClaimed >= escrow.total_milestones &&
        escrow.milestones_approved >= escrow.total_milestones
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
      logger.error('Escrow claim failed', { projectId }, updateError);
      return NextResponse.json({ error: 'Failed to claim milestone' }, { status: 500 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    logger.error('Error in POST escrow/claim', {}, error);
    return handleGuardError(error);
  }
}

exports.POST = POST;
