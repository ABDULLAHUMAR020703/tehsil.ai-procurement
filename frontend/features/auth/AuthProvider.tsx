'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { getBrowserSupabase, getSupabaseBrowserConfigError } from '../../lib/supabase-browser';
import type { AppPermissionId } from '@/lib/permissions';
import { APP_PERMISSION_IDS } from '@/lib/permissions';
import { fetchWithRetry } from '@/lib/fetchWithRetry';

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
  signIn: (params: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

const backendBase = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000';

const SILENT_AUTH_EVENTS = new Set(['TOKEN_REFRESHED', 'USER_UPDATED']);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const profileRef = useRef<UserProfile | null>(null);

  profileRef.current = profile;

  const accessToken = session?.access_token ?? null;

  const supabaseConfigError = useMemo(() => getSupabaseBrowserConfigError(), []);
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const refreshProfile = React.useCallback(async () => {
    if (!supabase) {
      setProfile(null);
      return;
    }

    const {
      data: { session: fresh },
    } = await supabase.auth.getSession();
    const token = fresh?.access_token;
    if (!token) {
      setProfile(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    const res = await fetchWithRetry(`${backendBase}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timeout));

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
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
    const userId = (raw.userId ?? raw.user_id) as string;

    const permRaw = json.user.permissions;
    const permissions: AppPermissionId[] | undefined =
      json.user.role === 'admin' || json.user.role === 'platform_admin'
        ? undefined
        : Array.isArray(permRaw)
          ? (permRaw.filter((p): p is AppPermissionId =>
              (APP_PERMISSION_IDS as readonly string[]).includes(p as string),
            ) as AppPermissionId[])
          : [];

    setProfile({
      userId,
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
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setSession(null);
      setProfile(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);

      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setLoading(false);
        setRefreshing(false);
        queryClient.clear();
        return;
      }

      if (event === 'SIGNED_IN') {
        setProfile(null);
        setLoading(true);
        void queryClient.invalidateQueries();
        return;
      }

      if (SILENT_AUTH_EVENTS.has(event)) {
        return;
      }

      if (event === 'INITIAL_SESSION' && !nextSession) {
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient, supabase]);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId || !accessToken) {
      setProfile(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (profileRef.current?.userId === userId) {
      return;
    }

    setLoading(true);
    refreshProfile()
      .catch(() => {
        if (!profileRef.current) setProfile(null);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, accessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      supabaseConfigError,
      session,
      accessToken,
      profile,
      loading,
      refreshing,
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
        queryClient.clear();
      },
      refreshProfile,
    }),
    [supabase, supabaseConfigError, session, profile, loading, refreshing, accessToken, queryClient, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
