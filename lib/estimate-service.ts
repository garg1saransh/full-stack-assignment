/**
 * Estimate domain service — totals, tenancy checks, and persistence helpers.
 * Callers must enforce RBAC before invoking write methods.
 */

import { lineAmountMinor, sumMinor } from './money';
import {
  EstimateStatus,
  EstimateTransition,
  isEditableStatus,
  nextStatus,
} from './estimate-lifecycle';

export interface EstimateLineInput {
  description: string;
  quantity: number;
  unit_amount_minor: number;
  sort_order?: number;
}

export interface ComputedLineItem extends EstimateLineInput {
  amount_minor: number;
  sort_order: number;
}

export interface EstimateTotals {
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  lines: ComputedLineItem[];
}

export function computeEstimateTotals(
  lines: EstimateLineInput[],
  taxMinor: number = 0,
): EstimateTotals {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('At least one line item is required');
  }
  if (!Number.isInteger(taxMinor) || taxMinor < 0) {
    throw new Error('tax_minor must be a non-negative integer');
  }

  const computed: ComputedLineItem[] = lines.map((line, index) => {
    const description = String(line.description || '').trim();
    if (!description) {
      throw new Error(`Line ${index + 1}: description is required`);
    }
    const amount_minor = lineAmountMinor(line.quantity, line.unit_amount_minor);
    return {
      description,
      quantity: line.quantity,
      unit_amount_minor: line.unit_amount_minor,
      amount_minor,
      sort_order: line.sort_order ?? index,
    };
  });

  const subtotal_minor = sumMinor(computed.map((l) => l.amount_minor));
  const total_minor = sumMinor([subtotal_minor, taxMinor]);

  return {
    subtotal_minor,
    tax_minor: taxMinor,
    total_minor,
    lines: computed,
  };
}

export function assertProjectBelongsToAccount(
  project: { account_id: string } | null,
  accountId: string,
): void {
  if (!project) {
    throw new Error('Project not found');
  }
  if (project.account_id !== accountId) {
    throw new Error('Project does not belong to this account');
  }
}

export function applyLifecycleTransition(
  current: EstimateStatus,
  action: EstimateTransition,
): { status: EstimateStatus; sent_at?: string; decided_at?: string } {
  const status = nextStatus(current, action);
  const now = new Date().toISOString();
  if (action === 'send') {
    return { status, sent_at: now };
  }
  if (action === 'accept' || action === 'reject') {
    return { status, decided_at: now };
  }
  return { status };
}

export function assertDraftEditable(status: EstimateStatus, removedAt: string | null): void {
  if (removedAt) {
    throw new Error('Estimate has been removed');
  }
  if (!isEditableStatus(status)) {
    throw new Error(`Estimate in status "${status}" cannot be edited`);
  }
}

export function assertCanSoftDelete(status: EstimateStatus, removedAt: string | null): void {
  if (removedAt) {
    throw new Error('Estimate already removed');
  }
  if (status !== 'draft') {
    throw new Error('Only draft estimates can be removed');
  }
}
