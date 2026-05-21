import { AppError } from './errors';

export type PostgrestErrorLike = {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
};

export function isPostgrestError(err: unknown): err is PostgrestErrorLike {
  return (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as PostgrestErrorLike).message === 'string'
  );
}

export function postgrestErrorMessage(err: unknown): string {
  if (isPostgrestError(err)) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export function postgrestErrorFields(err: unknown): Record<string, unknown> | undefined {
  if (!isPostgrestError(err)) return undefined;
  return {
    errorCode: err.code,
    errorDetails: err.details ?? undefined,
    errorHint: err.hint ?? undefined,
  };
}

/** Turn Supabase client errors into AppError so clients see the real DB message. */
export function throwSupabaseError(err: unknown, fallbackStatus = 500): never {
  if (isPostgrestError(err)) {
    const status =
      err.code === '23505' ? 409 : err.code === '23503' ? 400 : err.code === 'PGRST204' ? 400 : fallbackStatus;
    throw new AppError(err.message, status, postgrestErrorFields(err));
  }
  if (err instanceof Error) throw err;
  throw new AppError(String(err), fallbackStatus);
}
