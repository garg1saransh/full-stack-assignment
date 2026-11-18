'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlusIcon, FileText, Send, Check, X, Trash2, Pencil, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api-config';
import { formatMinorUnits, lineAmountMinor, parseMajorToMinor, sumMinor } from '@/lib/money';
import { UserWithRoles, hasPermission } from '@/lib/rbac';
import { Permission } from '@/lib/permissions';

type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'rejected';

interface EstimateLineItem {
  id?: string;
  description: string;
  quantity: number;
  unit_amount_minor: number;
  amount_minor: number;
  sort_order?: number;
}

interface Estimate {
  id: string;
  account_id: string;
  project_id: string | null;
  title: string;
  status: EstimateStatus;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  notes: string | null;
  valid_until: string | null;
  created_at: string;
  sent_at: string | null;
  decided_at: string | null;
  estimate_line_items: EstimateLineItem[];
}

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitMajor: string;
}

interface AccountEstimatesProps {
  accountId: string;
  projects: Array<{ id: string; name: string }>;
  userProfile: UserWithRoles;
}

const STATUS_VARIANT: Record<
  EstimateStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'secondary',
  sent: 'outline',
  accepted: 'default',
  rejected: 'destructive',
};

function newLineDraft(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: '',
    quantity: '1',
    unitMajor: '',
  };
}

function statusLabel(status: EstimateStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function AccountEstimates({ accountId, projects, userProfile }: AccountEstimatesProps) {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Create / edit draft form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState<string>('none');
  const [notes, setNotes] = useState('');
  const [taxMajor, setTaxMajor] = useState('0');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLineDraft()]);

  const [canView, setCanView] = useState(false);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [view, manage] = await Promise.all([
        hasPermission(userProfile, Permission.VIEW_ESTIMATES, { accountId }),
        hasPermission(userProfile, Permission.MANAGE_ESTIMATES, { accountId }),
      ]);
      if (!cancelled) {
        setCanView(view);
        setCanManage(manage);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userProfile, accountId]);

  const loadEstimates = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const qs = params.toString();
      const res = await apiFetch(
        `/api/accounts/${accountId}/estimates${qs ? `?${qs}` : ''}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load estimates');
      }
      const data = await res.json();
      setEstimates(data.estimates || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load estimates');
    } finally {
      setLoading(false);
    }
  }, [accountId, canView, statusFilter]);

  useEffect(() => {
    loadEstimates();
  }, [loadEstimates]);

  const computedPreview = useMemo(() => {
    try {
      const amounts = lines.map((line) => {
        const qty = Number(line.quantity);
        const unit = parseMajorToMinor(line.unitMajor || '0');
        return lineAmountMinor(qty > 0 ? qty : 1, unit);
      });
      const subtotal = sumMinor(amounts);
      const tax = parseMajorToMinor(taxMajor || '0');
      return { subtotal, tax, total: sumMinor([subtotal, tax]), ok: true as const };
    } catch {
      return { subtotal: 0, tax: 0, total: 0, ok: false as const };
    }
  }, [lines, taxMajor]);

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setProjectId('none');
    setNotes('');
    setTaxMajor('0');
    setValidUntil('');
    setLines([newLineDraft()]);
  };

  const openCreate = () => {
    resetForm();
    setEditorOpen(true);
  };

  const openEdit = (estimate: Estimate) => {
    setEditingId(estimate.id);
    setTitle(estimate.title);
    setProjectId(estimate.project_id || 'none');
    setNotes(estimate.notes || '');
    setTaxMajor((estimate.tax_minor / 100).toFixed(2));
    setValidUntil(estimate.valid_until || '');
    setLines(
      (estimate.estimate_line_items || []).map((li, i) => ({
        key: li.id || `line-${i}`,
        description: li.description,
        quantity: String(li.quantity),
        unitMajor: (li.unit_amount_minor / 100).toFixed(2),
      })),
    );
    setEditorOpen(true);
  };

  const openDetail = (estimate: Estimate) => {
    setSelected(estimate);
    setDetailOpen(true);
  };

  const buildPayload = () => {
    const line_items = lines.map((line, index) => {
      const quantity = Number(line.quantity);
      if (!line.description.trim()) {
        throw new Error(`Line ${index + 1}: description is required`);
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Line ${index + 1}: quantity must be positive`);
      }
      return {
        description: line.description.trim(),
        quantity,
        unit_amount_minor: parseMajorToMinor(line.unitMajor || '0'),
        sort_order: index,
      };
    });

    return {
      title: title.trim(),
      project_id: projectId === 'none' ? null : projectId,
      notes: notes.trim() || null,
      tax_minor: parseMajorToMinor(taxMajor || '0'),
      valid_until: validUntil || null,
      line_items,
      currency: 'USD',
    };
  };

  const handleSaveDraft = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (editingId) {
        const res = await apiFetch(`/api/accounts/${accountId}/estimates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to update estimate');
        toast.success('Draft updated');
      } else {
        const idempotencyKey =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `est-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const res = await apiFetch(`/api/accounts/${accountId}/estimates`, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to create estimate');
        toast.success(data.idempotent ? 'Estimate already created (idempotent)' : 'Draft created');
      }
      setEditorOpen(false);
      resetForm();
      await loadEstimates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runTransition = async (estimateId: string, action: 'send' | 'accept' | 'reject') => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/estimates/${estimateId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${action} estimate`);
      toast.success(`Estimate ${action === 'send' ? 'sent' : action + 'ed'}`);
      setSelected(data.estimate);
      await loadEstimates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const removeDraft = async (estimateId: string) => {
    if (!confirm('Remove this draft estimate? This is a soft delete.')) return;
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/accounts/${accountId}/estimates/${estimateId}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove estimate');
      toast.success('Draft removed');
      setDetailOpen(false);
      setSelected(null);
      await loadEstimates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setActionLoading(false);
    }
  };

  if (!canView) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <FileText className="h-5 w-5" />
                Estimates
              </CardTitle>
              <CardDescription className="mt-1">
                Account-scoped quotes in minor units — draft → sent → accepted / rejected
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={loadEstimates} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              {canManage && (
                <Button size="sm" className="flex items-center gap-2" onClick={openCreate}>
                  <PlusIcon className="h-4 w-4" />
                  New draft
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading estimates…</p>
          ) : estimates.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <p className="text-muted-foreground text-sm">No estimates for this account yet.</p>
              {canManage && (
                <Button variant="outline" size="sm" className="mt-4" onClick={openCreate}>
                  Create first draft
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="hidden sm:table-cell">Created</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimates.map((est) => (
                    <TableRow key={est.id} className="cursor-pointer" onClick={() => openDetail(est)}>
                      <TableCell className="font-medium">{est.title}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[est.status]}>{statusLabel(est.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMinorUnits(est.total_minor, est.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {new Date(est.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {canManage && est.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Edit draft"
                              onClick={() => openEdit(est)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDetail(est)}
                          >
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit draft */}
      <Dialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit draft estimate' : 'New draft estimate'}</DialogTitle>
            <DialogDescription>
              Amounts are entered in major units and stored as integer cents on the server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="est-title">Title</Label>
              <Input
                id="est-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Website redesign — Phase 1"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Project (optional)</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Link a project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="est-valid">Valid until</Label>
                <Input
                  id="est-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, newLineDraft()])}
                >
                  <PlusIcon className="mr-1 h-3 w-3" />
                  Add line
                </Button>
              </div>
              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_80px_110px_40px]"
                >
                  <Input
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, description: e.target.value } : l,
                        ),
                      )
                    }
                  />
                  <Input
                    type="number"
                    min="0.0001"
                    step="any"
                    placeholder="Qty"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                      )
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit $"
                    value={line.unitMajor}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) => (i === index ? { ...l, unitMajor: e.target.value } : l)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="est-tax">Tax (USD)</Label>
                <Input
                  id="est-tax"
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxMajor}
                  onChange={(e) => setTaxMajor(e.target.value)}
                />
              </div>
              <div className="bg-muted/40 flex flex-col justify-center rounded-md p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">
                    {computedPreview.ok
                      ? formatMinorUnits(computedPreview.subtotal)
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {computedPreview.ok ? formatMinorUnits(computedPreview.total) : '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="est-notes">Notes</Label>
              <Textarea
                id="est-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Payment terms, assumptions…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveDraft} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail + lifecycle */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {selected.title}
                  <Badge variant={STATUS_VARIANT[selected.status]}>
                    {statusLabel(selected.status)}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  {formatMinorUnits(selected.total_minor, selected.currency)} · created{' '}
                  {new Date(selected.created_at).toLocaleString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selected.estimate_line_items || []).map((li, i) => (
                      <TableRow key={li.id || i}>
                        <TableCell>{li.description}</TableCell>
                        <TableCell className="text-right tabular-nums">{li.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMinorUnits(li.unit_amount_minor, selected.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMinorUnits(li.amount_minor, selected.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">
                      {formatMinorUnits(selected.subtotal_minor, selected.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tax</span>
                    <span className="tabular-nums">
                      {formatMinorUnits(selected.tax_minor, selected.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">
                      {formatMinorUnits(selected.total_minor, selected.currency)}
                    </span>
                  </div>
                </div>

                {selected.notes && (
                  <p className="text-muted-foreground text-sm whitespace-pre-wrap">{selected.notes}</p>
                )}
              </div>

              {canManage && (
                <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {selected.status === 'draft' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => openEdit(selected)}
                        >
                          <Pencil className="mr-1 h-4 w-4" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => removeDraft(selected.id)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.status === 'draft' && (
                      <Button
                        size="sm"
                        disabled={actionLoading}
                        onClick={() => runTransition(selected.id, 'send')}
                      >
                        <Send className="mr-1 h-4 w-4" />
                        Send
                      </Button>
                    )}
                    {selected.status === 'sent' && (
                      <>
                        <Button
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => runTransition(selected.id, 'accept')}
                        >
                          <Check className="mr-1 h-4 w-4" />
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => runTransition(selected.id, 'reject')}
                        >
                          <X className="mr-1 h-4 w-4" />
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
