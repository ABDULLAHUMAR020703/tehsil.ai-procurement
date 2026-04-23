'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import { PrPoLineMetricsCells, type PoLineSummary } from '../../components/PrPoLineMetricsCells';
import { authedFetchWithSupabase, NoSessionError } from '../../lib/api';
import { LastUpdatedMeta } from '../../components/LastUpdatedPanel';
import { useState } from 'react';
import {
  approvalPipelineStatus,
  approvalStageLabel,
  sortApprovalStageIndex,
} from '../../lib/org';

type PurchaseRequestMeta = {
  id: string;
  status: string;
  item_code: string | null;
  duplicate_count: number;
  po_line_summary?: PoLineSummary | null;
};

type Approval = {
  id: string;
  request_id: string;
  approver_id: string;
  role: string;
  status: string;
  comments: string | null;
  created_at: string;
  updated_at?: string | null;
  updated_by?: string | null;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  is_admin_override?: boolean | null;
  purchase_request?: PurchaseRequestMeta | null;
};

function duplicateRequestFrameClass(dc: number): string {
  if (dc >= 4) return 'border-red-500/55 ring-1 ring-red-500/35';
  if (dc === 3) return 'border-orange-500/55 ring-1 ring-orange-500/35';
  if (dc === 2) return 'border-amber-400/55 ring-1 ring-amber-400/35';
  return '';
}

function duplicateRequestBannerClass(dc: number): string {
  if (dc >= 4)
    return 'border border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100';
  if (dc === 3)
    return 'border border-orange-500/40 bg-orange-50 text-orange-900 dark:bg-orange-950/35 dark:text-orange-100';
  if (dc === 2)
    return 'border border-amber-400/40 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100';
  return '';
}

export default function ApprovalsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, supabase, profile } = useAuth();
  const token = accessToken ?? '';
  const [comments, setComments] = useState<Record<string, string>>({});
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideDecision, setOverrideDecision] = useState<'approved' | 'rejected'>('approved');
  const [overrideReason, setOverrideReason] = useState('');
  const isAdmin = profile?.role === 'admin';

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['approvals', 'mine'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ approvals: Approval[] }>(supabase, '/api/approvals');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const requestIds = (data?.approvals ?? []).map((a) => a.request_id);
  const uniqueRequestIds = [...new Set(requestIds)];
  const { data: approvalsByRequest } = useQuery({
    queryKey: ['approvals', 'by-request', uniqueRequestIds.join(',')],
    enabled: !!token && !!supabase && uniqueRequestIds.length > 0,
    queryFn: async () => {
      const { data: rows, error } = await supabase!
        .from('approvals')
        .select('id, request_id, approver_id, role, status, comments, created_at, is_admin_override')
        .in('request_id', uniqueRequestIds);
      if (error) throw error;
      const grouped: Record<string, Approval[]> = {};
      for (const row of (rows ?? []) as Approval[]) {
        if (!grouped[row.request_id]) grouped[row.request_id] = [];
        grouped[row.request_id].push(row);
      }
      for (const key of Object.keys(grouped)) {
        grouped[key].sort((a, b) => sortApprovalStageIndex(a.role) - sortApprovalStageIndex(b.role));
      }
      return grouped;
    },
  });

  const decisionMutation = useMutation({
    mutationFn: async (params: { approvalId: string; decision: 'approved' | 'rejected' }) => {
      try {
        return await authedFetchWithSupabase<unknown>(
          supabase,
          '/api/approvals/' + params.approvalId + '/decision',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: params.decision,
              comments: (comments[params.approvalId] ?? '').trim() || undefined,
            }),
          },
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (params: { requestId: string; decision: 'approved' | 'rejected'; reason: string }) => {
      try {
        return await authedFetchWithSupabase<unknown>(supabase, '/api/approvals/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setOverrideTarget(null);
      setOverrideReason('');
      setOverrideDecision('approved');
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Approvals" subtitle="Approve or reject workflow items assigned to your role." />

        {isFetching && !isLoading ? (
          <Card className="p-3 text-sm text-orange-900 dark:text-orange-200 border-orange-200 dark:border-orange-800/70 bg-orange-50/95 dark:bg-orange-950/40">
            Fetching latest data...
          </Card>
        ) : null}

        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading...</Card>
        ) : error ? (
          <Card className="p-4 text-sm text-rose-600 border-rose-200 bg-rose-50">
            {error instanceof Error ? error.message : 'Failed to load approvals'}
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="p-0">
              <TableWrapper className="max-h-[360px] overflow-y-auto rounded-2xl">
                <Table>
                  <THead>
                    <TR>
                      <TH>Request</TH>
                      <TH>Role</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {(data?.approvals ?? []).map((a) => (
                      <TR key={a.id}>
                        <TD>{a.request_id}</TD>
                        <TD>{a.role}</TD>
                        <TD>{a.status}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrapper>
            </Card>

            {(data?.approvals ?? []).map((a) => {
              const dupCount = a.purchase_request?.duplicate_count ?? 1;
              const dupFrame = duplicateRequestFrameClass(dupCount);
              return (
              <Card key={a.id} className={`p-4 space-y-3 ${dupFrame}`.trim()}>
                {(() => {
                  const chain = approvalsByRequest?.[a.request_id] ?? [a];
                  const requiredChain = chain
                    .filter((step) => step.role === 'team_lead' || step.role === 'pm')
                    .sort((x, y) => sortApprovalStageIndex(x.role) - sortApprovalStageIndex(y.role));
                  const legacyAdminRows = chain.filter((step) => step.role === 'admin');
                  const currentStep = requiredChain.find((step) => step.status === 'pending');
                  const canDecide = a.status === 'pending' && !!currentStep && currentStep.id === a.id;
                  const prStatus = a.purchase_request?.status ?? '';
                  const canForceApprove =
                    isAdmin &&
                    (prStatus === 'pending' || prStatus === 'pending_exception') &&
                    requiredChain.some((s) => s.status === 'pending');
                  const forceTargetId = requiredChain.find((s) => s.status === 'pending')?.id;

                  return (
                    <>
                      {dupCount > 1 ? (
                        <div className={`rounded-lg px-3 py-2 text-sm ${duplicateRequestBannerClass(dupCount)}`}>
                          This item has been requested {dupCount} times by the same user.
                          {a.purchase_request?.item_code ? (
                            <span className="block text-xs opacity-90 mt-1">Item code: {a.purchase_request.item_code}</span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 overflow-hidden">
                        <div className="text-xs text-muted-foreground px-3 py-2 bg-stone-100/90 dark:bg-stone-800/70">
                          PO line & amounts
                        </div>
                        <TableWrapper className="overflow-x-auto">
                          <Table>
                            <THead>
                              <TR>
                                <TH>Item</TH>
                                <TH>Description</TH>
                                <TH>Unit</TH>
                                <TH>Qty</TH>
                                <TH>Requested</TH>
                                <TH>Remaining</TH>
                                <TH>After</TH>
                              </TR>
                            </THead>
                            <TBody>
                              <TR>
                                <PrPoLineMetricsCells summary={a.purchase_request?.po_line_summary} />
                              </TR>
                            </TBody>
                          </Table>
                        </TableWrapper>
                      </div>
                      <div className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-orange-50/35 dark:bg-stone-800/50 p-3">
                        <div className="text-xs text-muted-foreground mb-2">Required approval chain (Team Lead → PM)</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {requiredChain.map((step) => {
                            const isCurrent = currentStep?.id === step.id;
                            const indicator = step.status === 'approved' ? '✅' : isCurrent ? '🔵' : '⏳';
                            const overrideNote = step.is_admin_override ? ' · override' : '';
                            return (
                              <span
                                key={step.id}
                                className="inline-flex items-center gap-1 rounded border border-stone-200/90 dark:border-stone-600/70 bg-[var(--surface)]/80 dark:bg-stone-900/50 px-2 py-1"
                              >
                                <span>{indicator}</span>
                                <span title={step.role}>
                                  {approvalStageLabel(step.role)}
                                  {overrideNote ? <span className="text-amber-800 dark:text-amber-200 font-medium">{overrideNote}</span> : null}
                                </span>
                              </span>
                            );
                          })}
                        </div>
                        {legacyAdminRows.length > 0 ? (
                          <div className="mt-2 text-[11px] text-muted-foreground border-t border-stone-200/80 dark:border-stone-600/60 pt-2">
                            Legacy admin records (informational, not required):{' '}
                            {legacyAdminRows
                              .map((r) => `${approvalStageLabel('admin', { legacyAdmin: true })}: ${r.status}`)
                              .join(' · ')}
                          </div>
                        ) : null}
                        {!canDecide && currentStep ? (
                          <div className="mt-2 text-xs text-amber-800 dark:text-amber-200 font-medium">
                            {approvalPipelineStatus(currentStep.role, currentStep.status)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="space-y-1">
                          <div className="text-sm text-muted-foreground">
                            Request:{' '}
                            {isAdmin ? (
                              <Link
                              className="text-orange-700 dark:text-orange-400 underline font-medium hover:text-orange-900 dark:hover:text-orange-300"
                              href={`/purchase-requests/${a.request_id}`}
                            >
                                {a.request_id}
                              </Link>
                            ) : (
                              a.request_id
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">Stage: {approvalStageLabel(a.role)}</div>
                          <div className="text-sm text-muted-foreground">Status: {a.status}</div>
                          {a.is_admin_override ? (
                            <div className="text-xs text-amber-800 dark:text-amber-200">
                              This row was decided via an administrator action.
                            </div>
                          ) : null}
                          <div className="pt-2 border-t border-stone-200/80 dark:border-stone-600/60 mt-2">
                            <LastUpdatedMeta at={a.last_updated_at ?? a.updated_at} user={a.last_updated_by} />
                          </div>
                        </div>
                        {isAdmin ? (
                          <div className="flex flex-wrap gap-2 justify-end">
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={() => {
                                setOverrideTarget(a.request_id);
                                setOverrideReason('');
                                setOverrideDecision('approved');
                              }}
                            >
                              Override approval
                            </Button>
                            <Button
                              variant="success"
                              type="button"
                              disabled={!canForceApprove || !forceTargetId || decisionMutation.isPending}
                              onClick={() => {
                                if (forceTargetId) {
                                  decisionMutation.mutate({ approvalId: forceTargetId, decision: 'approved' });
                                }
                              }}
                              title="Approve all pending stages and finalize immediately (admin only)"
                            >
                              Force approve
                            </Button>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-2">
                        <label className="block text-sm font-medium">Comments (optional)</label>
                        <textarea
                          value={comments[a.id] ?? ''}
                          onChange={(e) => setComments((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none shadow-sm focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500"
                          rows={3}
                          placeholder="Add a decision comment"
                        />
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="success"
                          disabled={!canDecide || decisionMutation.isPending}
                          onClick={() => decisionMutation.mutate({ approvalId: a.id, decision: 'approved' })}
                          type="button"
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          disabled={!canDecide || decisionMutation.isPending}
                          onClick={() => decisionMutation.mutate({ approvalId: a.id, decision: 'rejected' })}
                          type="button"
                        >
                          Reject
                        </Button>
                      </div>
                    </>
                  );
                })()}
              </Card>
            );
            })}
            {(data?.approvals ?? []).length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">No approvals found.</Card>
            ) : null}
          </div>
        )}
        {overrideTarget && isAdmin ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 dark:bg-stone-950/55 backdrop-blur-[2px] p-4">
            <Card className="max-w-md w-full p-6 space-y-4 border-stone-200/90 dark:border-stone-600/70 shadow-xl">
              <h3 className="text-lg font-medium">Override approval</h3>
              <p className="text-sm text-muted-foreground">
                Request: {overrideTarget}. A written reason is required for audit.
              </p>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Decision</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={overrideDecision === 'approved' ? 'success' : 'secondary'}
                    onClick={() => setOverrideDecision('approved')}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant={overrideDecision === 'rejected' ? 'danger' : 'secondary'}
                    onClick={() => setOverrideDecision('rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium">Reason (required)</label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none shadow-sm focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500"
                  rows={4}
                  placeholder="Document why this override is appropriate"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOverrideTarget(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={overrideDecision === 'approved' ? 'success' : 'danger'}
                  disabled={!overrideReason.trim() || overrideMutation.isPending}
                  onClick={() =>
                    overrideMutation.mutate({
                      requestId: overrideTarget,
                      decision: overrideDecision,
                      reason: overrideReason.trim(),
                    })
                  }
                >
                  {overrideMutation.isPending ? 'Applying...' : 'Apply override'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}

