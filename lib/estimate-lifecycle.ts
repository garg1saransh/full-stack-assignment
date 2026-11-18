/**
 * Estimate lifecycle — pure state machine for financial documents.
 *
 * draft → sent → accepted | rejected
 *
 * Accepted/rejected are terminal. Soft-delete (removed_at) is separate and
 * only allowed while draft (enforced in service layer).
 */

export const ESTIMATE_STATUSES = ['draft', 'sent', 'accepted', 'rejected'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export type EstimateTransition = 'send' | 'accept' | 'reject';

const ALLOWED: Record<EstimateStatus, Partial<Record<EstimateTransition, EstimateStatus>>> = {
  draft: { send: 'sent' },
  sent: { accept: 'accepted', reject: 'rejected' },
  accepted: {},
  rejected: {},
};

export function isEstimateStatus(value: unknown): value is EstimateStatus {
  return typeof value === 'string' && (ESTIMATE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: EstimateStatus, action: EstimateTransition): boolean {
  return Boolean(ALLOWED[from]?.[action]);
}

export function nextStatus(from: EstimateStatus, action: EstimateTransition): EstimateStatus {
  const next = ALLOWED[from]?.[action];
  if (!next) {
    throw new Error(`Invalid transition: cannot ${action} estimate in status "${from}"`);
  }
  return next;
}

/** Map a requested status write to a transition action (if any). */
export function transitionForTarget(
  from: EstimateStatus,
  to: EstimateStatus,
): EstimateTransition | null {
  if (from === to) return null;
  for (const [action, target] of Object.entries(ALLOWED[from] || {}) as [
    EstimateTransition,
    EstimateStatus,
  ][]) {
    if (target === to) return action;
  }
  return null;
}

export function isTerminalStatus(status: EstimateStatus): boolean {
  return status === 'accepted' || status === 'rejected';
}

export function isEditableStatus(status: EstimateStatus): boolean {
  return status === 'draft';
}
