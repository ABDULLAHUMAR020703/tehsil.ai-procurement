'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/features/auth/AuthProvider';
import { AppLayout } from '@/components/AppLayout';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { authedFetchWithSupabase, NoSessionError } from '@/lib/api';

export default function TenantOverviewPage() {
  const { profile, supabase, loading } = useAuth();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform', 'companies', 'overview'],
    enabled: !loading && profile?.role === 'platform_admin' && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ companies: unknown[] }>(supabase!, '/api/platform/companies');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  if (!loading && profile && profile.role !== 'platform_admin') {
    router.replace('/dashboard');
    return null;
  }

  const companies = (data?.companies ?? []) as Array<{
    id: string;
    name: string;
    is_active: boolean;
    stats?: { users: number; purchase_requests: number; projects: number };
  }>;

  return (
    <AppLayout>
      <PageContainer>
        <PageHeader title="Tenant overview" subtitle="Usage for your current tenant only (same source as Companies)." />
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 overflow-x-auto">
            {isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
            {error ? <p className="text-sm text-red-600">Failed to load.</p> : null}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 border-b border-stone-200 dark:border-stone-700">
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4">Users</th>
                  <th className="py-2 pr-4">PRs</th>
                  <th className="py-2 pr-4">Projects</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-b border-stone-100 dark:border-stone-800/80">
                    <td className="py-2 pr-4 font-medium">{c.name}</td>
                    <td className="py-2 pr-4">{c.stats?.users ?? 0}</td>
                    <td className="py-2 pr-4">{c.stats?.purchase_requests ?? 0}</td>
                    <td className="py-2 pr-4">{c.stats?.projects ?? 0}</td>
                    <td className="py-2">{c.is_active ? 'Active' : 'Suspended'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </motion.div>
      </PageContainer>
    </AppLayout>
  );
}
