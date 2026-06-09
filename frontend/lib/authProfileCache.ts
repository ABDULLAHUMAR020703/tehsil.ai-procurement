/** Session-scoped profile cache so tab return can render immediately while /auth/me refreshes. */
const CACHE_KEY = 'tehsil_auth_profile_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

type CachedProfile = {
  userId: string;
  profile: Record<string, unknown>;
  ts: number;
};

function isCachedProfile(value: unknown): value is CachedProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as CachedProfile;
  return typeof v.userId === 'string' && v.profile != null && typeof v.profile === 'object' && typeof v.ts === 'number';
}

export function readProfileCache<T extends { userId: string }>(userId: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isCachedProfile(parsed)) return null;
    if (parsed.userId !== userId) return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) return null;
    return parsed.profile as T;
  } catch {
    return null;
  }
}

export function writeProfileCache(profile: { userId: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CachedProfile = { userId: profile.userId, profile: profile as Record<string, unknown>, ts: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode — ignore.
  }
}

export function clearProfileCache(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
