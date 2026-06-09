'use client';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  formatProcessingDuration,
  formatUploadBytes,
  PO_UPLOAD_STAGE_LABELS,
  PO_UPLOAD_STAGES,
  type PoUploadProgressUpdate,
  type PoUploadStage,
} from '@/lib/poUploadClient';

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
  failed?: number;
  cancelled?: number;
  missingCancelled?: number;
  explicitCancelled?: number;
  dashRows?: number;
  totalActivePos?: number;
  totalCancelledPos?: number;
  cancelledPos?: string[];
  cancelledAt?: string;
  failures?: string[];
  warnings?: string[];
};

type ProgressProps = {
  fileName: string;
  progress: PoUploadProgressUpdate;
};

export function PoUploadProgressPanel({ fileName, progress }: ProgressProps) {
  const isUploadPhase = progress.phase === 'upload';
  const percent = isUploadPhase ? progress.uploadPercent : 100;
  const currentStage: PoUploadStage = progress.processingStage;

  return (
    <Card className="p-4 border border-orange-200/80 dark:border-orange-800/50 bg-orange-50/40 dark:bg-orange-950/20 space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
          {isUploadPhase ? 'Uploading procurement file…' : 'Processing procurement file…'}
        </div>
        <div className="text-xs text-muted-foreground truncate">{fileName}</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{PO_UPLOAD_STAGE_LABELS[currentStage]}</span>
          <span className="tabular-nums font-medium text-stone-800 dark:text-stone-200">{percent}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-stone-200/80 dark:bg-stone-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        {isUploadPhase && progress.totalBytes > 0 ? (
          <div className="text-xs text-muted-foreground tabular-nums">
            {formatUploadBytes(progress.loadedBytes)} / {formatUploadBytes(progress.totalBytes)}
          </div>
        ) : null}
      </div>

      <ol className="space-y-1.5 text-xs">
        {PO_UPLOAD_STAGES.map((stage) => {
          const idx = PO_UPLOAD_STAGES.indexOf(stage);
          const currentIdx = PO_UPLOAD_STAGES.indexOf(currentStage);
          const done = idx < currentIdx || (!isUploadPhase && stage === 'uploading');
          const active = stage === currentStage;
          return (
            <li
              key={stage}
              className={`flex items-center gap-2 ${
                active
                  ? 'text-orange-800 dark:text-orange-300 font-medium'
                  : done
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-muted-foreground'
              }`}
            >
              <span
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                  active
                    ? 'bg-orange-500 text-white animate-pulse'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-stone-300 dark:bg-stone-600'
                }`}
              >
                {done ? '✓' : idx + 1}
              </span>
              {PO_UPLOAD_STAGE_LABELS[stage]}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

type ErrorPanelProps = {
  fileName: string;
  timestamp: Date;
  title: string;
  message: string;
  errorType?: string;
  errorCode?: string;
  failures?: string[];
  onRetry: () => void;
  retryDisabled?: boolean;
};

export function PoUploadErrorPanel({
  fileName,
  timestamp,
  title,
  message,
  errorType,
  errorCode,
  failures,
  onRetry,
  retryDisabled,
}: ErrorPanelProps) {
  return (
    <Card className="p-4 border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 space-y-3">
      <div>
        <div className="text-sm font-semibold text-rose-900 dark:text-rose-200">{title}</div>
        <div className="text-xs text-rose-800/80 dark:text-rose-300/80 mt-1">
          {timestamp.toLocaleString()} · {fileName}
        </div>
      </div>

      <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-white/60 dark:bg-stone-900/40 p-3 space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-rose-800 dark:text-rose-300">
          Reason
        </div>
        <pre className="whitespace-pre-wrap text-sm text-rose-900 dark:text-rose-100 font-sans">{message}</pre>
        {errorType || errorCode ? (
          <div className="text-xs text-rose-800/90 dark:text-rose-300/90 space-x-3">
            {errorType ? <span>Type: {errorType}</span> : null}
            {errorCode ? <span>Code: {errorCode}</span> : null}
          </div>
        ) : null}
        {failures && failures.length > 0 ? (
          <div className="pt-2 border-t border-rose-200/80 dark:border-rose-800/80">
            <div className="text-xs font-medium text-rose-800 dark:text-rose-300 mb-1">Row failures</div>
            <ul className="text-xs text-rose-900 dark:text-rose-100 space-y-0.5 list-disc pl-4">
              {failures.slice(0, 8).map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Button type="button" variant="secondary" className="w-full" disabled={retryDisabled} onClick={onRetry}>
        Retry Upload
      </Button>
    </Card>
  );
}

type SuccessProps = {
  fileName: string;
  processingTimeMs: number;
  result: UploadResult;
};

export function PoUploadSuccessSummary({ fileName, processingTimeMs, result }: SuccessProps) {
  return (
    <Card className="p-4 mt-2 border border-emerald-200 dark:border-emerald-700/80 bg-emerald-50 dark:bg-emerald-950/35 space-y-3 shadow-sm">
      <div>
        <div className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Upload complete</div>
        <div className="text-xs text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
          {fileName} · {formatProcessingDuration(processingTimeMs)}
        </div>
      </div>

      <ul className="text-sm text-emerald-900 dark:text-emerald-200 space-y-1 list-disc pl-5">
        <li>Total rows in file: {result.totalRows ?? '—'}</li>
        <li>Unique rows processed: {result.uniqueRowsProcessed ?? result.totalRows ?? '—'}</li>
        <li>Inserted records: {result.inserted ?? 0}</li>
        <li>Updated records: {result.updated ?? 0}</li>
        {(result.duplicateRowsSkipped ?? 0) > 0 ? (
          <li>Duplicate rows skipped: {result.duplicateRowsSkipped}</li>
        ) : null}
        {(result.reactivated ?? 0) > 0 ? (
          <li>Reactivated (previously cancelled): {result.reactivated}</li>
        ) : null}
        {(result.cancelled ?? 0) > 0 ? (
          <li>
            Cancelled (missing from latest file): {result.missingCancelled ?? result.cancelled}
          </li>
        ) : null}
        {(result.explicitCancelled ?? 0) > 0 ? (
          <li>Explicitly cancelled in file: {result.explicitCancelled}</li>
        ) : null}
        <li>Failed records: {result.failed ?? 0}</li>
        <li>Processing time: {formatProcessingDuration(processingTimeMs)}</li>
        {result.totalActivePos != null ? <li>Total active POs in system: {result.totalActivePos}</li> : null}
      </ul>

      {result.failures && result.failures.length > 0 ? (
        <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-medium mb-1">Partial row failures</div>
          {result.failures.join('\n')}
        </div>
      ) : null}
      {result.warnings && result.warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50/80 dark:bg-amber-950/40 p-3 text-xs text-amber-950 dark:text-amber-100">
          {result.warnings.join('\n')}
        </div>
      ) : null}
    </Card>
  );
}
