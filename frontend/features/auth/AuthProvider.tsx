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

/** Temporary auth debug — remove after workspace loading investigation. */
function logProfileClear(location: string, loading: boolean, refreshing: boolean) {
  console.warn('[PROFILE CLEARED]', {
    timestamp: new Date().toISOString(),
    location,
    loading,
    refreshing,
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workspaceInitTimedOut, setWorkspaceInitTimedOut] = useState(false);
  const profileRef = useRef<UserProfile | null>(null);
  const profileLoadInFlight = useRef<Promise<void> | null>(null);
  const loadingRef = useRef(loading);
  const refreshingRef = useRef(refreshing);
  const lastEventRef = useRef<AuthChangeEvent | null>(null);

  profileRef.current = profile;
  loadingRef.current = loading;
  refreshingRef.current = refreshing;

  const setLoadingDebug = useCallback((value: boolean, location: string) => {
    if (value) {
      console.warn('[LOADING_TRUE]', {
        timestamp: new Date().toISOString(),
        location,
      });
    } else {
      console.warn('[LOADING_FALSE]', {
        timestamp: new Date().toISOString(),
        location,
      });
    }
    setLoading(value);
  }, []);

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
      logProfileClear('REFRESH_PROFILE_NO_SUPABASE', loadingRef.current, refreshingRef.current);
      applyProfile(null);
      return;
    }

    let fresh: Session | null = null;
    try {
      console.log('[GET_SESSION_START]', {
        timestamp: new Date().toISOString(),
      });
      const started = performance.now();
      const result = await supabase.auth.getSession();
      console.log('[GET_SESSION_DURATION_MS]', {
        duration: performance.now() - started,
      });
      fresh = result.data.session;
    } catch (error) {
      console.error('[GET_SESSION_ERROR]', error);
      throw error;
    }

    const token = fresh?.access_token;
    console.log('[GET_SESSION_RESOLVED]', {
      timestamp: new Date().toISOString(),
      hasToken: !!token,
    });
    if (!token) {
      logProfileClear('REFRESH_PROFILE_NO_TOKEN', loadingRef.current, refreshingRef.current);
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
        logProfileClear('REFRESH_PROFILE_401_403', loadingRef.current, refreshingRef.current);
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
      const blockUI = options?.blockUI ?? !profileRef.current;
      const force = options?.force ?? false;

      console.log('[LOAD_PROFILE_START]', {
        timestamp: new Date().toISOString(),
        userId,
        hasProfile: !!profileRef.current,
        blockUI,
        force,
      });

      if (!userId || !accessToken) {
        logProfileClear('LOAD_PROFILE_NO_CREDENTIALS', loadingRef.current, refreshingRef.current);
        applyProfile(null);
        setLoadingDebug(false, 'LOAD_PROFILE_NO_CREDENTIALS');
        setRefreshing(false);
        return;
      }

      if (!force && profileRef.current?.userId === userId) {
        setLoadingDebug(false, 'LOAD_PROFILE_ALREADY_LOADED');
        setWorkspaceInitTimedOut(false);
        return;
      }

      if (profileLoadInFlight.current) {
        await profileLoadInFlight.current;
        return;
      }

      const run = (async () => {
        if (blockUI) setLoadingDebug(true, 'LOAD_PROFILE_RUN_BLOCK_UI');
        else setRefreshing(true);
        setWorkspaceInitTimedOut(false);

        try {
          console.log('[LOAD_PROFILE_BEFORE_REFRESH]');
          await refreshProfile();
          console.log('[LOAD_PROFILE_AFTER_REFRESH]');
        } catch (error) {
          console.error('[LOAD_PROFILE_ERROR]', error);
          if (!profileRef.current) {
            const cached = readProfileCache<UserProfile>(userId);
            if (cached?.userId === userId) applyProfile(cached);
            else {
              logProfileClear('LOAD_PROFILE_CATCH_NO_CACHE', loadingRef.current, refreshingRef.current);
              applyProfile(null);
            }
          }
        } finally {
          console.log('[LOAD_PROFILE_FINALLY]', {
            loadingWillBecomeFalse: true,
          });
          setLoadingDebug(false, 'LOAD_PROFILE_FINALLY');
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
    [accessToken, applyProfile, refreshProfile, setLoadingDebug, userId],
  );

  const retryWorkspaceInit = useCallback(async () => {
    setWorkspaceInitTimedOut(false);
    await loadProfile({ blockUI: !profileRef.current, force: true });
  }, [loadProfile]);

  const hydrateProfileFromCache = useCallback(
    (uid: string) => {
      if (profileRef.current?.userId === uid) return profileRef.current;
      const cached = readProfileCache<UserProfile>(uid);
      if (cached?.userId === uid) {
        setProfile(cached);
        setLoadingDebug(false, 'HYDRATE_PROFILE_FROM_CACHE');
        return cached;
      }
      return null;
    },
    [setLoadingDebug],
  );

  const handleAuthStateChange = useCallback(
    (event: AuthChangeEvent, nextSession: Session | null) => {
      lastEventRef.current = event;

      console.log('[AUTH EVENT]', {
        timestamp: new Date().toISOString(),
        event,
        userId: nextSession?.user?.id ?? null,
        hasProfile: !!profileRef.current,
        loading: loadingRef.current,
        refreshing: refreshingRef.current,
      });

      setSession(nextSession);

      if (event === 'SIGNED_OUT') {
        logProfileClear('SIGNED_OUT_HANDLER', loadingRef.current, refreshingRef.current);
        applyProfile(null);
        setLoadingDebug(false, 'SIGNED_OUT_HANDLER');
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
          console.log('[SIGNED_IN] Branch A', {
            userId: nextUserId,
            hasProfileRef: !!profileRef.current,
            cacheHit: !!existing,
          });
          if (!profileRef.current) setProfile(existing);
          setLoadingDebug(false, 'SIGNED_IN_BRANCH_A');
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

        console.log('[SIGNED_IN] Branch B', {
          userId: nextUserId,
          hasProfileRef: !!profileRef.current,
          cacheHit: !!existing,
          action: 'CLEAR_PROFILE_AND_BLOCK_UI',
        });
        logProfileClear('SIGNED_IN_BRANCH_B', loadingRef.current, refreshingRef.current);
        applyProfile(null);
        setLoadingDebug(true, 'SIGNED_IN_BRANCH_B');
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
          setLoadingDebug(false, 'INITIAL_SESSION_NO_SESSION');
          return;
        }
        hydrateProfileFromCache(nextSession.user.id);
      }
    },
    [applyProfile, hydrateProfileFromCache, loadProfile, queryClient, refreshProfile, setLoadingDebug],
  );

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      logProfileClear('INIT_EFFECT_NO_SUPABASE', loadingRef.current, refreshingRef.current);
      applyProfile(null);
      setLoadingDebug(false, 'INIT_EFFECT_NO_SUPABASE');
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
      if (!data.session) setLoadingDebug(false, 'INIT_EFFECT_GET_SESSION_NO_SESSION');
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      handleAuthStateChange(event, nextSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [applyProfile, handleAuthStateChange, hydrateProfileFromCache, setLoadingDebug, supabase]);

  useEffect(() => {
    if (!userId || !accessToken) {
      logProfileClear('USER_ID_EFFECT_NO_CREDENTIALS', loadingRef.current, refreshingRef.current);
      applyProfile(null);
      setLoadingDebug(false, 'USER_ID_EFFECT_NO_CREDENTIALS');
      setRefreshing(false);
      return;
    }

    if (profileRef.current?.userId === userId) {
      setLoadingDebug(false, 'USER_ID_EFFECT_PROFILE_MATCHES');
      setWorkspaceInitTimedOut(false);
      return;
    }

    const cached = readProfileCache<UserProfile>(userId);
    if (cached?.userId === userId) {
      setProfile(cached);
      setLoadingDebug(false, 'USER_ID_EFFECT_CACHE_HIT');
      setRefreshing(true);
      void refreshProfile()
        .catch(() => {
          /* keep cached profile */
        })
        .finally(() => setRefreshing(false));
      return;
    }

    void loadProfile({ blockUI: true });
  }, [accessToken, applyProfile, loadProfile, refreshProfile, setLoadingDebug, userId]);

  useEffect(() => {
    if (!loading || profile) {
      setWorkspaceInitTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setWorkspaceInitTimedOut(true), WORKSPACE_INIT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [loading, profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as Window & { __AUTH_DEBUG__?: Record<string, unknown> }).__AUTH_DEBUG__ = {
      lastEvent: lastEventRef.current,
      loading,
      refreshing,
      profileUserId: profile?.userId ?? null,
      timestamp: new Date().toISOString(),
    };
  }, [loading, refreshing, profile, session]);

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
