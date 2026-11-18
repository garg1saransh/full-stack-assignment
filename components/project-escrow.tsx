'use client';

/**
 * ProjectEscrow — milestone escrow UI for a Kontrora project.
 * Backed by Supabase `escrows` via /api/projects/[projectId]/escrow*.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-config';
import { formatMinorUnits } from '@/lib/money';
import { toast } from 'sonner';

interface EscrowState {
  id: string;
  project_id: string;
  client_id: string;
  contractor_id: string;
  total_milestones: number;
  milestones_approved: number;
  milestones_claimed: number;
  amount_per_milestone: number;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
}

interface ProjectEscrowProps {
  projectId: string;
  currentUserId: string;
  contractorId: string;
}

export function ProjectEscrow({ projectId, currentUserId, contractorId }: ProjectEscrowProps) {
  const [escrow, setEscrow] = useState<EscrowState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalMilestones, setTotalMilestones] = useState('3');
  const [amountPerMilestone, setAmountPerMilestone] = useState('50000');

  const fetchEscrow = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/escrow`);
      if (res.status === 404) {
        setEscrow(null);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to fetch escrow: ${res.statusText}`);
      }
      setEscrow(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [projectId]);

  useEffect(() => {
    fetchEscrow();
  }, [fetchEscrow]);

  const handleCreateEscrow = async () => {
    const milestones = Number.parseInt(totalMilestones, 10);
    const amount = Number.parseInt(amountPerMilestone, 10);
    if (!Number.isInteger(milestones) || milestones <= 0) {
      toast.error('Total milestones must be a positive integer');
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error('Amount per milestone must be positive cents');
      return;
    }
    if (!contractorId) {
      toast.error('Contractor is required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/escrow`, {
        method: 'POST',
        body: JSON.stringify({
          totalMilestones: milestones,
          amountPerMilestone: amount,
          contractorId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create escrow');
      setEscrow(data);
      toast.success('Escrow created');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Create failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveMilestone = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/escrow/approve`, {
        method: 'POST',
        body: JSON.stringify({ callerId: currentUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to approve milestone');
      setEscrow(data);
      toast.success('Milestone approved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approve failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimMilestone = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/escrow/claim`, {
        method: 'POST',
        body: JSON.stringify({ callerId: currentUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to claim milestone');
      setEscrow(data);
      toast.success('Milestone claimed');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Claim failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const isClient = escrow?.client_id === currentUserId;
  const isContractor = escrow?.contractor_id === currentUserId || contractorId === currentUserId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Escrow</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-destructive text-sm">{error}</p>}

        {escrow ? (
          <div className="space-y-2 text-sm">
            <p>
              Status: <span className="font-medium">{escrow.status}</span>
            </p>
            <p>
              Milestones: {escrow.milestones_claimed} / {escrow.total_milestones} claimed
            </p>
            <p>Approved: {escrow.milestones_approved}</p>
            <p>
              Per milestone:{' '}
              <span className="tabular-nums">
                {formatMinorUnits(escrow.amount_per_milestone, 'USD')}
              </span>
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No escrow created yet.</p>
        )}

        {!escrow && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Create Escrow</h3>
            <input
              type="number"
              placeholder="Total milestones"
              value={totalMilestones}
              onChange={(e) => setTotalMilestones(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Amount per milestone (in cents)"
              value={amountPerMilestone}
              onChange={(e) => setAmountPerMilestone(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            />
            <Button onClick={handleCreateEscrow} disabled={loading || !contractorId} className="w-full">
              {loading ? 'Creating…' : 'Create Escrow'}
            </Button>
          </div>
        )}

        {escrow && isClient && escrow.milestones_approved < escrow.total_milestones && (
          <Button
            onClick={handleApproveMilestone}
            disabled={loading}
            variant="outline"
            className="w-full"
          >
            {loading ? 'Approving…' : 'Approve Next Milestone'}
          </Button>
        )}

        {escrow && isContractor && escrow.milestones_approved > escrow.milestones_claimed && (
          <Button onClick={handleClaimMilestone} disabled={loading} className="w-full">
            {loading ? 'Claiming…' : 'Claim Milestone'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
