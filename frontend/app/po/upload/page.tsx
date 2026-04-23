'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { useAuth } from '../../../features/auth/AuthProvider';
import { getAccessTokenFromSupabaseSession, NoSessionError } from '../../../lib/api';

type UploadResult = {
  ok?: boolean;
  mode?: string;
  totalRows?: number;
  inserted?: number;
  updated?: number;
  failed?: number;
  skipped?: number;
  duplicatesHandled?: string[];
};

export default function PoUploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, supabase } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      let bearer: string;
      try {
        bearer = await getAccessTokenFromSupabaseSession(supabase);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${apiBase}/api/po/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as UploadResult & { message?: string };
      if (!res.ok) throw new Error(json.message ?? 'Upload failed');
      setResult(json);
      await queryClient.invalidateQueries({ queryKey: ['po'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const role = profile?.role;
  const canUpload = role === 'admin' || role === 'pm' || role === 'dept_head';

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader
          title="PO Upload"
          subtitle="Line items: PO, Item Code, Description, Unit Price, PO Amount, PO+LINE+SN (CSV/XLSX). Optional columns Project Name and Department (or Department name) are stored and used to prefill new projects. Admins may also use legacy columns: po_number, vendor, total_value."
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
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? 'Uploading...' : 'Upload'}
              </Button>

              {error ? (
                <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
              ) : null}

              {result?.ok ? (
                <Card className="p-4 mt-2 border border-emerald-200 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/35 space-y-2 shadow-sm">
                  <div className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Upload summary</div>
                  <ul className="text-sm text-emerald-900 dark:text-emerald-200 space-y-1 list-disc pl-5">
                    <li>Total rows: {result.totalRows ?? '—'}</li>
                    <li>Inserted: {result.inserted ?? 0}</li>
                    <li>Updated: {result.updated ?? 0}</li>
                    <li>Failed: {result.failed ?? 0}</li>
                    {result.mode === 'legacy_vendor' && result.skipped != null ? (
                      <li>Vendor merge (extra rows): {result.skipped}</li>
                    ) : null}
                  </ul>
                  {result.mode === 'legacy_vendor' && result.duplicatesHandled && result.duplicatesHandled.length > 0 ? (
                    <div className="text-xs text-emerald-800/90 dark:text-emerald-300/90">
                      Vendors merged: {result.duplicatesHandled.join(', ')}
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
