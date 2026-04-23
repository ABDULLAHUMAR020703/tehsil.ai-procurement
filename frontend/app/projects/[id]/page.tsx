'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AppLayout } from '../../../components/AppLayout';
import { AuditHistoryModal } from '../../../components/AuditHistoryModal';
import { LastUpdatedPanel } from '../../../components/LastUpdatedPanel';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useAuth } from '../../../features/auth/AuthProvider';
import { authedFetchWithSupabase, formatPkr, NoSessionError } from '../../../lib/api';

type UserLite = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  job_title?: string | null;
};

type ProjectDetailResponse = {
  project: {
    id: string;
    name: string;
    po_id: string | null;
    budget: number;
    status: string;
    is_exception: boolean;
    department_id: string;
    department_label?: string;
    team_lead_id: string | null;
    pm_id?: string | null;
    created_at: string;
    updated_at?: string;
    updatedBy: { id: string; name: string; email: string; role: string } | null;
    last_updated_at?: string | null;
    last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
    pm: UserLite | null;
    team_lead: UserLite | null;
    assigned_employees: UserLite[];
  };
  purchaseOrder: {
    id: string;
    po_number: string | null;
    vendor: string | null;
    po: string | null;
    total_value: number;
    remaining_value: number;
    updated_at?: string;
    updatedBy: { id: string; name: string; email: string; role: string } | null;
    last_updated_at?: string | null;
    last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
  } | null;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  job_title?: string | null;
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, supabase, profile } = useAuth();
  const projectId = params?.id ?? '';
  const [poHistoryOpen, setPoHistoryOpen] = useState(false);
  const [projectHistoryOpen, setProjectHistoryOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [editMembers, setEditMembers] = useState(false);
  const canManageMembers =
    profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'dept_head';

  const { data, isLoading, error } = useQuery({
    queryKey: ['project-detail', projectId],
    enabled: !!accessToken && !!supabase && !!projectId,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<ProjectDetailResponse>(supabase, `/api/projects/${projectId}`);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const p = data?.project;

  const usersPath = useMemo(() => {
    const r = profile?.role;
    if (r === 'admin' || r === 'pm' || r === 'dept_head') {
      return '/api/users?role=employee';
    }
    return null;
  }, [profile?.role]);

  const { data: deptEmployees } = useQuery({
    queryKey: ['users', 'project-members-pool', usersPath],
    enabled: !!accessToken && !!supabase && !!usersPath && editMembers && canManageMembers && !!p,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase!, usersPath!);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(() => new Set());

  const membersMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      try {
        return await authedFetchWithSupabase<{ ok: boolean }>(
          supabase,
          `/api/projects/${projectId}/members`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigned_employee_ids: ids }),
          },
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setEditMembers(false);
      queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const canDownloadPdf = profile?.role === 'admin' || profile?.role === 'pm';

  const startEditMembers = () => {
    setSelectedMembers(new Set((p?.assigned_employees ?? []).map((u) => u.id)));
    setEmployeeSearch('');
    setEditMembers(true);
  };

  const employeePool = deptEmployees?.users ?? [];

  const filteredPool = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return employeePool;
    return employeePool.filter(
      (u) =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.job_title ?? '').toLowerCase().includes(q),
    );
  }, [employeePool, employeeSearch]);

  const toggleMember = (id: string, checked: boolean) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const pData = data;

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Project" subtitle={projectId} />
        <div className="flex gap-2">
          <Link href="/projects">
            <Button type="button" variant="secondary">
              Back to projects
            </Button>
          </Link>
          {canDownloadPdf ? (
            <Button type="button" variant="secondary" onClick={() => window.open(`/print/project/${projectId}`, '_blank')}>
              Download PDF
            </Button>
          ) : null}
        </div>

        {isLoading ? <Card className="p-4 text-sm text-muted-foreground">Loading…</Card> : null}
        {error ? (
          <Card className="p-4 text-sm text-rose-600 border-rose-200 bg-rose-50">
            {error instanceof Error ? error.message : 'Failed to load'}
          </Card>
        ) : null}

        {p ? (
          <>
            <LastUpdatedPanel
              updatedAt={p.last_updated_at ?? p.updated_at}
              updatedBy={(p.last_updated_by as typeof p.updatedBy) ?? p.updatedBy}
              onViewHistory={() => setProjectHistoryOpen(true)}
            />

            <Card className="p-6 space-y-3 text-sm">
              <h2 className="text-lg font-medium text-foreground">{p.name}</h2>
              <div className="text-muted-foreground">
                Department: <span className="text-foreground capitalize">{p.department_label ?? p.department_id}</span>
              </div>
              <div className="text-muted-foreground">
                Project Manager:{' '}
                <span className="text-foreground">
                  {p.pm?.name ?? p.pm?.email ?? p.pm_id ?? '—'}
                </span>
              </div>
              <div className="text-muted-foreground">
                Team Lead:{' '}
                <span className="text-foreground">
                  {p.team_lead?.name ?? p.team_lead?.email ?? p.team_lead_id ?? '—'}
                </span>
              </div>
              <div className="text-muted-foreground">Status: {p.status}</div>
              <div className="text-muted-foreground">Budget (no-PO or reference): {formatPkr(Number(p.budget))}</div>
              <div className="text-muted-foreground">Exception flag: {p.is_exception ? 'Yes' : 'No'}</div>

              <div className="border-t border-slate-200 pt-3 mt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-medium text-foreground">Assigned employees</h3>
                  {canManageMembers ? (
                    <Button type="button" variant="secondary" className="text-xs" onClick={() => (editMembers ? setEditMembers(false) : startEditMembers())}>
                      {editMembers ? 'Cancel' : 'Edit members'}
                    </Button>
                  ) : null}
                </div>
                {!editMembers ? (
                  <ul className="mt-2 space-y-2">
                    {(p.assigned_employees ?? []).length === 0 ? (
                      <li className="text-muted-foreground">No employees assigned (legacy projects may rely on department access).</li>
                    ) : (
                      (p.assigned_employees ?? []).map((u) => (
                        <li key={u.id} className="rounded border border-slate-200 bg-slate-50/80 px-3 py-2">
                          <span className="text-foreground">{u.name ?? u.email}</span>
                          {u.job_title ? (
                            <span className="ml-2 text-[11px] uppercase tracking-wide text-amber-700">{u.job_title}</span>
                          ) : null}
                          <span className="text-xs text-muted-foreground ml-2">{u.email}</span>
                        </li>
                      ))
                    )}
                  </ul>
                ) : (
                  <div className="mt-3 space-y-2">
                    <Input
                      placeholder="Filter employees…"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      className="text-sm"
                    />
                    <div className="max-h-[220px] overflow-y-auto rounded border border-slate-200 divide-y divide-slate-100 bg-white">
                      {filteredPool.map((u) => (
                        <label key={u.id} className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border border-slate-300 bg-white"
                            checked={selectedMembers.has(u.id)}
                            onChange={(e) => toggleMember(u.id, e.target.checked)}
                          />
                          <span>
                            {u.name ?? u.email}
                            {u.job_title ? (
                              <span className="ml-2 text-[11px] uppercase text-amber-700">{u.job_title}</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="success"
                        className="text-sm"
                        disabled={membersMutation.isPending}
                        onClick={() => membersMutation.mutate([...selectedMembers])}
                      >
                        {membersMutation.isPending ? 'Saving…' : 'Save members'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            {pData?.purchaseOrder ? (
              <>
                <Card className="p-6 space-y-2 text-sm">
                  <h2 className="text-lg font-medium">Linked purchase order (header)</h2>
                  <div className="text-muted-foreground">PO: {pData.purchaseOrder.po ?? pData.purchaseOrder.po_number ?? '—'}</div>
                  <div className="text-muted-foreground">Vendor: {pData.purchaseOrder.vendor ?? '—'}</div>
                  <div className="text-muted-foreground">
                    Total: {formatPkr(Number(pData.purchaseOrder.total_value))} · Remaining:{' '}
                    {formatPkr(Number(pData.purchaseOrder.remaining_value))}
                  </div>
                </Card>
                <LastUpdatedPanel
                  updatedAt={pData.purchaseOrder.last_updated_at ?? pData.purchaseOrder.updated_at}
                  updatedBy={
                    (pData.purchaseOrder.last_updated_by as typeof pData.purchaseOrder.updatedBy) ??
                    pData.purchaseOrder.updatedBy
                  }
                  onViewHistory={() => setPoHistoryOpen(true)}
                />
              </>
            ) : (
              <Card className="p-4 text-sm text-muted-foreground">No linked PO row on this project.</Card>
            )}

            <AuditHistoryModal
              open={projectHistoryOpen}
              onClose={() => setProjectHistoryOpen(false)}
              entityType="project"
              entityId={p.id}
              title="Project history"
              supabase={supabase}
              token={accessToken ?? ''}
              onAuthRedirect={() => router.replace('/login')}
            />
            {pData?.purchaseOrder ? (
              <AuditHistoryModal
                open={poHistoryOpen}
                onClose={() => setPoHistoryOpen(false)}
                entityType="purchase_order"
                entityId={pData.purchaseOrder.id}
                title="Purchase order history"
                supabase={supabase}
                token={accessToken ?? ''}
                onAuthRedirect={() => router.replace('/login')}
              />
            ) : null}
          </>
        ) : !isLoading && !error ? (
          <Card className="p-4 text-sm text-muted-foreground">Project not found.</Card>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}
