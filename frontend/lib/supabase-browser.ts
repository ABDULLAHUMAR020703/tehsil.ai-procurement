import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null | undefined;

function decodeJwtPayload(token: string): { role?: string } | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json) as { role?: string };
  } catch {
    return null;
  }
}

/**
 * Human-readable reason the browser client cannot be created (missing/wrong env).
 * The frontend must use the **anon public** JWT from Supabase; service_role is rejected here.
 */
export function getSupabaseBrowserConfigError(): string | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

  if (!url) return 'Add NEXT_PUBLIC_SUPABASE_URL to frontend/.env (Project Settings → API → Project URL).';
  if (!anonKey)
    return 'Add NEXT_PUBLIC_SUPABASE_ANON_KEY to frontend/.env — use the anon public key from Project Settings → API.';

  const looksPlaceholder =
    /paste_|your_project_ref|your_anon|placeholder/i.test(anonKey) || anonKey.length < 80;
  if (looksPlaceholder)
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY is still a placeholder or too short. Paste the full anon public JWT from Supabase → Project Settings → API (label: anon, public).';

  if (!anonKey.startsWith('eyJ') || anonKey.split('.').length !== 3)
    return 'NEXT_PUBLIC_SUPABASE_ANON_KEY must be the JWT from Supabase (three segments, starts with eyJ).';

  const payload = decodeJwtPayload(anonKey);
  if (payload?.role === 'service_role')
    return 'Do not use the service_role key in the app. Put service_role only in backend/.env; frontend needs the anon public key.';

  return null;
}

/** Single browser Supabase client (matches session storage / refresh used by auth). */
export function getBrowserSupabase(): SupabaseClient | null {
  if (browserClient !== undefined) return browserClient;

  const configError = getSupabaseBrowserConfigError();
  if (configError) {
    browserClient = null;
    return browserClient;
  }

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

  browserClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}
