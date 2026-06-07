import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ApiError,
  formatApiErrorMessage,
  getAccessTokenFromSupabaseSession,
  NoSessionError,
} from './api';

const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

/** Default 15 minutes — large procurement XLSX + cold backend. */
export const PO_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export const PO_UPLOAD_STAGES = [
  'uploading',
  'parsing',
  'validating',
  'processing',
  'synchronizing',
  'finalizing',
] as const;

export type PoUploadStage = (typeof PO_UPLOAD_STAGES)[number];

export const PO_UPLOAD_STAGE_LABELS: Record<PoUploadStage, string> = {
  uploading: 'Uploading File',
  parsing: 'Parsing File',
  validating: 'Validating Data',
  processing: 'Processing Purchase Orders',
  synchronizing: 'Synchronizing Records',
  finalizing: 'Finalizing Upload',
};

export type PoUploadProgressUpdate = {
  phase: 'upload' | 'processing';
  uploadPercent: number;
  loadedBytes: number;
  totalBytes: number;
  processingStage: PoUploadStage;
};

export type PoUploadErrorKind = 'network' | 'timeout' | 'api' | 'session' | 'aborted';

export class PoUploadError extends Error {
  readonly kind: PoUploadErrorKind;
  readonly status?: number;
  readonly errorType?: string;
  readonly errorCode?: string;
  readonly failures?: string[];
  readonly body?: Record<string, unknown>;

  constructor(
    message: string,
    kind: PoUploadErrorKind,
    extra?: {
      status?: number;
      errorType?: string;
      errorCode?: string;
      failures?: string[];
      body?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = 'PoUploadError';
    this.kind = kind;
    this.status = extra?.status;
    this.errorType = extra?.errorType;
    this.errorCode = extra?.errorCode;
    this.failures = extra?.failures;
    this.body = extra?.body;
  }
}

export function formatUploadBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatProcessingDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function parseErrorBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const json = JSON.parse(raw) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) return json as Record<string, unknown>;
  } catch {
    return { message: raw.trim() };
  }
  return {};
}

function apiErrorFromBody(status: number, body: Record<string, unknown>): PoUploadError {
  const apiErr = new ApiError(status, body);
  const failures = Array.isArray(body.failures)
    ? body.failures.filter((f): f is string => typeof f === 'string')
    : undefined;
  return new PoUploadError(apiErr.message, 'api', {
    status,
    errorType: typeof body.errorType === 'string' ? body.errorType : undefined,
    errorCode:
      typeof body.errorCode === 'string'
        ? body.errorCode
        : typeof body.code === 'string'
          ? body.code
          : undefined,
    failures,
    body,
  });
}

const PROCESSING_STAGE_ORDER: PoUploadStage[] = [
  'parsing',
  'validating',
  'processing',
  'synchronizing',
  'finalizing',
];

/**
 * Multipart PO upload with XHR upload progress, simulated processing stages while awaiting response,
 * timeout, and structured errors.
 */
export async function uploadPoFile<T>(params: {
  supabase: SupabaseClient | null;
  formData: FormData;
  path?: string;
  timeoutMs?: number;
  onProgress?: (update: PoUploadProgressUpdate) => void;
  signal?: AbortSignal;
}): Promise<T> {
  const { supabase, formData, path = '/api/po/upload', timeoutMs = PO_UPLOAD_TIMEOUT_MS, onProgress, signal } =
    params;

  let token: string;
  try {
    token = await getAccessTokenFromSupabaseSession(supabase);
  } catch (e) {
    if (e instanceof NoSessionError) {
      throw new PoUploadError(e.message, 'session');
    }
    throw e;
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stageTimer: ReturnType<typeof setInterval> | null = null;
    let stageIndex = 0;
    let uploadComplete = false;

    const cleanup = () => {
      if (stageTimer) clearInterval(stageTimer);
      stageTimer = null;
      signal?.removeEventListener('abort', onAbort);
    };

    const emit = (update: PoUploadProgressUpdate) => {
      onProgress?.(update);
    };

    const startProcessingStages = () => {
      if (uploadComplete) return;
      uploadComplete = true;
      emit({
        phase: 'processing',
        uploadPercent: 100,
        loadedBytes: 0,
        totalBytes: 0,
        processingStage: 'parsing',
      });
      stageIndex = 0;
      stageTimer = setInterval(() => {
        if (stageIndex < PROCESSING_STAGE_ORDER.length - 1) {
          stageIndex += 1;
          emit({
            phase: 'processing',
            uploadPercent: 100,
            loadedBytes: 0,
            totalBytes: 0,
            processingStage: PROCESSING_STAGE_ORDER[stageIndex]!,
          });
        }
      }, 2200);
    };

    const onAbort = () => {
      cleanup();
      xhr.abort();
      reject(new PoUploadError('Upload cancelled.', 'aborted'));
    };

    signal?.addEventListener('abort', onAbort);

    xhr.open('POST', `${backendBase}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = timeoutMs;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const uploadPercent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        emit({
          phase: 'upload',
          uploadPercent,
          loadedBytes: event.loaded,
          totalBytes: event.total,
          processingStage: 'uploading',
        });
      } else {
        emit({
          phase: 'upload',
          uploadPercent: 0,
          loadedBytes: event.loaded,
          totalBytes: 0,
          processingStage: 'uploading',
        });
      }
    };

    xhr.upload.onload = () => {
      startProcessingStages();
    };

    xhr.onload = () => {
      cleanup();
      const body = parseErrorBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      if (body.message == null && xhr.responseText.trim()) {
        body.message = xhr.responseText.trim().slice(0, 2000);
      }
      reject(apiErrorFromBody(xhr.status, body));
    };

    xhr.onerror = () => {
      cleanup();
      reject(
        new PoUploadError(
          'Network error while uploading. Check your connection and try again.',
          'network',
        ),
      );
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(
        new PoUploadError(
          `Upload timed out after ${formatProcessingDuration(timeoutMs)}. The file may still be processing on the server — wait a moment, then check PO records before retrying.`,
          'timeout',
        ),
      );
    };

    xhr.onloadstart = () => {
      emit({
        phase: 'upload',
        uploadPercent: 0,
        loadedBytes: 0,
        totalBytes: 0,
        processingStage: 'uploading',
      });
    };

    try {
      xhr.send(formData);
    } catch (err) {
      cleanup();
      reject(
        new PoUploadError(
          err instanceof Error ? err.message : 'Failed to start upload.',
          'network',
        ),
      );
    }
  });
}

export function describePoUploadError(err: unknown): {
  title: string;
  message: string;
  errorType?: string;
  errorCode?: string;
  failures?: string[];
} {
  if (err instanceof PoUploadError) {
    return {
      title:
        err.kind === 'timeout'
          ? 'Upload Timed Out'
          : err.kind === 'network'
            ? 'Network Error'
            : err.kind === 'session'
              ? 'Session Expired'
              : err.kind === 'aborted'
                ? 'Upload Cancelled'
                : 'Upload Failed',
      message: err.message,
      errorType: err.errorType,
      errorCode: err.errorCode,
      failures: err.failures,
    };
  }
  if (err instanceof ApiError) {
    return {
      title: 'Upload Failed',
      message: err.message,
      errorType: typeof err.body.errorType === 'string' ? err.body.errorType : undefined,
      errorCode:
        typeof err.body.errorCode === 'string'
          ? err.body.errorCode
          : typeof err.body.code === 'string'
            ? err.body.code
            : undefined,
      failures: Array.isArray(err.body.failures)
        ? err.body.failures.filter((f): f is string => typeof f === 'string')
        : undefined,
    };
  }
  if (err instanceof Error) {
    return { title: 'Upload Failed', message: err.message || formatApiErrorMessage({}) };
  }
  return { title: 'Upload Failed', message: 'An unexpected error occurred.' };
}
