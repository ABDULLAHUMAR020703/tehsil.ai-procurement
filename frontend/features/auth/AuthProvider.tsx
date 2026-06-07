'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { getBrowserSupabase, getSupabaseBrowserConfigError } from '../../lib/supabase-browser';
import type { AppPermissionId } from '@/lib/permissions';
import { APP_PERMISSION_IDS } from '@/lib/permissions';
import { fetchWithRetry } from '@/lib/fetchWithRetry';
import { clearProfileCache, readProfileCache, writeProfileCache } from '@/lib/authProfileCache';

export type UserRole = 'admin' | 'pm' | 'dept_head' | 'employee' | 'platform_admin';

/** `departments.code` from the API (dynamic list). */
export type Department = string;

export type UserProfile = {
  userId: string;
  role: UserRole;
  department?: string | null;
  name?: string | null;
  email?: string | null;
  companyId?: string | null;
  /** Effective tenant for API-backed data (matches backend `scopedCompanyId`). */
  scopedCompanyId?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  companyIsActive?: boolean | null;
  isPlatformAdmin?: boolean;
  /** Effective app permissions (non-admin). Admins bypass checks server-side. */
  permissions?: AppPermissionId[];
};

type AuthContextValue = {
  supabase: SupabaseClient | null;
  /** Set when NEXT_PUBLIC_* Supabase vars are missing or wrong (e.g. service_role in browser). */
  supabaseConfigError: string | null;
  session: Session | null;
  accessToken: string | null;
  profile: UserProfile | null;
  /** True only while the initial session/profile is unknown (blocks shell once). */
  loading: boolean;
  /** True during silent background profile refresh — UI should stay mounted. */
  refreshing: boolean;
  /** True when initial profile load exceeded the timeout — show retry UI. */
  workspaceInitTimedOut: boolean;
  signIn: (params: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  retryWorkspaceInit: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

const SILENT_AUTH_EVENTS = new Set<AuthChangeEvent>(['TOKEN_REFRESHED', 'USER_UPDATED']);

const WORKSPACE_INIT_TIMEOUT_MS = 22_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaceInitTimedOut, setWorkspaceInitTimedOut] = useState(false);
  const profileRef = useRef<UserProfile | null>(null);
  const profileLoadInFlight = useRef<Promise<void> | null>(null);

  profileRef.current = profile;

  const accessToken = session?.access_token ?? null;
  const userId = session?.user?.id ?? null;

  const supabaseConfigError = useMemo(() => getSupabaseBrowserConfigError(), []);
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const applyProfile = useCallback((next: UserProfile | null) => {
    setProfile(next);
    if (next) writeProfileCache(next);
    else clearProfileCache();
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabase) {
      applyProfile(null);
      return;
    }

    const {
      data: { session: fresh },
    } = await supabase.auth.getSession();
    const token = fresh?.access_token;
    if (!token) {
      applyProfile(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const res = await fetchWithRetry(`${backendBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timeout));

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        setSession(null);
        applyProfile(null);
        return;
      }
      throw new Error('Failed to fetch profile from backend');
    }
    const json = (await res.json()) as {
      user: {
        userId: string;
        role: UserRole;
        department?: string | null;
        name?: string | null;
        email?: string | null;
        companyId?: string | null;
        scopedCompanyId?: string | null;
        companyName?: string | null;
        companyLogoUrl?: string | null;
        companyIsActive?: boolean | null;
        permissions?: string[];
      };
    };

    const raw = json.user as Record<string, unknown>;
    const resolvedUserId = (raw.userId ?? raw.user_id) as string;

    const permRaw = json.user.permissions;
    const permissions: AppPermissionId[] | undefined =
      json.user.role === 'admin' || json.user.role === 'platform_admin'
        ? undefined
        : Array.isArray(permRaw)
          ? (permRaw.filter((p): p is AppPermissionId =>
              (APP_PERMISSION_IDS as readonly string[]).includes(p as string),
            ) as AppPermissionId[])
          : [];

    applyProfile({
      userId: resolvedUserId,
      role: json.user.role as UserRole,
      department: json.user.department ?? null,
      name: json.user.name ?? null,
      email: json.user.email ?? null,
      companyId: json.user.companyId ?? null,
      scopedCompanyId: (raw.scopedCompanyId as string | undefined) ?? json.user.companyId ?? null,
      companyName: json.user.companyName ?? null,
      companyLogoUrl: json.user.companyLogoUrl ?? null,
      companyIsActive: json.user.companyIsActive ?? null,
      isPlatformAdmin: json.user.role === 'platform_admin',
      permissions,
    });
  }, [applyProfile, supabase]);

  const loadProfile = useCallback(
    async (options?: { blockUI?: boolean; force?: boolean }) => {
      if (!userId || !accessToken) {
        applyProfile(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const blockUI = options?.blockUI ?? !profileRef.current;
      const force = options?.force ?? false;

      if (!force && profileRef.current?.userId === userId) {
        setLoading(false);
        setWorkspaceInitTimedOut(false);
        return;
      }

      if (profileLoadInFlight.current) {
        await profileLoadInFlight.current;
        return;
      }

      const run = (async () => {
        if (blockUI) setLoading(true);
        else setRefreshing(true);
        setWorkspaceInitTimedOut(false);

        try {
          await refreshProfile();
        } catch {
          if (!profileRef.current) {
            const cached = readProfileCache<UserProfile>(userId);
            if (cached?.userId === userId) applyProfile(cached);
            else applyProfile(null);
          }
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      })();

      profileLoadInFlight.current = run;
      try {
        await run;
      } finally {
        profileLoadInFlight.current = null;
      }
    },
    [accessToken, applyProfile, refreshProfile, userId],
  );

  const retryWorkspaceInit = useCallback(async () => {
    setWorkspaceInitTimedOut(false);
    await loadProfile({ blockUI: !profileRef.current, force: true });
  }, [loadProfile]);

  const hydrateProfileFromCache = useCallback((uid: string) => {
    if (profileRef.current?.userId === uid) return profileRef.current;
    const cached = readProfileCache<UserProfile>(uid);
    if (cached?.userId === uid) {
      setProfile(cached);
      setLoading(false);
      return cached;
    }
    return null;
  }, []);

  const handleAuthStateChange = useCallback(
    (event: AuthChangeEvent, nextSession: Session | null) => {
      setSession(nextSession);

      if (event === 'SIGNED_OUT') {
        applyProfile(null);
        setLoading(false);
        setRefreshing(false);
        setWorkspaceInitTimedOut(false);
        queryClient.clear();
        return;
      }

      if (event === 'SIGNED_IN') {
        const nextUserId = nextSession?.user?.id;
        const existing =
          profileRef.current ?? (nextUserId ? readProfileCache<UserProfile>(nextUserId) : null);

        if (nextUserId && existing?.userId === nextUserId) {
          if (!profileRef.current) setProfile(existing);
          setLoading(false);
          setWorkspaceInitTimedOut(false);
          setRefreshing(true);
          void refreshProfile()
            .catch(() => {
              /* keep cached profile visible */
            })
            .finally(() => setRefreshing(false));
          void queryClient.invalidateQueries();
          return;
        }

        applyProfile(null);
        setLoading(true);
        setWorkspaceInitTimedOut(false);
        void queryClient.invalidateQueries();
        void loadProfile({ blockUI: true, force: true });
        return;
      }

      if (SILENT_AUTH_EVENTS.has(event)) {
        return;
      }

      if (event === 'INITIAL_SESSION') {
        if (!nextSession) {
          setLoading(false);
          return;
        }
        hydrateProfileFromCache(nextSession.user.id);
      }
    },
    [applyProfile, hydrateProfileFromCache, loadProfile, queryClient, refreshProfile],
  );

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      applyProfile(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user?.id) {
        hydrateProfileFromCache(data.session.user.id);
      }
      if (!data.session) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      handleAuthStateChange(event, nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [applyProfile, handleAuthStateChange, hydrateProfileFromCache, supabase]);

  useEffect(() => {
    if (!userId || !accessToken) {
      applyProfile(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (profileRef.current?.userId === userId) {
      setLoading(false);
      setWorkspaceInitTimedOut(false);
      return;
    }

    const cached = readProfileCache<UserProfile>(userId);
    if (cached?.userId === userId) {
      setProfile(cached);
      setLoading(false);
      setRefreshing(true);
      void refreshProfile()
        .catch(() => {
          /* keep cached profile */
        })
        .finally(() => setRefreshing(false));
      return;
    }

    void loadProfile({ blockUI: true });
  }, [accessToken, applyProfile, loadProfile, refreshProfile, userId]);

  useEffect(() => {
    if (!loading || profile) {
      setWorkspaceInitTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setWorkspaceInitTimedOut(true), WORKSPACE_INIT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loading, profile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      supabaseConfigError,
      session,
      accessToken,
      profile,
      loading,
      refreshing,
      workspaceInitTimedOut,
      signIn: async ({ email, password }) => {
        if (!supabase) {
          throw new Error(
            supabaseConfigError ?? 'Supabase is not configured. Check frontend/.env and restart Next.js.',
          );
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message === 'Invalid API key') {
            throw new Error(
              'Invalid API key: use the anon public key in frontend/.env as NEXT_PUBLIC_SUPABASE_ANON_KEY (not the service_role key).',
            );
          }
          throw error;
        }
        await queryClient.invalidateQueries();
      },
      signOut: async () => {
        if (!supabase) {
          throw new Error(
            supabaseConfigError ?? 'Supabase is not configured. Check frontend/.env and restart Next.js.',
          );
        }
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        clearProfileCache();
        queryClient.clear();
      },
      refreshProfile,
      retryWorkspaceInit,
    }),
    [
      supabase,
      supabaseConfigError,
      session,
      profile,
      loading,
      refreshing,
      workspaceInitTimedOut,
      accessToken,
      queryClient,
      refreshProfile,
      retryWorkspaceInit,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
