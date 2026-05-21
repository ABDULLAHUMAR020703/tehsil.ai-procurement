import type { SupabaseClient } from '@supabase/supabase-js';

const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

/** Thrown when Supabase has no usable session (caller should send user to login). */
export class NoSessionError extends Error {
  constructor(message = 'Not signed in') {
    super(message);
    this.name = 'NoSessionError';
  }
}

export function formatPkr(amount: number) {
  if (!Number.isFinite(amount)) return '—';
  return `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(amount)} PKR`;
}

/** Normalize API error JSON into a single user-facing string. */
export function formatApiErrorMessage(body: Record<string, unknown>, fallbackStatus?: number): string {
  if (body.error === 'Over budget' || (body.available_budget != null && body.requested_amount != null)) {
    const req = Number(body.requested_amount);
    const av = Number(body.available_budget);
    if (Number.isFinite(req) && Number.isFinite(av)) {
      const msg = typeof body.message === 'string' ? body.message : '';
      if (msg.includes('PO line') || msg.includes('Exceeds PO')) {
        return `Exceeds PO line limit: requested ${formatPkr(req)} but only ${formatPkr(av)} available on this line.`;
      }
      return `Requested amount (${formatPkr(req)}) exceeds available budget (${formatPkr(av)})`;
    }
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  const parts: string[] = [];
  if (typeof body.errorCode === 'string' && body.errorCode) parts.push(`[${body.errorCode}]`);
  if (typeof body.debug === 'string' && body.debug.trim()) parts.push(body.debug);
  if (Array.isArray(body.failures) && body.failures.length > 0) {
    parts.push(body.failures.slice(0, 5).join('\n'));
  }
  if (parts.length > 0) {
    const base =
      typeof body.message === 'string' && body.message.trim()
        ? body.message
        : fallbackStatus != null
          ? `Request failed (${fallbackStatus})`
          : 'Request failed';
    return `${base}\n${parts.join('\n')}`;
  }
  if (fallbackStatus != null) return `Request failed (${fallbackStatus})`;
  return 'Request failed';
}

/** Multipart upload (do not set Content-Type — browser adds boundary). */
export async function authedUploadFetch<T>(
  supabase: SupabaseClient | null,
  path: string,
  formData: FormData,
): Promise<T> {
  const token = await getAccessTokenFromSupabaseSession(supabase);
  const res = await fetch(`${backendBase}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  let body: Record<string, unknown> = {};
  try {
    const json = await res.json();
    if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
  } catch {
    // ignore
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(formatApiErrorMessage(body, status));
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export async function authedFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${backendBase}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      const json = await res.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

/** Fresh JWT from Supabase before each request (avoids stale React state after refresh). */
export async function getAccessTokenFromSupabaseSession(supabase: SupabaseClient | null): Promise<string> {
  if (!supabase) throw new NoSessionError();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new NoSessionError();
  return token;
}

export async function authedFetchWithSupabase<T>(
  supabase: SupabaseClient | null,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessTokenFromSupabaseSession(supabase);
  return authedFetch<T>(path, token, init);
}

/** For DELETE / 204 responses with no JSON body. */
export async function authedFetchWithSupabaseNoContent(
  supabase: SupabaseClient | null,
  path: string,
  init?: RequestInit,
): Promise<void> {
  const token = await getAccessTokenFromSupabaseSession(supabase);
  const res = await fetch(`${backendBase}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      const text = await res.text();
      if (text) {
        const json = JSON.parse(text) as unknown;
        if (json && typeof json === 'object' && !Array.isArray(json)) body = json as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body);
  }
}

