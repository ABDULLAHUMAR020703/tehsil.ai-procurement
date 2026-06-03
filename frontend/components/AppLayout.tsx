'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { Settings, Menu, X } from 'lucide-react';
import { useAuth } from '../features/auth/AuthProvider';
import { Button } from './ui/Button';
import { cn } from '@/lib/ui';
import InteractiveBackground from './InteractiveBackground';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { APP_NAME } from '@/lib/appMeta';
import {
  hasAnyDashboardPermission,
  hasAppPermission,
  type AppPermissionId,
} from '@/lib/permissions';
import type { UserProfile } from '../features/auth/AuthProvider';

type NavItem = {
  href: string;
  label: string;
  roles: Array<'employee' | 'admin' | 'platform_admin' | 'pm' | 'dept_head'>;
  /** Admins always pass. */
  permission?: AppPermissionId | 'dashboard_any';
};

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    roles: ['employee', 'admin', 'platform_admin', 'pm', 'dept_head'],
    permission: 'dashboard_any',
  },
  { href: '/po/upload', label: 'PO Upload', roles: ['admin', 'platform_admin', 'pm', 'dept_head'], permission: 'view_pos' },
  {
    href: '/projects',
    label: 'Projects',
    roles: ['employee', 'admin', 'platform_admin', 'pm', 'dept_head'],
    permission: 'view_projects',
  },
  {
    href: '/purchase-requests',
    label: 'Purchase Requests',
    roles: ['employee', 'admin', 'platform_admin', 'pm', 'dept_head'],
    permission: 'view_projects',
  },
  {
    href: '/approvals',
    label: 'Approvals',
    roles: ['employee', 'admin', 'platform_admin', 'pm', 'dept_head'],
    permission: 'view_approvals',
  },
  { href: '/admin/users', label: 'User Management', roles: ['admin', 'platform_admin'] },
  {
    href: '/reports',
    label: 'Reports',
    roles: ['employee', 'admin', 'platform_admin', 'pm', 'dept_head'],
    permission: 'view_projects',
  },
];

const platformNavItems: NavItem[] = [
  { href: '/platform/companies', label: 'Companies', roles: ['platform_admin'] },
  { href: '/platform/tenant-overview', label: 'Tenant overview', roles: ['platform_admin'] },
  { href: '/platform/onboard-company', label: 'Onboard company', roles: ['platform_admin'] },
];

function navItemAllowed(profile: UserProfile, item: NavItem): boolean {
  if (!item.roles.includes(profile.role)) return false;
  if (profile.role === 'admin' || profile.role === 'platform_admin') {
    if (!item.permission) return true;
    if (item.permission === 'dashboard_any') return hasAnyDashboardPermission(profile);
    return hasAppPermission(profile, item.permission);
  }
  if (!item.permission) return true;
  if (item.permission === 'dashboard_any') return hasAnyDashboardPermission(profile);
  return hasAppPermission(profile, item.permission);
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { profile, signOut, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!loading && !profile) {
      router.replace('/login');
    }
  }, [loading, profile, router]);

  const { mainNav, platformNav } = useMemo(() => {
    if (!profile) return { mainNav: [] as NavItem[], platformNav: [] as NavItem[] };
    const main = navItems.filter((n) => navItemAllowed(profile, n));
    const plat =
      profile.role === 'platform_admin' ? platformNavItems.filter((n) => navItemAllowed(profile, n)) : [];
    return { mainNav: main, platformNav: plat };
  }, [profile]);
  const showSettings = profile?.role === 'admin' || profile?.role === 'platform_admin';

  const linkClass = (href: string, active: boolean) =>
    cn(
      'block rounded-xl px-4 py-3 text-sm font-medium transition-all border',
      active
        ? 'border-orange-200 dark:border-orange-500/40 bg-gradient-to-r from-orange-50 to-rose-50/80 dark:from-orange-950/50 dark:to-rose-950/30 text-stone-900 dark:text-stone-50 shadow-sm'
        : 'border-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-100/80 dark:hover:bg-stone-800/60 hover:text-stone-900 dark:hover:text-stone-100 hover:border-stone-200 dark:hover:border-stone-600',
    );

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950 text-stone-500">
        <div className="animate-pulse">Loading workspace...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:pl-72 text-stone-800 dark:text-stone-100 font-sans relative overflow-x-hidden bg-transparent">
      <InteractiveBackground />

      {/* Mobile Menu Toggle */}
      <div className="md:hidden fixed top-4 right-4 z-50">
        <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Backdrop for mobile */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 border-r border-stone-200/90 dark:border-stone-700/80 bg-[var(--surface)]/92 dark:bg-stone-900/90 backdrop-blur-md px-4 py-6 flex flex-col h-screen shadow-md shadow-stone-200/30 dark:shadow-stone-950/50 transition-transform duration-300 ease-in-out md:translate-x-0",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="mb-6 px-3 shrink-0 flex items-start justify-between gap-2 min-w-0">
          <BrandLogo size="md" className="min-w-0">
            <div className="min-w-0 overflow-hidden">
              <div className="text-sm font-bold tracking-tight text-stone-900 dark:text-stone-50 truncate">{APP_NAME}</div>
              <div className="text-[10px] tracking-wider text-stone-500 dark:text-stone-400 font-medium">Procurement</div>
              {profile?.companyName ? (
                <div className="text-[10px] font-semibold text-orange-700 dark:text-orange-300/90 mt-0.5 truncate">
                  {profile.companyName}
                </div>
              ) : null}
            </div>
          </BrandLogo>
          <ThemeToggle compact className="shrink-0 scale-90 origin-top-right" />
        </div>

        <nav className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
            {mainNav.map((i) => (
              <Link key={i.href} href={i.href} className={linkClass(i.href, pathname === i.href)} onClick={() => setMobileMenuOpen(false)}>
                {i.label}
              </Link>
            ))}
            {platformNav.length > 0 ? (
              <>
                <div className="my-3 border-t border-stone-200 dark:border-stone-700" aria-hidden />
                <div className="px-1 text-[10px] font-bold tracking-widest text-stone-400 uppercase mb-1">Platform</div>
                {platformNav.map((i) => (
                  <Link key={i.href} href={i.href} className={linkClass(i.href, pathname === i.href)} onClick={() => setMobileMenuOpen(false)}>
                    {i.label}
                  </Link>
                ))}
              </>
            ) : null}
          </div>

          {showSettings ? (
            <>
              <div className="shrink-0 my-4 border-t border-stone-200 dark:border-stone-700" aria-hidden />
              <Link
                href="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'group shrink-0 flex items-center gap-3 rounded-xl px-4 py-3 text-sm border transition-all font-medium',
                  pathname.startsWith('/settings')
                    ? 'border-orange-200 dark:border-orange-500/40 bg-orange-50/90 dark:bg-orange-950/40 text-stone-900 dark:text-stone-50 shadow-sm'
                    : 'border-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-100/80 dark:hover:bg-stone-800/60 hover:text-stone-900 dark:hover:text-stone-100 hover:border-stone-200 dark:hover:border-stone-600',
                )}
              >
                <Settings
                  className={cn(
                    'w-4 h-4 shrink-0 transition-colors',
                    pathname.startsWith('/settings')
                      ? 'text-orange-600 dark:text-orange-400'
                      : 'text-stone-400 group-hover:text-orange-600 dark:group-hover:text-orange-400',
                  )}
                  aria-hidden
                />
                Settings
              </Link>
            </>
          ) : null}
        </nav>

        <div className="mt-4 shrink-0 text-xs text-stone-600 dark:text-stone-400 bg-stone-50/90 dark:bg-stone-800/50 rounded-xl p-4 border border-stone-200/90 dark:border-stone-600/70">
          {profile ? (
            <div className="space-y-4">
              <div className="truncate">
                <div className="font-semibold text-stone-900 dark:text-stone-50 mb-1">
                  {profile.name ?? profile.email ?? 'User'}
                </div>
                <div className="text-[10px] tracking-widest uppercase text-orange-600 dark:text-orange-400 font-semibold">
                  {profile.role}
                </div>
                {profile.companyName ? (
                  <div className="text-[10px] tracking-wider text-stone-600 dark:text-stone-400 mt-0.5 truncate">
                    {profile.companyName}
                  </div>
                ) : null}
                {profile.department ? (
                  <div className="text-[10px] tracking-wider text-stone-500 dark:text-stone-500 uppercase mt-0.5">
                    {profile.department}
                  </div>
                ) : null}
              </div>
              <Button
                className="w-full text-xs font-semibold uppercase tracking-wide"
                variant="secondary"
                onClick={async () => {
                  await signOut();
                  router.replace('/login');
                }}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <div className="text-stone-500">Signing in...</div>
          )}
        </div>
      </aside>

      <main className="relative z-10 min-h-screen">
        <div className="p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
