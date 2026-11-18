import { describe, expect, it } from 'vitest';
import {
  canTransition,
  isEditableStatus,
  isTerminalStatus,
  nextStatus,
  transitionForTarget,
} from '@/lib/estimate-lifecycle';
import {
  applyLifecycleTransition,
  assertCanSoftDelete,
  assertDraftEditable,
  computeEstimateTotals,
} from '@/lib/estimate-service';

describe('estimate lifecycle', () => {
  it('allows draft → sent → accepted|rejected only', () => {
    expect(canTransition('draft', 'send')).toBe(true);
    expect(canTransition('draft', 'accept')).toBe(false);
    expect(canTransition('sent', 'accept')).toBe(true);
    expect(canTransition('sent', 'reject')).toBe(true);
    expect(canTransition('accepted', 'send')).toBe(false);
    expect(canTransition('rejected', 'accept')).toBe(false);

    expect(nextStatus('draft', 'send')).toBe('sent');
    expect(nextStatus('sent', 'accept')).toBe('accepted');
    expect(() => nextStatus('draft', 'accept')).toThrow(/Invalid transition/);
  });

  it('maps target status to transition action', () => {
    expect(transitionForTarget('draft', 'sent')).toBe('send');
    expect(transitionForTarget('sent', 'rejected')).toBe('reject');
    expect(transitionForTarget('sent', 'draft')).toBeNull();
  });

  it('marks accepted/rejected as terminal and only draft editable', () => {
    expect(isTerminalStatus('accepted')).toBe(true);
    expect(isTerminalStatus('sent')).toBe(false);
    expect(isEditableStatus('draft')).toBe(true);
    expect(isEditableStatus('sent')).toBe(false);
  });

  it('stamps sent_at / decided_at on transitions', () => {
    const sent = applyLifecycleTransition('draft', 'send');
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).toBeTruthy();

    const accepted = applyLifecycleTransition('sent', 'accept');
    expect(accepted.status).toBe('accepted');
    expect(accepted.decided_at).toBeTruthy();
  });

  it('only soft-deletes drafts', () => {
    expect(() => assertCanSoftDelete('draft', null)).not.toThrow();
    expect(() => assertCanSoftDelete('sent', null)).toThrow(/Only draft/);
    expect(() => assertDraftEditable('sent', null)).toThrow(/cannot be edited/);
  });
});

describe('estimate totals', () => {
  it('computes subtotal + tax in minor units', () => {
    const totals = computeEstimateTotals(
      [
        { description: 'Design', quantity: 10, unit_amount_minor: 15000 },
        { description: 'Dev', quantity: 20, unit_amount_minor: 12500 },
      ],
      5000,
    );

    expect(totals.subtotal_minor).toBe(10 * 15000 + 20 * 12500);
    expect(totals.tax_minor).toBe(5000);
    expect(totals.total_minor).toBe(totals.subtotal_minor + 5000);
    expect(totals.lines).toHaveLength(2);
  });

  it('requires at least one line item', () => {
    expect(() => computeEstimateTotals([])).toThrow(/At least one/);
  });
});
