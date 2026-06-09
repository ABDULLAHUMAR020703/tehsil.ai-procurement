'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import {
  PoUploadErrorPanel,
  PoUploadProgressPanel,
  PoUploadSuccessSummary,
} from '../../../components/po/PoUploadFeedback';
import { useAuth } from '../../../features/auth/AuthProvider';
import { useFormDraft } from '../../../hooks/useFormDraft';
import { NoSessionError } from '../../../lib/api';
import {
  describePoUploadError,
  PoUploadError,
  uploadPoFile,
  type PoUploadProgressUpdate,
} from '../../../lib/poUploadClient';

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

type UploadPhase = 'idle' | 'running' | 'success' | 'error';

const INITIAL_PROGRESS: PoUploadProgressUpdate = {
  phase: 'upload',
  uploadPercent: 0,
  loadedBytes: 0,
  totalBytes: 0,
  processingStage: 'uploading',
};

export default function PoUploadPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile, supabase } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState<PoUploadProgressUpdate>(INITIAL_PROGRESS);
  const [errorInfo, setErrorInfo] = useState<ReturnType<typeof describePoUploadError> | null>(null);
  const [errorTimestamp, setErrorTimestamp] = useState<Date | null>(null);
  const [errorFileName, setErrorFileName] = useState<string | null>(null);
  const [processingTimeMs, setProcessingTimeMs] = useState<number | null>(null);
  const [successFileName, setSuccessFileName] = useState<string | null>(null);
  const [lastSelectedFileName, setLastSelectedFileName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const resetFeedback = useCallback(() => {
    setResult(null);
    setErrorInfo(null);
    setErrorTimestamp(null);
    setErrorFileName(null);
    setProcessingTimeMs(null);
    setSuccessFileName(null);
    setProgress(INITIAL_PROGRESS);
  }, []);

  const runUpload = useCallback(
    async (uploadFile: File) => {
      resetFeedback();
      setPhase('running');
      setProgress(INITIAL_PROGRESS);

      const startedAt = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (!supabase) throw new PoUploadError('Supabase is not configured.', 'network');
        const fd = new FormData();
        fd.append('file', uploadFile);

        const json = await uploadPoFile<UploadResult>({
          supabase,
          formData: fd,
          onProgress: (update) => setProgress(update),
          signal: controller.signal,
        });

        const elapsed = Date.now() - startedAt;
        setProcessingTimeMs(elapsed);
        setSuccessFileName(uploadFile.name);
        setResult(json);
        setPhase('success');
        clearPoUploadDraft();
        setLastSelectedFileName(null);
        await queryClient.invalidateQueries({ queryKey: ['po'] });
        await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      } catch (err) {
        if (err instanceof NoSessionError) {
          setPhase('idle');
          router.replace('/login');
          return;
        }
        const described = describePoUploadError(err);
        console.error('[po_upload] failed', {
          kind: err instanceof PoUploadError ? err.kind : 'unknown',
          message: described.message,
          errorType: described.errorType,
          errorCode: described.errorCode,
          failures: described.failures,
        });
        setErrorInfo(described);
        setErrorTimestamp(new Date());
        setErrorFileName(uploadFile.name);
        setPhase('error');
      } finally {
        abortRef.current = null;
      }
    },
    [clearPoUploadDraft, queryClient, resetFeedback, router, supabase],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setPhase('error');
      setErrorInfo({
        title: 'No File Selected',
        message: 'Please select a CSV or XLSX file before uploading.',
      });
      setErrorTimestamp(new Date());
      setErrorFileName('—');
      return;
    }
    await runUpload(file);
  };

  const onRetry = () => {
    if (file) void runUpload(file);
  };

  const role = profile?.role;
  const canUpload = role === 'admin' || role === 'platform_admin' || role === 'pm' || role === 'dept_head';
  const isRunning = phase === 'running';

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
                  disabled={isRunning}
                  onChange={(e) => {
                    const next = e.target.files?.[0] ?? null;
                    setFile(next);
                    if (next) setLastSelectedFileName(next.name);
                    if (phase === 'error') {
                      setPhase('idle');
                      resetFeedback();
                    }
                  }}
                />
                {lastSelectedFileName && !file ? (
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Previously selected: {lastSelectedFileName} — re-select the file to upload.
                  </p>
                ) : null}
              </div>

              <Button className="w-full" type="submit" disabled={isRunning || !file}>
                {isRunning ? 'Upload in progress…' : 'Upload'}
              </Button>

              {isRunning && file ? (
                <PoUploadProgressPanel fileName={file.name} progress={progress} />
              ) : null}

              {phase === 'error' && errorInfo && errorTimestamp ? (
                <PoUploadErrorPanel
                  fileName={errorFileName ?? file?.name ?? 'Unknown file'}
                  timestamp={errorTimestamp}
                  title={errorInfo.title}
                  message={errorInfo.message}
                  errorType={errorInfo.errorType}
                  errorCode={errorInfo.errorCode}
                  failures={errorInfo.failures}
                  onRetry={onRetry}
                  retryDisabled={!file || isRunning}
                />
              ) : null}

              {phase === 'success' && result?.ok && successFileName && processingTimeMs != null ? (
                <PoUploadSuccessSummary
                  fileName={successFileName}
                  processingTimeMs={processingTimeMs}
                  result={result}
                />
              ) : null}
            </form>
          </Card>
        )}
      </PageContainer>
    </AppLayout>
  );
}
