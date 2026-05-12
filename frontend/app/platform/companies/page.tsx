'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';
import { AppLayout } from '@/components/AppLayout';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { authedFetchWithSupabase, getAccessTokenFromSupabaseSession, NoSessionError } from '@/lib/api';

type CompanyRow = {
  id: string;
  name: string;
  is_active: boolean;
  stats?: { users: number; purchase_requests: number; projects: number };
};

export default function PlatformCompaniesPage() {
  const { profile, supabase, loading } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform', 'companies'],
    enabled: !loading && profile?.role === 'platform_admin' && !!supabase,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ companies: CompanyRow[] }>(supabase!, '/api/platform/companies');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const toggle = useMutation({
    mutationFn: async (p: { id: string; is_active: boolean }) => {
      const token = await getAccessTokenFromSupabaseSession(supabase!);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000'}/api/platform/companies/${p.id}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ is_active: p.is_active }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? 'Update failed');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('Company updated');
      void qc.invalidateQueries({ queryKey: ['platform', 'companies'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!loading && profile && profile.role !== 'platform_admin') {
    router.replace('/dashboard');
    return null;
  }

  return (
    <AppLayout>
      <PageContainer>
        <PageHeader title="Companies" subtitle="Tenant-scoped: only your current company (profile or ?companyId=)." />
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <Card className="p-6">
            {isLoading ? <p className="text-sm text-stone-500">Loading…</p> : null}
            {error ? <p className="text-sm text-red-600">Failed to load companies.</p> : null}
            <div className="space-y-3">
              {(data?.companies ?? []).map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200/80 dark:border-stone-700/80 p-4"
                >
                  <div>
                    <div className="font-semibold text-stone-900 dark:text-stone-50">{c.name}</div>
                    <div className="text-xs text-stone-500 mt-1">
                      Users: {c.stats?.users ?? 0} · PRs: {c.stats?.purchase_requests ?? 0} · Projects:{' '}
                      {c.stats?.projects ?? 0}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-1">
                      {c.is_active ? 'Active' : 'Suspended'}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    className="text-xs"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate({ id: c.id, is_active: !c.is_active })}
                  >
                    {c.is_active ? 'Suspend' : 'Activate'}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </PageContainer>
    </AppLayout>
  );
}
