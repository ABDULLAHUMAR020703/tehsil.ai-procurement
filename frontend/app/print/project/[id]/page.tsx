'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../features/auth/AuthProvider';
import { authedFetchWithSupabase, NoSessionError } from '../../../../lib/api';
import type { PrintProjectDetailResponse } from '../../../../lib/printDocumentTypes';
import { PrintDocumentStyles } from '../../../../components/print/PrintDocumentStyles';
import { PrintProjectSheet } from '../../../../components/print/PrintProjectSheet';

export default function PrintProjectPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { supabase, profile } = useAuth();
  const id = params?.id ?? '';
  const canPrint = profile?.role === 'admin' || profile?.role === 'pm';
  const printedRef = useRef(false);

  const { data, isLoading, error } = useQuery({
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
  });

  useEffect(() => {
    if (!data?.project || printedRef.current) return;
    printedRef.current = true;
    document.title = `Tehsil — Project ${id.slice(0, 8)}`;
    const t = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(t);
  }, [data, id]);

  const outer = 'print-page-root relative min-h-screen bg-gray-100 py-6 text-gray-800 print:py-0 print:bg-white';

  if (!canPrint) {
    return (
      <div className={outer}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-gray-600">
          Print is only available to administrators and project managers.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={outer}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-600 shadow-sm print:shadow-none print:border-0">
          Loading…
        </div>
      </div>
    );
  }

  if (error || !data?.project) {
    return (
      <div className={outer}>
        <PrintDocumentStyles />
        <div className="mx-auto max-w-[800px] bg-white p-8 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Could not load project.'}
        </div>
      </div>
    );
  }

  return (
    <div className={outer}>
      <PrintDocumentStyles />
      <PrintProjectSheet data={data} />
    </div>
  );
}
