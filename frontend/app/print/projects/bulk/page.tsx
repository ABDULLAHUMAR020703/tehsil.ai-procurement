'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries } from '@tanstack/react-query';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { authedFetchWithSupabase, NoSessionError } from '../../../../lib/api';
import type { PrintProjectDetailResponse } from '../../../../lib/printDocumentTypes';
import { PrintDocumentStyles } from '../../../../components/print/PrintDocumentStyles';
import { PrintProjectSheet } from '../../../../components/print/PrintProjectSheet';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_IDS = 40;

function parseIdsParam(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (!UUID_RE.test(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

function BulkPrintProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { supabase, profile } = useAuth();
  const canPrint = profile?.role === 'admin' || profile?.role === 'pm';
  const printedRef = useRef(false);

  const ids = useMemo(() => parseIdsParam(searchParams.get('ids')), [searchParams]);

  const queries = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['print-project', id],
      enabled: Boolean(supabase && id && canPrint),
      queryFn: async () => {
        try {
          return await authedFetchWithSupabase<PrintProjectDetailResponse>(
            supabase!,
            `/api/projects/${id}?include=related_prs`,
          );
        } catch (e) {
          if (e instanceof NoSessionError) router.replace('/login');
          throw e;
        }
      },
    })),
  });

  const loading = ids.length > 0 && queries.some((q) => q.isPending || q.isFetching);
  const allSettled = ids.length > 0 && queries.every((q) => !q.isPending && !q.isFetching);

  useEffect(() => {
    if (!allSettled || printedRef.current || ids.length === 0) return;
    printedRef.current = true;
    document.title = `Tehsil — Projects (${ids.length})`;
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, [allSettled, ids.length]);

  const outer = 'print-page-root bg-gray-100 py-6 text-gray-800 print:py-0 print:bg-white';

  if (!canPrint) {
    return (
      <div className={`${outer} min-h-screen`}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-gray-600">
          Print is only available to administrators and project managers.
        </div>
      </div>
    );
  }

  if (ids.length === 0) {
    return (
      <div className={`${outer} min-h-screen`}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-gray-600">
          No valid project IDs. Add <span className="font-mono text-gray-800">?ids=uuid,uuid</span> to the URL.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${outer} min-h-screen`}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600 shadow-sm print:shadow-none print:border-0">
          Loading {ids.length} project{ids.length === 1 ? '' : 's'}…
        </div>
      </div>
    );
  }

  return (
    <div className={outer}>
      <PrintDocumentStyles />
      {ids.map((id, i) => {
        const q = queries[i];
        const isLast = i === ids.length - 1;
        const pageClass = `print-bundle-page relative min-h-screen py-6 print:py-4 ${isLast ? 'print-bundle-page-last' : ''}`;

        if (q?.error || !q?.data?.project) {
          return (
            <div key={id} className={pageClass}>
              <div className="mx-auto max-w-[800px] rounded-lg border border-red-200 bg-white p-8 text-sm text-red-700 shadow-sm">
                Could not load project <span className="font-mono">{id}</span>
                {q?.error instanceof Error ? `: ${q.error.message}` : '.'}
              </div>
            </div>
          );
        }

        return (
          <div key={id} className={pageClass}>
            <PrintProjectSheet data={q.data} showPrintHint={false} />
          </div>
        );
      })}
      <p className="no-print mx-auto mt-4 max-w-[800px] rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-center text-xs text-gray-600">
        One print / PDF: {ids.length} page{ids.length === 1 ? '' : 's'}. Choose{' '}
        <span className="font-semibold text-gray-800">Save as PDF</span> in the print dialog.
      </p>
    </div>
  );
}

export default function BulkPrintProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="print-page-root min-h-screen bg-gray-100 py-6 text-gray-800">
          <PrintDocumentStyles />
          <div className="mx-auto max-w-[800px] rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600 shadow-sm">
            Loading…
          </div>
        </div>
      }
    >
      <BulkPrintProjectsContent />
    </Suspense>
  );
}
