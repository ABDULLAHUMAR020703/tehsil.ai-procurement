'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../features/auth/AuthProvider';
import { AppLayout } from '../../components/AppLayout';
import { Card } from '../../components/ui/Card';
import { PageContainer } from '../../components/ui/PageContainer';
import { PageHeader } from '../../components/ui/PageHeader';
import { DepartmentsSettingsPanel } from '../../components/settings/DepartmentsSettingsPanel';
import {
  UserPermissionsPanel,
  type UserPermissionMatrixRow,
} from '../../components/settings/UserPermissionsPanel';
import { cn } from '@/lib/ui';
import { authedFetchWithSupabase, NoSessionError } from '@/lib/api';

type SettingsTab = 'departments' | 'permissions';

export default function SettingsPage() {
  const { profile, supabase, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>('departments');

  const {
    data: permissionsData,
    isLoading: permissionsLoading,
    error: permissionsError,
  } = useQuery({
    queryKey: ['permissions', 'matrix'],
    enabled: activeTab === 'permissions' && Boolean(supabase) && profile?.role === 'admin',
    refetchOnWindowFocus: false,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserPermissionMatrixRow[] }>(
          supabase!,
          '/api/permissions',
        );
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  if (!loading && profile && profile.role !== 'admin') {
    return (
      <AppLayout>
        <PageContainer className="space-y-4">
          <PageHeader title="Settings" subtitle="Organization configuration" />
          <Card className="p-6 text-sm text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/35">
            Access denied.
          </Card>
        </PageContainer>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageContainer className="space-y-8">
        <PageHeader title="Settings" subtitle="Manage organization structure and preferences" />

        <div className="flex flex-wrap gap-2 border-b border-stone-200 dark:border-stone-700 pb-1">
          <button
            type="button"
            onClick={() => setActiveTab('departments')}
            className={cn(
              'rounded-t-lg px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px',
              activeTab === 'departments'
                ? 'border-orange-500 text-orange-950 dark:text-orange-100 bg-orange-50 dark:bg-orange-950/40 shadow-sm'
                : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            Departments
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('permissions')}
            className={cn(
              'rounded-t-lg px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px',
              activeTab === 'permissions'
                ? 'border-orange-500 text-orange-950 dark:text-orange-100 bg-orange-50 dark:bg-orange-950/40 shadow-sm'
                : 'border-transparent text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            Permissions
          </button>
          <button
            type="button"
            disabled
            className="rounded-t-lg px-4 py-2 text-sm font-medium text-stone-400 dark:text-stone-500 cursor-not-allowed opacity-70 border-b-2 border-transparent"
          >
            Users
            <span className="ml-2 text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-500">
              Soon
            </span>
          </button>
          <button
            type="button"
            disabled
            className="rounded-t-lg px-4 py-2 text-sm font-medium text-stone-400 dark:text-stone-500 cursor-not-allowed opacity-70 border-b-2 border-transparent"
          >
            Roles
            <span className="ml-2 text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-500">
              Soon
            </span>
          </button>
        </div>

        {activeTab === 'departments' ? <DepartmentsSettingsPanel supabase={supabase} /> : null}
        {activeTab === 'permissions' ? (
          <UserPermissionsPanel
            supabase={supabase}
            users={permissionsData?.users}
            isLoading={permissionsLoading}
            error={permissionsError}
          />
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}
