'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useAuth } from '../../../features/auth/AuthProvider';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { authedUploadFetch, NoSessionError } from '../../../lib/api';

type UploadResult = {
  ok?: boolean;
  mode?: string;
  uploadBatchId?: string;
  totalRows?: number;
  uniqueRowsProcessed?: number;
  duplicateRowsSkipped?: number;
  inserted?: number;
  updated?: number;
  reactivated?: number;
  activeInserted?: number;
  activeUpdated?: number;
  failed?: number;
  explicitCancelled?: number;
  dashRows?: number;
  cancelled?: number;
  missingCancelled?: number;
  totalActivePos?: number;
  totalCancelledPos?: number;
  cancelledPos?: string[];
  cancelledAt?: string;
  skipped?: number;
  duplicatesHandled?: string[];
  failures?: string[];
  warnings?: string[];
};

export default function PoUploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, supabase } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastSelectedFileName, setLastSelectedFileName] = useState<string | null>(null);

  const poUploadDraft = useMemo(
    () => ({ lastSelectedFileName: file?.name ?? lastSelectedFileName }),
    [file?.name, lastSelectedFileName],
  );
  const { restore: restorePoUploadDraft, clear: clearPoUploadDraft } = useFormDraft(
    'po-upload-meta',
    profile?.userId,
    poUploadDraft,
  );

  useEffect(() => {
    if (!profile?.userId) return;
    const saved = restorePoUploadDraft();
    if (saved?.lastSelectedFileName && typeof saved.lastSelectedFileName === 'string') {
      setLastSelectedFileName(saved.lastSelectedFileName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.userId]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError('Please select a CSV/XLSX file.');
      return;
    }
    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase is not configured');
      const fd = new FormData();
      fd.append('file', file);
      const json = await authedUploadFetch<UploadResult>(supabase, '/api/po/upload', fd);
      setResult(json);
      clearPoUploadDraft();
      setLastSelectedFileName(null);
      await queryClient.invalidateQueries({ queryKey: ['po'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      if (err instanceof NoSessionError) {
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const role = profile?.role;
  const canUpload = role === 'admin' || role === 'platform_admin' || role === 'pm' || role === 'dept_head';

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="PO Upload"
          subtitle="All rows import by default. Empty, blank, “-”, and N/A cells are treated as missing data—not errors. A row is cancelled only when a cell explicitly says “PO Cancelled”. Supports line-item exports and the full template with flexible column names."
        />

        {!canUpload ? (
          <Card className="p-4 text-sm text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/35">
            Only admins and PMs can upload purchase orders.
          </Card>
        ) : (
          <Card className="p-6 border-orange-200/60 dark:border-orange-800/40 bg-gradient-to-br from-[var(--surface)] to-orange-50/30 dark:from-stone-900 dark:to-orange-950/20">
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-800 dark:text-stone-200">Select File</label>
                <Input
                  className="file:mr-4 file:rounded-lg file:border-0 file:bg-gradient-to-r file:from-orange-500 file:to-rose-500 file:px-3 file:py-2 file:text-sm file:text-white hover:file:brightness-110 file:cursor-pointer file:shadow-sm"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const next = e.target.files?.[0] ?? null;
                    setFile(next);
                    if (next) setLastSelectedFileName(next.name);
                  }}
                />
                {lastSelectedFileName && !file ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Previously selected: {lastSelectedFileName} — re-select the file to upload.
                  </p>
                ) : null}
              </div>

              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? 'Uploading...' : 'Upload'}
              </Button>

              {error ? (
                <pre className="whitespace-pre-wrap rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/35 p-3 text-sm text-rose-700 dark:text-rose-300 font-sans">
                  {error}
                </pre>
              ) : null}

              {result?.ok ? (
                <Card className="p-4 mt-2 border border-emerald-200 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/35 space-y-2 shadow-sm">
                  <div className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Upload summary</div>
                  <ul className="text-sm text-emerald-900 dark:text-emerald-200 space-y-1 list-disc pl-5">
                    <li>Total rows in file: {result.totalRows ?? '-'}</li>
                    <li>Unique rows processed: {result.uniqueRowsProcessed ?? result.totalRows ?? '-'}</li>
                    {(result.duplicateRowsSkipped ?? 0) > 0 ? (
                      <li>Duplicate rows skipped: {result.duplicateRowsSkipped}</li>
                    ) : null}
                    <li>New PO lines inserted: {result.inserted ?? 0}</li>
                    <li>Existing PO lines updated: {result.updated ?? 0}</li>
                    {(result.reactivated ?? 0) > 0 ? (
                      <li>Previously cancelled PO lines reactivated: {result.reactivated}</li>
                    ) : null}
                    <li>Active lines added: {result.activeInserted ?? 0}</li>
                    <li>Active lines updated: {result.activeUpdated ?? 0}</li>
                    <li>Failed: {result.failed ?? 0}</li>
                    {result.explicitCancelled != null ? (
                      <li>Cancelled POs detected in file: {result.explicitCancelled}</li>
                    ) : null}
                    {result.dashRows != null ? <li>Rows containing "-": {result.dashRows}</li> : null}
                    {result.mode === 'line_items' && (result.cancelled ?? 0) > 0 ? (
                      <li className="text-amber-700 dark:text-amber-400">
                        PO lines marked cancelled (missing from latest upload): {result.missingCancelled ?? result.cancelled}
                      </li>
                    ) : null}
                    {result.totalActivePos != null ? <li>Total active POs: {result.totalActivePos}</li> : null}
                    {result.totalCancelledPos != null ? <li>Total cancelled POs: {result.totalCancelledPos}</li> : null}
                    {result.mode === 'legacy_vendor' && result.skipped != null ? (
                      <li>Vendor merge (extra rows): {result.skipped}</li>
                    ) : null}
                  </ul>
                  {result.mode === 'line_items' && result.cancelledPos && result.cancelledPos.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
                      <div className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                        Cancelled on {result.cancelledAt
                          ? new Date(result.cancelledAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                          : 'this upload'}
                      </div>
                      <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-0.5 list-disc pl-4">
                        {result.cancelledPos.map((po) => (
                          <li key={po}>{po}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {result.mode === 'legacy_vendor' && result.duplicatesHandled && result.duplicatesHandled.length > 0 ? (
                    <div className="text-xs text-emerald-800/90 dark:text-emerald-300/90">
                      Vendors merged: {result.duplicatesHandled.join(', ')}
                    </div>
                  ) : null}
                  {result.failures && result.failures.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                      {result.failures.join('\n')}
                    </div>
                  ) : null}
                  {result.warnings && result.warnings.length > 0 ? (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-950/40 p-3 text-xs text-amber-950 dark:text-amber-100">
                      {result.warnings.join('\n')}
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </form>
          </Card>
        )}
      </PageContainer>
    </AppLayout>
  );
}
