'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { PrPoLineMetricsCells, type PoLineSummary } from '../../components/PrPoLineMetricsCells';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../components/ui/Table';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  ApiError,
  authedFetchWithSupabase,
  authedFetchWithSupabaseNoContent,
  NoSessionError,
} from '../../lib/api';
import { sortApprovalStageIndex } from '../../lib/org';
import { LastUpdatedMeta } from '../../components/LastUpdatedPanel';
import { Calendar } from 'lucide-react';

type ProjectPurchaseOrderSnapshot = { total_value: number; remaining_value: number };

type UserSummary = { id: string; name: string | null; email: string | null; role: string };

type Project = {
  id: string;
  name: string;
  po_id: string | null;
  budget: number;
  status: string;
  is_exception: boolean;
  created_at: string;
  created_by: string;
  department_id: string;
  department_label?: string;
  team_lead_id: string | null;
  pm_id?: string | null;
  pm?: UserSummary | null;
  team_lead?: UserSummary | null;
  purchase_order?: ProjectPurchaseOrderSnapshot | ProjectPurchaseOrderSnapshot[] | null;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

type PurchaseRequest = {
  id: string;
  project_id: string;
  description: string;
  amount: number;
  document_url: string | null;
  item_code?: string | null;
  duplicate_count?: number | null;
  po_line_id?: string | null;
  requested_quantity?: number | null;
  po_line_summary?: PoLineSummary | null;
  status: string;
  budget_deducted?: boolean;
  created_at: string;
  created_by: string;
  last_updated_at?: string | null;
  last_updated_by?: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  job_title?: string | null;
};

function formatPkr(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

function linkedPurchaseOrder(p: Project): ProjectPurchaseOrderSnapshot | null {
  const raw = p.purchase_order;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const row = raw[0];
    if (!row) return null;
    return {
      total_value: Number(row.total_value),
      remaining_value: Number(row.remaining_value),
    };
  }
  return {
    total_value: Number(raw.total_value),
    remaining_value: Number(raw.remaining_value),
  };
}

function isDeptManagerRole(role: string | undefined): boolean {
  return role === 'pm' || role === 'dept_head';
}

function canArchiveProject(
  p: Project,
  profile: { userId: string; role: string; department?: string | null } | null,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (isDeptManagerRole(profile.role)) return !!(profile.department && profile.department === p.department_id);
  return false;
}

function canAssignTeamLead(
  profile: { role: string; department?: string | null } | null,
  p: Project,
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (isDeptManagerRole(profile.role)) return !!(profile.department && profile.department === p.department_id);
  return false;
}

function canDeletePurchaseRequest(
  pr: PurchaseRequest,
  profile: { role: string; department?: string | null } | null | undefined,
  projectDeptById: Map<string, string>,
): boolean {
  if (!profile) return false;
  if (pr.status === 'approved' || pr.budget_deducted === true) return false;
  if (profile.role === 'admin') return true;
  if (!isDeptManagerRole(profile.role)) return false;
  const dept = projectDeptById.get(pr.project_id);
  if (!dept || !profile.department) return false;
  return profile.department === dept;
}

function openBulkProjectPrint(ids: string[]) {
  if (ids.length === 0) return;
  const q = encodeURIComponent(ids.join(','));
  window.open(`/print/projects/bulk?ids=${q}`, '_blank', 'noopener,noreferrer');
}

function openBulkPrPrint(ids: string[]) {
  if (ids.length === 0) return;
  const q = encodeURIComponent(ids.join(','));
  window.open(`/print/pr/bulk?ids=${q}`, '_blank', 'noopener,noreferrer');
}

function rowCreatedDateInRange(iso: string, from: string, to: string): boolean {
  const day = iso.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function openDatePicker(input: HTMLInputElement | null) {
  if (!input) return;
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
      return;
    } catch {
      /* fall through */
    }
  }
  input.focus();
}

function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function BudgetUsageBar({ total, remaining }: { total: number; remaining: number }) {
  const used = Math.max(0, total - remaining);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="space-y-1 min-w-[160px]">
      <div className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-600">
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Used {formatPkr(used)} ({total > 0 ? `${pct.toFixed(0)}%` : '—'})
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, profile, supabase } = useAuth();
  const token = accessToken ?? '';
  const isAdmin = profile?.role === 'admin';
  const canDownloadPdf = profile?.role === 'admin' || profile?.role === 'pm';

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedPrIds, setSelectedPrIds] = useState<string[]>([]);
  const [projectDeleteQueue, setProjectDeleteQueue] = useState<{ id: string; name: string }[] | null>(null);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [projectDeleteError, setProjectDeleteError] = useState<string | null>(null);
  const [prDeleteQueue, setPrDeleteQueue] = useState<string[] | null>(null);
  const [prDeleteBusy, setPrDeleteBusy] = useState(false);
  const [prDeleteError, setPrDeleteError] = useState<string | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<string | null>(null);
  const [overrideDecision, setOverrideDecision] = useState<'approved' | 'rejected'>('approved');
  const [overrideReason, setOverrideReason] = useState('');
  const [listError, setListError] = useState<string | null>(null);
  const dateFromRef = useRef<HTMLInputElement>(null);
  const dateToRef = useRef<HTMLInputElement>(null);
  const projectSelectAllRef = useRef<HTMLInputElement>(null);
  const prSelectAllRef = useRef<HTMLInputElement>(null);

  const {
    data: projectsData,
    isLoading: projectsLoading,
    isFetching: projectsFetching,
    error: projectsError,
  } = useQuery({
    queryKey: ['projects', 'list'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ projects: Project[] }>(supabase, '/api/projects');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: prData, isLoading: prLoading, isFetching: prFetching } = useQuery({
    queryKey: ['purchase-requests', 'list'],
    enabled: !!token && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ purchaseRequests: PurchaseRequest[] }>(
          supabase,
          '/api/purchase-requests',
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: adminAllUsersData } = useQuery({
    queryKey: ['users', 'admin-full-list'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: deptUsersData } = useQuery({
    queryKey: ['users', 'by-department', profile?.department ?? '', 'reports'],
    enabled:
      !!token && !!supabase && isDeptManagerRole(profile?.role) && !!profile?.department,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const filteredProjects = useMemo(() => {
    const rows = projectsData?.projects ?? [];
    if (!dateFrom && !dateTo) return rows;
    return rows.filter((p) => rowCreatedDateInRange(p.created_at, dateFrom, dateTo));
  }, [projectsData?.projects, dateFrom, dateTo]);

  const filteredPurchaseRequests = useMemo(() => {
    const rows = prData?.purchaseRequests ?? [];
    if (!dateFrom && !dateTo) return rows;
    return rows.filter((pr) => rowCreatedDateInRange(pr.created_at, dateFrom, dateTo));
  }, [prData?.purchaseRequests, dateFrom, dateTo]);

  const projectDeptById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projectsData?.projects ?? []) m.set(p.id, p.department_id);
    return m;
  }, [projectsData?.projects]);

  useEffect(() => {
    const ids = new Set(filteredProjects.map((p) => p.id));
    setSelectedProjectIds((prev) => prev.filter((id) => ids.has(id)));
  }, [filteredProjects]);

  useEffect(() => {
    const ids = new Set(filteredPurchaseRequests.map((p) => p.id));
    setSelectedPrIds((prev) => prev.filter((id) => ids.has(id)));
  }, [filteredPurchaseRequests]);

  const selectedDeletableProjects = useMemo(
    () =>
      filteredProjects
        .filter((p) => selectedProjectIds.includes(p.id) && canArchiveProject(p, profile))
        .map((p) => ({ id: p.id, name: p.name })),
    [filteredProjects, selectedProjectIds, profile],
  );

  const selectedDeletablePrIds = useMemo(
    () =>
      filteredPurchaseRequests
        .filter((pr) => selectedPrIds.includes(pr.id) && canDeletePurchaseRequest(pr, profile, projectDeptById))
        .map((pr) => pr.id),
    [filteredPurchaseRequests, selectedPrIds, profile, projectDeptById],
  );

  const showPrActionsCol = useMemo(() => {
    return (
      canDownloadPdf ||
      filteredPurchaseRequests.some((pr) => canDeletePurchaseRequest(pr, profile, projectDeptById))
    );
  }, [canDownloadPdf, filteredPurchaseRequests, profile, projectDeptById]);

  const prListIds = useMemo(() => filteredPurchaseRequests.map((p) => p.id), [filteredPurchaseRequests]);

  const { data: prApprovalsForAdmin } = useQuery({
    queryKey: ['approvals', 'admin-pr-force-map', prListIds.join(',')],
    enabled: isAdmin && !!supabase && prListIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from('approvals')
        .select('id, request_id, role, status')
        .in('request_id', prListIds);
      if (error) throw error;
      return (data ?? []) as { id: string; request_id: string; role: string; status: string }[];
    },
  });

  const firstPendingRequiredByPr = useMemo(() => {
    const map = new Map<string, string>();
    const rows = prApprovalsForAdmin ?? [];
    for (const prId of prListIds) {
      const pending = rows.filter(
        (r) =>
          r.request_id === prId &&
          r.status === 'pending' &&
          (r.role === 'team_lead' || r.role === 'pm'),
      );
      pending.sort((a, b) => sortApprovalStageIndex(a.role) - sortApprovalStageIndex(b.role));
      if (pending[0]) map.set(prId, pending[0].id);
    }
    return map;
  }, [prApprovalsForAdmin, prListIds]);

  const projectSelectAllChecked =
    filteredProjects.length > 0 && filteredProjects.every((p) => selectedProjectIds.includes(p.id));
  const prSelectAllChecked =
    filteredPurchaseRequests.length > 0 &&
    filteredPurchaseRequests.every((p) => selectedPrIds.includes(p.id));

  useEffect(() => {
    const el = projectSelectAllRef.current;
    if (!el) return;
    const n = filteredProjects.length;
    const sel = filteredProjects.filter((p) => selectedProjectIds.includes(p.id)).length;
    el.indeterminate = sel > 0 && sel < n;
  }, [filteredProjects, selectedProjectIds]);

  useEffect(() => {
    const el = prSelectAllRef.current;
    if (!el) return;
    const n = filteredPurchaseRequests.length;
    const sel = filteredPurchaseRequests.filter((p) => selectedPrIds.includes(p.id)).length;
    el.indeterminate = sel > 0 && sel < n;
  }, [filteredPurchaseRequests, selectedPrIds]);

  const departmentBadgeClass =
    'inline-flex items-center rounded-full border border-orange-200 dark:border-orange-700/60 bg-orange-50 dark:bg-orange-950/40 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-orange-900 dark:text-orange-200';

  const teamLeadCandidatesForDept = (dept: string) => {
    const pool =
      profile?.role === 'admin' ? (adminAllUsersData?.users ?? []) : (deptUsersData?.users ?? []);
    return pool.filter((u) => u.role !== 'admin' && u.department === dept);
  };

  const runProjectDeletes = async (items: { id: string; name: string }[]) => {
    if (!supabase || items.length === 0) return;
    setProjectDeleteBusy(true);
    setProjectDeleteError(null);
    try {
      for (const it of items) {
        await authedFetchWithSupabaseNoContent(supabase, `/api/projects/${it.id}`, { method: 'DELETE' });
      }
      setProjectDeleteQueue(null);
      const removed = new Set(items.map((i) => i.id));
      setSelectedProjectIds((prev) => prev.filter((id) => !removed.has(id)));
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
    } catch (e) {
      if (e instanceof NoSessionError) router.replace('/login');
      else
        setProjectDeleteError(
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed',
        );
    } finally {
      setProjectDeleteBusy(false);
    }
  };

  const runPrDeletes = async (ids: string[]) => {
    if (!supabase || ids.length === 0) return;
    setPrDeleteBusy(true);
    setPrDeleteError(null);
    try {
      for (const id of ids) {
        await authedFetchWithSupabaseNoContent(supabase, `/api/purchase-requests/${id}`, { method: 'DELETE' });
      }
      setPrDeleteQueue(null);
      setSelectedPrIds((prev) => prev.filter((id) => !ids.includes(id)));
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    } catch (e) {
      if (e instanceof NoSessionError) router.replace('/login');
      else
        setPrDeleteError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setPrDeleteBusy(false);
    }
  };

  const teamLeadMutation = useMutation({
    mutationFn: async (params: { projectId: string; team_lead_id: string | null }) => {
      try {
        return await authedFetchWithSupabase<unknown>(supabase, `/api/projects/${params.projectId}/team-lead`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_lead_id: params.team_lead_id }),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
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
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: unknown) => setListError(e instanceof Error ? e.message : 'Override failed'),
  });

  const forceApproveFromListMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      try {
        return await authedFetchWithSupabase<unknown>(
          supabase,
          '/api/approvals/' + approvalId + '/decision',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'approved' }),
          },
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: unknown) => setListError(e instanceof Error ? e.message : 'Force approve failed'),
  });

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="Reports"
          subtitle="Filter projects and purchase requests by creation date, export PDFs, and manage list actions."
        />

        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-medium">Date range</h2>
            <Button
              type="button"
              variant="secondary"
              className="h-9 w-9 shrink-0 p-0 inline-flex items-center justify-center rounded-lg border border-orange-200 dark:border-orange-700/60 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-950/60"
              title="Open start date calendar"
              aria-label="Open start date calendar"
              onClick={() => openDatePicker(dateFromRef.current)}
            >
              <Calendar className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Leave both fields empty to show all rows. Filters use each row&apos;s <strong>created</strong> date (UTC
            calendar day).
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label htmlFor="rep-from" className="block text-sm font-medium">
                From
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={dateFromRef}
                  id="rep-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-10 shrink-0 p-0 inline-flex items-center justify-center rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:text-orange-700 dark:hover:text-orange-400 hover:border-orange-300 dark:hover:border-orange-600 shadow-sm"
                  title="Choose from date"
                  aria-label="Choose from date"
                  onClick={() => openDatePicker(dateFromRef.current)}
                >
                  <Calendar className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="rep-to" className="block text-sm font-medium">
                To
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={dateToRef}
                  id="rep-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 w-10 shrink-0 p-0 inline-flex items-center justify-center rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 text-stone-600 dark:text-stone-400 hover:text-orange-700 dark:hover:text-orange-400 hover:border-orange-300 dark:hover:border-orange-600 shadow-sm"
                  title="Choose to date"
                  aria-label="Choose to date"
                  onClick={() => openDatePicker(dateToRef.current)}
                >
                  <Calendar className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
            <Button type="button" variant="secondary" className="text-sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
              Clear dates
            </Button>
          </div>
        </Card>

        {(projectsFetching && !projectsLoading) || (prFetching && !prLoading) ? (
          <div className="rounded-lg border border-orange-200 dark:border-orange-800/60 bg-orange-50 dark:bg-orange-950/35 px-4 py-2 text-sm text-orange-950 dark:text-orange-100">
            Refreshing data...
          </div>
        ) : null}

        {listError ? <div className="text-sm text-rose-600 font-medium">{listError}</div> : null}

        <Card className="p-6 space-y-4">
          <div className="space-y-3">
            <h2 className="text-lg font-medium">Project list</h2>
            {!projectsLoading && !projectsError && filteredProjects.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {canDownloadPdf ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs sm:text-sm"
                      onClick={() => openBulkProjectPrint(filteredProjects.map((p) => p.id))}
                    >
                      Download all PDFs
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs sm:text-sm"
                      disabled={
                        !selectedProjectIds.some((id) => filteredProjects.some((p) => p.id === id))
                      }
                      onClick={() => {
                        openBulkProjectPrint(
                          filteredProjects.filter((p) => selectedProjectIds.includes(p.id)).map((p) => p.id),
                        );
                      }}
                    >
                      Download selected PDFs (
                      {
                        selectedProjectIds.filter((id) => filteredProjects.some((p) => p.id === id))
                          .length
                      }
                      )
                    </Button>
                  </>
                ) : null}
                {selectedDeletableProjects.length > 0 ? (
                  <Button
                    type="button"
                    variant="danger"
                    className="text-xs sm:text-sm"
                    onClick={() => {
                      setProjectDeleteError(null);
                      setProjectDeleteQueue(selectedDeletableProjects);
                    }}
                  >
                    Delete selected ({selectedDeletableProjects.length})
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {projectsLoading ? (
            <div className="text-sm text-muted-foreground">Loading projects...</div>
          ) : projectsError ? (
            <div className="text-sm text-rose-600">{String(projectsError)}</div>
          ) : (
            <TableWrapper className="max-h-[520px] overflow-y-auto rounded-xl border border-stone-200/90 dark:border-stone-600/70 bg-[var(--surface)]/90 dark:bg-stone-900/40">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10 pr-0">
                      <input
                        ref={projectSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                        checked={projectSelectAllChecked}
                        onChange={() => {
                          if (projectSelectAllChecked) setSelectedProjectIds([]);
                          else setSelectedProjectIds(filteredProjects.map((p) => p.id));
                        }}
                        title="Select all in list"
                        aria-label="Select all projects in list"
                      />
                    </TH>
                    <TH>Project</TH>
                    <TH>Created</TH>
                    <TH>Dept</TH>
                    <TH>PM</TH>
                    <TH>Team lead</TH>
                    <TH>Status</TH>
                    <TH className="min-w-[140px]">Last updated</TH>
                    <TH>Budget & usage</TH>
                    <TH>PO</TH>
                    <TH className="w-[160px]">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredProjects.map((p) => {
                    const poSnap = linkedPurchaseOrder(p);
                    const total = poSnap?.total_value ?? null;
                    const remaining = poSnap?.remaining_value ?? null;
                    const hasPoBudget = total != null && remaining != null && Number.isFinite(total) && Number.isFinite(remaining);
                    return (
                      <TR key={p.id} className="align-top">
                        <TD className="align-top pt-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                            checked={selectedProjectIds.includes(p.id)}
                            onChange={() => {
                              setSelectedProjectIds((prev) =>
                                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                              );
                            }}
                            aria-label={`Select project ${p.name}`}
                          />
                        </TD>
                        <TD>
                          <Link
                            href={`/projects/${p.id}`}
                            className="font-medium text-orange-700 dark:text-orange-400 hover:underline hover:text-orange-900 dark:hover:text-orange-300"
                          >
                            {p.name}
                          </Link>
                          {hasPoBudget ? (
                            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground md:hidden">
                              <div>Total budget: {formatPkr(total!)}</div>
                              <div>Remaining budget: {formatPkr(remaining!)}</div>
                            </div>
                          ) : null}
                        </TD>
                        <TD className="text-sm whitespace-nowrap">{formatDisplayDate(p.created_at)}</TD>
                        <TD>
                          <span className={departmentBadgeClass}>{p.department_label ?? p.department_id}</span>
                        </TD>
                        <TD className="text-sm max-w-[140px] truncate">{p.pm?.name ?? p.pm?.email ?? '—'}</TD>
                        <TD className="min-w-[180px]">
                          {canAssignTeamLead(profile, p) ? (
                            <select
                              className="w-full max-w-[200px] rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-2 py-1 text-xs text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400"
                              value={p.team_lead_id ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                teamLeadMutation.mutate({ projectId: p.id, team_lead_id: v || null });
                              }}
                              disabled={teamLeadMutation.isPending}
                            >
                              <option value="">None</option>
                              {teamLeadCandidatesForDept(p.department_id).map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {p.team_lead?.name ?? p.team_lead?.email ?? (p.team_lead_id ? `${p.team_lead_id.slice(0, 8)}…` : '—')}
                            </span>
                          )}
                        </TD>
                        <TD>{p.is_exception ? `${p.status} (exception)` : p.status}</TD>
                        <TD className="align-top">
                          <LastUpdatedMeta at={p.last_updated_at} user={p.last_updated_by} />
                        </TD>
                        <TD>
                          {hasPoBudget ? (
                            <div className="space-y-2 py-1">
                              <div className="text-sm space-y-0.5">
                                <div>
                                  <span className="text-muted-foreground">Total budget: </span>
                                  <span className="font-medium text-foreground">{formatPkr(total!)}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Remaining budget: </span>
                                  <span className="font-medium text-orange-900 dark:text-orange-300">
                                    {formatPkr(remaining!)}
                                  </span>
                                </div>
                              </div>
                              <BudgetUsageBar total={total!} remaining={remaining!} />
                            </div>
                          ) : p.po_id ? (
                            <div className="text-sm text-amber-800 dark:text-amber-200 font-medium">
                              PO linked — budget details unavailable
                            </div>
                          ) : (
                            <div className="text-sm space-y-0.5">
                              <div>
                                <span className="text-muted-foreground">Budget (no PO): </span>
                                <span className="font-medium">{formatPkr(Number(p.budget))}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">No purchase order — usage bar N/A</div>
                            </div>
                          )}
                        </TD>
                        <TD className="max-w-[240px] truncate text-sm">{p.po_id ? p.po_id : 'No PO'}</TD>
                        <TD>
                          <div className="flex flex-col gap-1">
                            {canDownloadPdf ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="px-2 py-1 text-xs"
                                onClick={() => openBulkProjectPrint([p.id])}
                              >
                                Download PDF
                              </Button>
                            ) : null}
                            {canArchiveProject(p, profile) ? (
                              <Button
                                type="button"
                                variant="danger"
                                className="px-2 py-1 text-xs"
                                onClick={() => {
                                  setProjectDeleteError(null);
                                  setProjectDeleteQueue([{ id: p.id, name: p.name }]);
                                }}
                              >
                                Delete
                              </Button>
                            ) : !canDownloadPdf ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          )}
          {filteredProjects.length === 0 && !projectsLoading && !projectsError ? (
            <div className="text-sm text-muted-foreground">No projects in this date range.</div>
          ) : null}
        </Card>

        <Card className="p-6 space-y-4">
          <div className="space-y-3">
            <h2 className="text-lg font-medium">PR list</h2>
            {!prLoading && filteredPurchaseRequests.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {canDownloadPdf ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs sm:text-sm"
                      onClick={() => openBulkPrPrint(filteredPurchaseRequests.map((pr) => pr.id))}
                    >
                      Download all PDFs
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="text-xs sm:text-sm"
                      disabled={
                        !selectedPrIds.some((id) => filteredPurchaseRequests.some((p) => p.id === id))
                      }
                      onClick={() => {
                        openBulkPrPrint(
                          filteredPurchaseRequests.filter((p) => selectedPrIds.includes(p.id)).map((p) => p.id),
                        );
                      }}
                    >
                      Download selected PDFs (
                      {
                        selectedPrIds.filter((id) => filteredPurchaseRequests.some((p) => p.id === id))
                          .length
                      }
                      )
                    </Button>
                  </>
                ) : null}
                {selectedDeletablePrIds.length > 0 ? (
                  <Button
                    type="button"
                    variant="danger"
                    className="text-xs sm:text-sm"
                    onClick={() => {
                      setPrDeleteError(null);
                      setPrDeleteQueue(selectedDeletablePrIds);
                    }}
                  >
                    Delete selected ({selectedDeletablePrIds.length})
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {prLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <TableWrapper className="max-h-[480px] overflow-x-auto overflow-y-auto rounded-xl border border-stone-200/90 dark:border-stone-600/70 bg-[var(--surface)]/90 dark:bg-stone-900/40">
              <Table>
                <THead>
                  <TR>
                    <TH className="w-10 pr-0">
                      <input
                        ref={prSelectAllRef}
                        type="checkbox"
                        className="h-4 w-4 rounded border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                        checked={prSelectAllChecked}
                        onChange={() => {
                          if (prSelectAllChecked) setSelectedPrIds([]);
                          else setSelectedPrIds(filteredPurchaseRequests.map((p) => p.id));
                        }}
                        title="Select all in list"
                        aria-label="Select all purchase requests in list"
                      />
                    </TH>
                    <TH>Created</TH>
                    <TH>Item code</TH>
                    <TH>Description</TH>
                    <TH>Unit price</TH>
                    <TH>
                      <span title="Requested quantity">Qty</span>
                    </TH>
                    <TH>Requested</TH>
                    <TH>
                      <span title="PO line remaining (net of other pending PRs on this line)">Remaining</span>
                    </TH>
                    <TH>After approval</TH>
                    <TH>Status</TH>
                    <TH className="min-w-[140px]">Last updated</TH>
                    <TH>Request</TH>
                    {showPrActionsCol ? <TH>Actions</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {filteredPurchaseRequests.map((pr) => (
                    <TR key={pr.id}>
                      <TD className="align-top pt-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 accent-orange-600"
                          checked={selectedPrIds.includes(pr.id)}
                          onChange={() => {
                            setSelectedPrIds((prev) =>
                              prev.includes(pr.id) ? prev.filter((x) => x !== pr.id) : [...prev, pr.id],
                            );
                          }}
                          aria-label={`Select purchase request ${pr.id.slice(0, 8)}`}
                        />
                      </TD>
                      <TD className="text-sm whitespace-nowrap">{formatDisplayDate(pr.created_at)}</TD>
                      <PrPoLineMetricsCells summary={pr.po_line_summary} />
                      <TD className="text-xs">{pr.status}</TD>
                      <TD className="text-xs align-top">
                        <LastUpdatedMeta at={pr.last_updated_at} user={pr.last_updated_by} />
                      </TD>
                      <TD className="text-xs">
                        {isAdmin ? (
                          <Link
                            className="text-orange-700 dark:text-orange-400 underline font-medium hover:text-orange-900 dark:hover:text-orange-300"
                            href={`/purchase-requests/${pr.id}`}
                          >
                            {pr.id.slice(0, 8)}…
                          </Link>
                        ) : (
                          <>{pr.id.slice(0, 8)}…</>
                        )}
                      </TD>
                      {showPrActionsCol ? (
                        <TD>
                          <div className="flex flex-col gap-1 min-w-[9rem]">
                            {canDownloadPdf ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="text-xs px-2 py-1"
                                onClick={() => openBulkPrPrint([pr.id])}
                              >
                                Download PDF
                              </Button>
                            ) : null}
                            {canDeletePurchaseRequest(pr, profile, projectDeptById) ? (
                              <Button
                                type="button"
                                variant="danger"
                                className="text-xs px-2 py-1"
                                onClick={() => {
                                  setPrDeleteError(null);
                                  setPrDeleteQueue([pr.id]);
                                }}
                              >
                                Delete
                              </Button>
                            ) : null}
                            {isAdmin ? (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  className="text-xs px-2 py-1"
                                  onClick={() => {
                                    setListError(null);
                                    setOverrideTarget(pr.id);
                                    setOverrideDecision('approved');
                                    setOverrideReason('');
                                  }}
                                >
                                  Override approval
                                </Button>
                                <Button
                                  type="button"
                                  variant="success"
                                  className="text-xs px-2 py-1"
                                  disabled={
                                    forceApproveFromListMutation.isPending ||
                                    !(
                                      (pr.status === 'pending' || pr.status === 'pending_exception') &&
                                      firstPendingRequiredByPr.get(pr.id)
                                    )
                                  }
                                  title="Finalize immediately (admin only)"
                                  onClick={() => {
                                    const aid = firstPendingRequiredByPr.get(pr.id);
                                    if (aid) forceApproveFromListMutation.mutate(aid);
                                  }}
                                >
                                  Force approve
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          )}
          {filteredPurchaseRequests.length === 0 && !prLoading ? (
            <div className="text-sm text-muted-foreground">No purchase requests in this date range.</div>
          ) : null}
        </Card>

        {projectDeleteQueue && projectDeleteQueue.length > 0 ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 dark:bg-stone-950/55 backdrop-blur-[2px] p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-project-title"
          >
            <Card className="max-w-md w-full p-6 space-y-4 border-stone-200/90 dark:border-stone-600/70 shadow-xl">
              <h3 id="archive-project-title" className="text-lg font-medium">
                Delete {projectDeleteQueue.length === 1 ? 'project' : `${projectDeleteQueue.length} projects`}
              </h3>
              <p className="text-sm text-muted-foreground">
                {projectDeleteQueue.length === 1
                  ? 'Are you sure you want to delete this project?'
                  : 'Are you sure you want to delete the selected projects?'}
              </p>
              <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-sm font-medium text-foreground">
                {projectDeleteQueue.slice(0, 12).map((it) => (
                  <li key={it.id}>{it.name}</li>
                ))}
              </ul>
              {projectDeleteQueue.length > 12 ? (
                <p className="text-xs text-muted-foreground">…and {projectDeleteQueue.length - 12} more</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Projects are archived (hidden from lists). This is not allowed if a project has approved spend.
              </p>
              {projectDeleteError ? <p className="text-sm text-rose-600">{projectDeleteError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={projectDeleteBusy}
                  onClick={() => {
                    setProjectDeleteQueue(null);
                    setProjectDeleteError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={projectDeleteBusy}
                  onClick={() => runProjectDeletes(projectDeleteQueue)}
                >
                  {projectDeleteBusy ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {prDeleteQueue && prDeleteQueue.length > 0 ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 dark:bg-stone-950/55 backdrop-blur-[2px] p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pr-delete-title"
          >
            <Card className="max-w-md w-full p-6 space-y-4 border-stone-200/90 dark:border-stone-600/70 shadow-xl">
              <h3 id="pr-delete-title" className="text-lg font-medium">
                Delete {prDeleteQueue.length === 1 ? 'purchase request' : `${prDeleteQueue.length} purchase requests`}
              </h3>
              <p className="text-sm text-muted-foreground">
                This removes the PR and its approval rows. Approved requests that already affected budget cannot be
                deleted.
              </p>
              <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 font-mono text-xs text-foreground">
                {prDeleteQueue.slice(0, 15).map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
              {prDeleteQueue.length > 15 ? (
                <p className="text-xs text-muted-foreground">…and {prDeleteQueue.length - 15} more</p>
              ) : null}
              {prDeleteError ? <p className="text-sm text-rose-600">{prDeleteError}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={prDeleteBusy}
                  onClick={() => {
                    setPrDeleteQueue(null);
                    setPrDeleteError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={prDeleteBusy}
                  onClick={() => runPrDeletes(prDeleteQueue)}
                >
                  {prDeleteBusy ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

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
                  className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500"
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
