import type { Session, SupabaseClient } from '@supabase/supabase-js';

export const GET_SESSION_TIMEOUT_MS = 12_000;

export class GetSessionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Supabase getSession() timed out after ${timeoutMs}ms`);
    this.name = 'GetSessionTimeoutError';
  }
}

/** Bounded wait for Supabase session read — prevents indefinite auth/workspace hangs. */
export async function getSessionWithTimeout(
  supabase: SupabaseClient,
  timeoutMs: number = GET_SESSION_TIMEOUT_MS,
): Promise<{ session: Session | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GetSessionTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
    return { session: result.data.session };
  } catch (error) {
    if (error instanceof GetSessionTimeoutError) {
      console.error('[auth] getSession timed out', { timeoutMs });
    }
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
