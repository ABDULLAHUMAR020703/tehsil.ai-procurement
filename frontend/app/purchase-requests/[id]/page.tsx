'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useAuth } from '../../../features/auth/AuthProvider';
import { authedFetchWithSupabase, formatPkr, NoSessionError } from '../../../lib/api';
import { useState } from 'react';
import { AuditHistoryModal } from '../../../components/AuditHistoryModal';
import { LastUpdatedMeta, LastUpdatedPanel } from '../../../components/LastUpdatedPanel';
import { approvalStageLabel } from '../../../lib/org';

type ApprovalRow = {
  id: string;
  request_id: string;
  approver_id: string;
  role: string;
  status: string;
  comments: string | null;
  created_at: string;
  updated_at?: string;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  is_admin_override?: boolean | null;
  approver?: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
};

type DetailResponse = {
  purchaseRequest: {
    id: string;
    title: string;
    description: string;
    amount: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    documentUrl: string | null;
    currentStage: string | null;
    createdBy: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
    updatedBy: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
    last_updated_at?: string | null;
    last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  };
  project: {
    id: string;
    name: string;
    po_id: string | null;
    budget: number;
    status: string;
    updated_at?: string;
    updated_by?: string | null;
    updatedBy?: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
    last_updated_at?: string | null;
    last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  } | null;
  purchaseOrder: {
    id: string;
    po_number: string;
    vendor: string;
    total_value: number;
    remaining_value: number;
    updated_at?: string;
    updated_by?: string | null;
    updatedBy?: { id: string; name?: string | null; email?: string | null; role?: string | null } | null;
    last_updated_at?: string | null;
    last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  } | null;
  approvals: ApprovalRow[];
  exceptions: Array<{ id: string; type: string; status: string; approved_by: string | null; created_at: string }>;
  auditLogs: Array<{
    id: string;
    action: string;
    user_id: string;
    entity: string;
    entity_id: string;
    reason?: string | null;
    entity_type?: string | null;
    changes?: Record<string, unknown> | null;
    timestamp: string;
  }>;
};

export default function PurchaseRequestDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, supabase, profile } = useAuth();
  const requestId = params?.id ?? '';
  const isAdmin = profile?.role === 'admin';
  const [overrideDecision, setOverrideDecision] = useState<'approved' | 'rejected'>('approved');
  const [overrideReason, setOverrideReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectHistoryOpen, setProjectHistoryOpen] = useState(false);
  const [poHistoryOpen, setPoHistoryOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['purchase-request-detail', requestId],
    enabled: !!accessToken && !!supabase && !!requestId && isAdmin,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<DetailResponse>(supabase, `/api/purchase-requests/${requestId}`);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      try {
        return await authedFetchWithSupabase<unknown>(supabase, '/api/approvals/override', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            decision: overrideDecision,
            reason: overrideReason.trim(),
          }),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setOverrideReason('');
      queryClient.invalidateQueries({ queryKey: ['purchase-request-detail', requestId] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (!isAdmin) {
    return (
      <AppLayout>
        <PageContainer>
          <Card className="p-6 text-sm text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40">
            This page is only available to admin users.
          </Card>
        </PageContainer>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Purchase Request Detail" subtitle={requestId} />
        <div className="flex gap-2">
          <Link href="/purchase-requests">
            <Button type="button" variant="secondary">
              Back to list
            </Button>
          </Link>
          <Button type="button" variant="secondary" onClick={() => window.open(`/print/pr/${requestId}`, '_blank')}>
            Download PDF
          </Button>
        </div>

        {isLoading ? <Card className="p-4 text-sm text-muted-foreground">Loading...</Card> : null}

        {error ? (
          <Card className="p-4 text-sm text-rose-600 border-rose-200 bg-rose-50">
            Failed to load purchase request
          </Card>
        ) : !data || !data.purchaseRequest ? (
          <Card className="p-4 text-sm text-muted-foreground">No purchase request found.</Card>
        ) : (
          <>
            <LastUpdatedPanel
              updatedAt={data.purchaseRequest.last_updated_at ?? data.purchaseRequest.updatedAt}
              updatedBy={
                (data.purchaseRequest.last_updated_by as typeof data.purchaseRequest.updatedBy) ??
                data.purchaseRequest.updatedBy ??
                data.purchaseRequest.createdBy
              }
              onViewHistory={() => setHistoryOpen(true)}
            />

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Overview</h2>
              <div className="text-sm text-muted-foreground">Purchase Request ID: {data.purchaseRequest.id}</div>
              <div className="text-sm text-muted-foreground">Title: {data.purchaseRequest.title}</div>
              <div className="text-sm text-muted-foreground">Description: {data.purchaseRequest.description}</div>
              <div className="text-sm text-muted-foreground">Requested Amount: {formatPkr(Number(data.purchaseRequest.amount))}</div>
              <div className="text-sm text-muted-foreground">
                Created By: {data.purchaseRequest.createdBy?.name ?? data.purchaseRequest.createdBy?.email ?? data.purchaseRequest.createdBy?.id ?? 'Unknown'}
              </div>
              <div className="text-sm text-muted-foreground">Created At: {new Date(data.purchaseRequest.createdAt).toLocaleString()}</div>
              <div className="text-sm text-muted-foreground">Current Status: {data.purchaseRequest.status}</div>
              <div className="text-sm text-muted-foreground">Current Stage: {data.purchaseRequest.currentStage ?? 'Completed'}</div>
            </Card>

            {data.project ? (
              <LastUpdatedPanel
                updatedAt={data.project.last_updated_at ?? data.project.updated_at}
                updatedBy={
                  (data.project.last_updated_by as typeof data.project.updatedBy) ?? data.project.updatedBy ?? null
                }
                onViewHistory={() => setProjectHistoryOpen(true)}
              />
            ) : null}

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Financial Info</h2>
              <div className="text-sm text-muted-foreground">Associated Project: {data.project?.name ?? 'None'}</div>
              <div className="text-sm text-muted-foreground">Project Status: {data.project?.status ?? 'N/A'}</div>
              <div className="text-sm text-muted-foreground">
                PO Vendor: {data.purchaseOrder?.vendor ?? 'No linked PO'}
              </div>
              <div className="text-sm text-muted-foreground">
                PO Total Budget: {data.purchaseOrder ? formatPkr(Number(data.purchaseOrder.total_value)) : 'N/A'}
              </div>
              <div className="text-sm text-muted-foreground">
                PO Remaining Budget: {data.purchaseOrder ? formatPkr(Number(data.purchaseOrder.remaining_value)) : 'N/A'}
              </div>
            </Card>

            {data.purchaseOrder ? (
              <LastUpdatedPanel
                updatedAt={data.purchaseOrder.last_updated_at ?? data.purchaseOrder.updated_at}
                updatedBy={
                  (data.purchaseOrder.last_updated_by as typeof data.purchaseOrder.updatedBy) ??
                  data.purchaseOrder.updatedBy ??
                  null
                }
                onViewHistory={() => setPoHistoryOpen(true)}
              />
            ) : null}

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Approval Timeline</h2>
              {data.approvals.length === 0 ? (
                <div className="text-sm text-muted-foreground">No approvals found.</div>
              ) : (
                <div className="space-y-2">
                  {data.approvals.map((a) => (
                    <div
                      key={a.id}
                      className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-orange-50/35 dark:bg-stone-800/50 px-3 py-2 text-sm"
                    >
                      <div className="font-medium">
                        {approvalStageLabel(a.role, { legacyAdmin: a.role === 'admin' })} — {a.status}
                        {a.is_admin_override ? (
                          <span className="ml-2 text-xs font-normal text-amber-800">(admin override)</span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        By: {a.approver?.name ?? a.approver?.email ?? a.approver_id}
                      </div>
                      <div className="mt-2">
                        <LastUpdatedMeta at={a.last_updated_at ?? a.updated_at ?? a.created_at} user={a.last_updated_by} />
                      </div>
                      {a.comments ? <div className="text-muted-foreground">Comment: {a.comments}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Documents</h2>
              {data.purchaseRequest.documentUrl ? (
                <a className="text-orange-700 dark:text-orange-400 underline font-medium hover:text-orange-900 dark:hover:text-orange-300" href={data.purchaseRequest.documentUrl} target="_blank" rel="noreferrer">
                  View / Download document
                </a>
              ) : (
                <div className="text-sm text-muted-foreground">No document uploaded</div>
              )}
            </Card>

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Exceptions</h2>
              {data.exceptions.length === 0 ? (
                <div className="text-sm text-muted-foreground">No exceptions found.</div>
              ) : (
                <div className="space-y-2">
                  {data.exceptions.map((ex) => (
                    <div
                      key={ex.id}
                      className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-orange-50/35 dark:bg-stone-800/50 px-3 py-2 text-sm"
                    >
                      <div>Type: {ex.type}</div>
                      <div>Status: {ex.status}</div>
                      <div>Created: {new Date(ex.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-3">
              <h2 className="text-lg font-medium">Audit Logs</h2>
              {data.auditLogs.length === 0 ? (
                <div className="text-sm text-muted-foreground">No audit logs found.</div>
              ) : (
                <div className="space-y-2">
                  {data.auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-orange-50/35 dark:bg-stone-800/50 px-3 py-2 text-sm"
                    >
                      <div className="font-medium">{log.action}</div>
                      <div className="text-muted-foreground">Time: {new Date(log.timestamp).toLocaleString()}</div>
                      {log.reason ? <div className="text-muted-foreground">Reason: {log.reason}</div> : null}
                      {log.changes ? (
                        <pre className="mt-1 max-h-24 overflow-auto text-[11px] text-muted-foreground">
                          {JSON.stringify(log.changes, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6 space-y-3 border border-orange-200/90 dark:border-orange-800/50 bg-orange-50/20 dark:bg-orange-950/15">
              <h2 className="text-lg font-medium">Override approval</h2>
              <p className="text-sm text-muted-foreground">
                Document a reason for audit. This bypasses the normal Team Lead → PM sequence when policy allows.
              </p>
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
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500"
                rows={4}
                placeholder="Document why this override is appropriate (required)"
              />
              <Button
                type="button"
                variant={overrideDecision === 'approved' ? 'success' : 'danger'}
                disabled={!overrideReason.trim() || overrideMutation.isPending}
                onClick={() => overrideMutation.mutate()}
              >
                {overrideMutation.isPending ? 'Applying...' : 'Apply override'}
              </Button>
            </Card>

            <AuditHistoryModal
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              entityType="purchase_request"
              entityId={data.purchaseRequest.id}
              title="Purchase request history"
              supabase={supabase}
              token={accessToken ?? ''}
              onAuthRedirect={() => router.replace('/login')}
            />
            {data.project ? (
              <AuditHistoryModal
                open={projectHistoryOpen}
                onClose={() => setProjectHistoryOpen(false)}
                entityType="project"
                entityId={data.project.id}
                title="Project history"
                supabase={supabase}
                token={accessToken ?? ''}
                onAuthRedirect={() => router.replace('/login')}
              />
            ) : null}
            {data.purchaseOrder ? (
              <AuditHistoryModal
                open={poHistoryOpen}
                onClose={() => setPoHistoryOpen(false)}
                entityType="purchase_order"
                entityId={data.purchaseOrder.id}
                title="Purchase order history"
                supabase={supabase}
                token={accessToken ?? ''}
                onAuthRedirect={() => router.replace('/login')}
              />
            ) : null}
          </>
        )}
      </PageContainer>
    </AppLayout>
  );
}

