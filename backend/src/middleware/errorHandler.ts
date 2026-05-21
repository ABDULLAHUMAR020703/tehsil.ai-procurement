import type { ErrorRequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/errors';
import { isPostgrestError, postgrestErrorFields, postgrestErrorMessage } from '../utils/supabaseError';

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

  if (details !== undefined && details !== null) {
    const d = details;
    if (typeof d === 'object' && !Array.isArray(d)) {
      Object.assign(payload, d as Record<string, unknown>);
    } else {
      payload.details = d;
    }
  }

  if (isPostgrestError(err)) {
    Object.assign(payload, postgrestErrorFields(err) ?? {});
  } else if (status >= 500 && err instanceof Error) {
    payload.debug = postgrestErrorMessage(err);
  } else if (process.env.NODE_ENV !== 'production' && err instanceof Error && status >= 500) {
    payload.debug = err.message;
  }

  res.status(status).json(payload);
};

