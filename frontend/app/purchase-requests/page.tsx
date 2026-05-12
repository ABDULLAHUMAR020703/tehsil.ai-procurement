'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../components/AppLayout';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { PoLineTypeahead, type PoSearchLine } from '../../components/PoLineTypeahead';
import { useAuth } from '../../features/auth/AuthProvider';
import {
  ApiError,
  authedFetchWithSupabase,
  formatPkr,
  getAccessTokenFromSupabaseSession,
  NoSessionError,
} from '../../lib/api';

type ProjectPurchaseOrderSnapshot = { total_value: number; remaining_value: number };
type Project = {
  id: string;
  name: string;
  status: string;
  is_exception: boolean;
  po_id: string | null;
  budget: number;
  purchase_order?: ProjectPurchaseOrderSnapshot | ProjectPurchaseOrderSnapshot[] | null;
};
function ordinalTimeWord(occurrence: number): string {
  const specials: Record<number, string> = {
    2: 'second',
    3: 'third',
    4: 'fourth',
    5: 'fifth',
    6: 'sixth',
    7: 'seventh',
    8: 'eighth',
    9: 'ninth',
    10: 'tenth',
    11: 'eleventh',
    12: 'twelfth',
  };
  if (specials[occurrence]) return specials[occurrence]!;
  const mod100 = occurrence % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${occurrence}th`;
  switch (occurrence % 10) {
    case 1:
      return `${occurrence}st`;
    case 2:
      return `${occurrence}nd`;
    case 3:
      return `${occurrence}rd`;
    default:
      return `${occurrence}th`;
  }
}

function linkedPurchaseOrder(p: Project | undefined): ProjectPurchaseOrderSnapshot | null {
  if (!p) return null;
  const raw = p.purchase_order;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const row = raw[0];
    if (!row) return null;
    return { total_value: Number(row.total_value), remaining_value: Number(row.remaining_value) };
  }
  return { total_value: Number(raw.total_value), remaining_value: Number(raw.remaining_value) };
}

/** Matches backend: PO-linked projects use PO remaining_value; no-PO uses project budget. */
function availableBudgetForProject(p: Project | undefined): number | null {
  if (!p) return null;
  const po = linkedPurchaseOrder(p);
  if (po && Number.isFinite(po.remaining_value)) return po.remaining_value;
  if (!p.po_id && Number.isFinite(Number(p.budget))) return Number(p.budget);
  return null;
}

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, supabase, profile } = useAuth();
  const token = accessToken ?? '';
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [document, setDocument] = useState<File | null>(null);
  const [selectedPoLine, setSelectedPoLine] = useState<PoSearchLine | null>(null);
  const [fallbackItemCode, setFallbackItemCode] = useState('');
  const [requestedQty, setRequestedQty] = useState<string>('');
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const { data: projectsData } = useQuery({
    queryKey: ['projects', 'for-pr'],
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

  const projects = useMemo(() => (projectsData?.projects ?? []) as Project[], [projectsData]);
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);
  const selectedPo = useMemo(() => linkedPurchaseOrder(selectedProject), [selectedProject]);
  const availableBudget = useMemo(() => availableBudgetForProject(selectedProject), [selectedProject]);
  const hasProjectPo = Boolean(selectedProject?.po_id);
  const duplicateItemKey = (
    selectedPoLine?.item_code?.trim().toLowerCase() ||
    fallbackItemCode.trim().toLowerCase() ||
    ''
  ).trim();

  const lineDrivesAmount = Boolean(
    selectedPoLine != null && Number.isFinite(Number(selectedPoLine.unit_price)) && Number(selectedPoLine.unit_price) > 0,
  );

  const qtyNum = useMemo(() => {
    const q = Number(String(requestedQty).trim());
    return Number.isFinite(q) && q > 0 ? q : 0;
  }, [requestedQty]);

  const computedAmount = useMemo(() => {
    if (!lineDrivesAmount || !selectedPoLine || qtyNum <= 0) return null;
    const up = Number(selectedPoLine.unit_price);
    if (!(up > 0)) return null;
    return Math.round(qtyNum * up * 100) / 100;
  }, [lineDrivesAmount, selectedPoLine, qtyNum]);

  /** Amount used for validation, submission, and PO line checks (backend recomputes when line + qty). */
  const effectiveAmount = useMemo(() => {
    if (!hasProjectPo) {
      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    }
    if (!selectedPoLine) return 0;
    if (lineDrivesAmount) {
      return computedAmount != null && computedAmount > 0 ? computedAmount : 0;
    }
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }, [hasProjectPo, selectedPoLine, lineDrivesAmount, computedAmount, amount]);

  const isOverBudgetNoPo =
    !hasProjectPo &&
    availableBudget != null &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount > availableBudget;

  const exceedsLineBudget =
    hasProjectPo &&
    selectedPoLine != null &&
    effectiveAmount > 0 &&
    effectiveAmount > selectedPoLine.effective_remaining;

  const descriptionTrimmed = description.trim();
  const descriptionInvalid = descriptionTrimmed.length < 10;

  const { data: duplicateCountData } = useQuery({
    queryKey: ['purchase-requests', 'duplicate-count', duplicateItemKey],
    enabled: !!token && !!supabase && duplicateItemKey.length > 0,
    queryFn: async () => {
      try {
        const params = new URLSearchParams({ item_code: duplicateItemKey });
        return await authedFetchWithSupabase<{ previousCount: number }>(
          supabase!,
          `/api/purchase-requests/item-duplicate-count?${params.toString()}`,
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const previousSameItemCount = duplicateCountData?.previousCount ?? 0;
  const nextOccurrence = previousSameItemCount + 1;
  const showDuplicateHighlight = duplicateItemKey.length > 0 && previousSameItemCount >= 1;
  const duplicateBorderClass = !showDuplicateHighlight
    ? undefined
    : previousSameItemCount >= 3
      ? 'border-red-500'
      : previousSameItemCount >= 2
        ? 'border-orange-500'
        : 'border-amber-400';

  useEffect(() => {
    setDuplicateModalOpen(false);
  }, [duplicateItemKey]);

  useEffect(() => {
    setSelectedPoLine(null);
    setFallbackItemCode('');
    setRequestedQty('');
  }, [projectId]);

  useEffect(() => {
    if (!selectedPoLine) setRequestedQty('');
  }, [selectedPoLine]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!projectId) throw new Error('Select a project');
      if (!description.trim()) throw new Error('Description is required');
      if (description.trim().length < 10) throw new Error('Description must be at least 10 characters');
      if (!effectiveAmount || effectiveAmount <= 0) throw new Error('Amount must be > 0');

      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      let bearer: string;
      try {
        bearer = await getAccessTokenFromSupabaseSession(supabase);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
      const fd = new FormData();
      fd.append('project_id', projectId);
      fd.append('description', description);
      fd.append('amount', String(effectiveAmount));
      if (selectedPoLine) {
        fd.append('po_line_sn', selectedPoLine.po_line_sn);
      } else if (fallbackItemCode.trim()) {
        fd.append('item_code', fallbackItemCode.trim());
      }
      if (selectedPoLine && lineDrivesAmount && qtyNum > 0) {
        fd.append('requested_quantity', String(qtyNum));
      }
      if (document) fd.append('document', document);

      const res = await fetch(`${apiBase}/api/purchase-requests`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        body: fd,
      });
      let body: Record<string, unknown> = {};
      try {
        const json = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
      } catch {
        /* ignore */
      }
      if (!res.ok) throw new ApiError(res.status, body);
      return body;
    },
    onSuccess: () => {
      setError(null);
      setSubmitAttempted(false);
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setProjectId('');
      setDescription('');
      setAmount(0);
      setDocument(null);
      setSelectedPoLine(null);
      setFallbackItemCode('');
      setRequestedQty('');
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'PR creation failed'),
  });

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="Purchase Requests"
          subtitle="Submit new PRs here. Browse all PRs, PDFs, and date filters on Reports."
        />

        <Card className="p-6">
          <h2 className="text-lg font-medium">Create PR</h2>
          <form
            className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitAttempted(true);
              if (descriptionInvalid) {
                setError('Description is required');
                return;
              }
              if (!projectId) {
                setError('Select a project');
                return;
              }
              if (!effectiveAmount || effectiveAmount <= 0) {
                setError(
                  hasProjectPo && selectedPoLine && lineDrivesAmount
                    ? 'Enter a valid quantity (amount is calculated from unit price)'
                    : 'Amount must be greater than 0',
                );
                return;
              }
              if (hasProjectPo && !selectedPoLine) {
                setError('Select an item / PO line for this project');
                return;
              }
              if (isOverBudgetNoPo) return;
              if (hasProjectPo && exceedsLineBudget) return;
              if (duplicateItemKey && previousSameItemCount >= 1) {
                setDuplicateModalOpen(true);
                return;
              }
              mutation.mutate();
            }}
          >
            <div className="md:col-span-2 space-y-2">
              <label className="block text-sm font-medium">Project</label>
              <select
                className="w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 shadow-sm"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">-- Select Project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.status !== 'active'}>
                    {p.name} {p.status !== 'active' ? '(blocked)' : ''}
                  </option>
                ))}
              </select>
              {selectedProject ? (
                <div className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-stone-100/80 dark:bg-stone-800/50 px-3 py-2 text-sm space-y-1">
                  <div className="text-muted-foreground">Available budget for this project</div>
                  {availableBudget != null ? (
                    <div className="font-semibold text-emerald-700 dark:text-emerald-400">{formatPkr(availableBudget)}</div>
                  ) : selectedProject.po_id ? (
                    <div className="text-amber-800 dark:text-amber-200 text-xs">
                      Linked PO details could not be loaded. Refresh the page or open the project from Reports.
                    </div>
                  ) : (
                    <div className="font-semibold text-foreground">{formatPkr(Number(selectedProject.budget))}</div>
                  )}
                  {selectedPo ? (
                    <div className="text-xs text-muted-foreground pt-1 space-y-0.5">
                      <div>Total budget (PO): {formatPkr(selectedPo.total_value)}</div>
                      <div>Remaining budget: {formatPkr(selectedPo.remaining_value)}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {hasProjectPo ? (
              <div
                className={`md:col-span-2 space-y-2 rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-amber-50/50 dark:bg-amber-950/25 p-3 ${duplicateBorderClass ?? ''}`}
              >
                <label className="block text-sm font-medium">Select Item / PO Line</label>
                <PoLineTypeahead
                  projectId={projectId}
                  enabled={hasProjectPo && !!projectId}
                  supabase={supabase}
                  token={token}
                  selectedLine={selectedPoLine}
                  onSelectLine={(line) => {
                    setSelectedPoLine(line);
                    if (line?.description && description.trim().length < 10) {
                      setDescription(line.description);
                    }
                  }}
                />
                {showDuplicateHighlight ? (
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    You have already submitted {previousSameItemCount}{' '}
                    {previousSameItemCount === 1 ? 'request' : 'requests'} for this item code.
                  </p>
                ) : null}
                {hasProjectPo && selectedPoLine && exceedsLineBudget ? (
                  <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                    Exceeds PO limit for this line (remaining after other pending PRs: {formatPkr(selectedPoLine.effective_remaining)}).
                  </p>
                ) : null}
              </div>
            ) : (
              <div className={`md:col-span-2 space-y-2 ${duplicateBorderClass ? `rounded-lg border p-3 ${duplicateBorderClass}` : ''}`}>
                <label className="block text-sm font-medium">Item code (optional, no PO on project)</label>
                <Input
                  value={fallbackItemCode}
                  onChange={(e) => setFallbackItemCode(e.target.value)}
                  placeholder="SKU when project has no linked PO"
                />
                {showDuplicateHighlight ? (
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    You have already submitted {previousSameItemCount}{' '}
                    {previousSameItemCount === 1 ? 'request' : 'requests'} for this item code.
                  </p>
                ) : null}
              </div>
            )}

            {hasProjectPo && selectedPoLine && lineDrivesAmount ? (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Quantity</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={requestedQty}
                    onChange={(e) => setRequestedQty(e.target.value)}
                    placeholder="Units to order"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Unit price</label>
                  <div className="rounded-lg border border-stone-200/90 dark:border-stone-600/70 bg-stone-100/80 dark:bg-stone-800/50 px-3 py-2 text-sm text-foreground">
                    {formatPkr(Number(selectedPoLine.unit_price))}
                  </div>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-sm font-medium">Amount (quantity × unit price)</label>
                  <Input
                    type="number"
                    value={computedAmount ?? ''}
                    readOnly
                    disabled
                    className="opacity-90 cursor-not-allowed bg-stone-100 dark:bg-stone-800/60"
                  />
                  {computedAmount == null && requestedQty.trim() ? (
                    <p className="text-xs text-muted-foreground">Enter a quantity greater than 0.</p>
                  ) : null}
                </div>
              </>
            ) : hasProjectPo && selectedPoLine && !lineDrivesAmount ? (
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Amount</label>
                <p className="text-xs text-amber-800 dark:text-amber-200 mb-1">
                  This line has no unit price — enter the total amount manually.
                </p>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min={0}
                  step="0.01"
                />
              </div>
            ) : !hasProjectPo ? (
              <div className="md:col-span-2 space-y-2">
                <label className="block text-sm font-medium">Amount</label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  min={0}
                  step="0.01"
                />
              </div>
            ) : (
              <p className="md:col-span-2 text-sm text-muted-foreground">
                Select a PO line to enter quantity and amount.
              </p>
            )}

            <div className="md:col-span-2 space-y-2">
              <label className="block text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={submitAttempted && descriptionInvalid ? 'border-rose-500 focus:ring-rose-500/70 focus:border-rose-400/70' : undefined}
                required
              />
              {submitAttempted && descriptionInvalid ? (
                <p className="text-sm text-rose-600 dark:text-rose-400">Description is required (minimum 10 characters).</p>
              ) : null}
            </div>

            {isOverBudgetNoPo ? (
              <div className="md:col-span-2">
                <p className="text-sm font-medium text-rose-600">
                  This exceeds the available budget ({formatPkr(availableBudget!)}). Reduce the amount or pick another
                  project.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="block text-sm font-medium">Upload Document (Optional)</label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
                onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                className="file:mr-4 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-orange-500 file:to-rose-500 file:px-3 file:py-2 file:text-sm file:text-white hover:file:brightness-110"
              />
            </div>

          {error ? <div className="md:col-span-2 text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}

            <Button
              className="md:col-span-2"
              disabled={
                mutation.isPending ||
                descriptionInvalid ||
                isOverBudgetNoPo ||
                (hasProjectPo &&
                  (!selectedPoLine || exceedsLineBudget || effectiveAmount <= 0))
              }
              type="submit"
            >
              {mutation.isPending ? 'Submitting...' : 'Submit PR'}
            </Button>
          </form>
        </Card>
        {duplicateModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 dark:bg-stone-950/55 backdrop-blur-[2px] p-4">
            <Card className="max-w-md w-full p-6 space-y-4 border border-amber-500/40 shadow-xl">
              <h3 className="text-lg font-medium text-amber-900 dark:text-amber-100">Duplicate item</h3>
              <p className="text-sm text-foreground/90">
                You are requesting this item for the {ordinalTimeWord(nextOccurrence)} time.
              </p>
              <p className="text-xs text-muted-foreground">
                Continue only if you intend to order this same item again.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setDuplicateModalOpen(false)}>
                  Go back
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setDuplicateModalOpen(false);
                    mutation.mutate();
                  }}
                  disabled={mutation.isPending}
                >
                  Continue to submit
                </Button>
              </div>
            </Card>
          </div>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}

