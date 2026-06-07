import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { isPostgrestError, postgrestErrorFields, postgrestErrorMessage } from '../utils/supabaseError';

function errorTypeFor(err: unknown, status: number): string {
  if (err instanceof multer.MulterError) return 'upload_error';
  if (isPostgrestError(err)) {
    if (err.code === '23505') return 'duplicate_key';
    return 'database_error';
  }
  if (err instanceof AppError) {
    if (status === 400) return 'validation_error';
    if (status === 409) return 'conflict_error';
    return 'application_error';
  }
  if (status === 413) return 'upload_error';
  if (status >= 500) return 'server_error';
  return 'request_error';
}

function errorCodeFor(err: unknown, details?: unknown): string | undefined {
  if (isPostgrestError(err) && err.code) return err.code;
  if (err instanceof multer.MulterError) return err.code;
  if (details && typeof details === 'object' && details !== null && !Array.isArray(details)) {
    const code = (details as Record<string, unknown>).errorCode;
    if (typeof code === 'string' && code) return code;
  }
  return undefined;
}

function normalizeErr(err: unknown): {
  status: number;
  message: string;
  details?: unknown;
  logMessage: string;
} {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, details: err.details, logMessage: err.message };
  }
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return {
      status,
      message:
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Upload file too large (max 20MB)'
          : `Upload rejected: ${err.message || err.code}`,
      logMessage: `multer:${err.code}`,
    };
  }
  if (isPostgrestError(err)) {
    const status =
      err.code === '23505' ? 409 : err.code === '23503' ? 400 : err.code === 'PGRST204' ? 400 : 500;
    return {
      status,
      message: err.message,
      details: postgrestErrorFields(err),
      logMessage: `[${err.code ?? 'postgrest'}] ${err.message}`,
    };
  }
  if (err instanceof Error) {
    const corsBlocked = err.message.startsWith('CORS blocked') || err.message === 'Not allowed by CORS';
    if (corsBlocked) {
      return { status: 403, message: err.message, logMessage: err.message };
    }
    return { status: 500, message: 'Internal Server Error', logMessage: err.message };
  }
  return { status: 500, message: 'Internal Server Error', logMessage: String(err) };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { status, message, details, logMessage } = normalizeErr(err);
  const log = (req as { log?: { error: (o: unknown, msg?: string) => void } }).log;

  const logPayload = {
    status,
    path: req.path,
    method: req.method,
    message: logMessage,
    stack: err instanceof Error ? err.stack : undefined,
    supabase: postgrestErrorFields(err),
  };
  if (log) log.error(logPayload, 'request_error');
  else console.error('[request_error]', logPayload);

  const payload: Record<string, unknown> = { message };
  payload.errorType = errorTypeFor(err, status);
  const code = errorCodeFor(err, details);
  if (code) payload.errorCode = code;

  if (details !== undefined && details !== null) {
    const d = details;
    if (typeof d === 'object' && !Array.isArray(d)) {
      const detailObj = d as Record<string, unknown>;
      if (Array.isArray(detailObj.failures)) payload.failures = detailObj.failures;
      Object.assign(payload, detailObj);
    } else {
      payload.details = d;
    }
  }

  if (isPostgrestError(err)) {
    Object.assign(payload, postgrestErrorFields(err) ?? {});
    if (err.code && !payload.errorCode) payload.errorCode = err.code;
  } else if (status >= 500 && err instanceof Error) {
    payload.debug = postgrestErrorMessage(err);
  }

  res.status(status).json(payload);
};

