'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';
import { AppLayout } from '@/components/AppLayout';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { getAccessTokenFromSupabaseSession, NoSessionError } from '@/lib/api';

export default function OnboardCompanyPage() {
  const { profile, supabase, loading } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    companyName: '',
    country: '',
    timezone: '',
    currency: '',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    adminPhone: '',
  });
  const [logo, setLogo] = useState<File | null>(null);

  if (!loading && profile && profile.role !== 'platform_admin') {
    router.replace('/dashboard');
    return null;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    try {
      const token = await getAccessTokenFromSupabaseSession(supabase);
      const fd = new FormData();
      fd.append('companyName', form.companyName);
      fd.append('country', form.country);
      fd.append('timezone', form.timezone);
      fd.append('currency', form.currency);
      fd.append('adminName', form.adminName);
      fd.append('adminEmail', form.adminEmail);
      fd.append('adminPassword', form.adminPassword);
      fd.append('adminPhone', form.adminPhone);
      if (logo) fd.append('logo', logo);
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? 'http://localhost:4000'}/api/platform/onboard-company`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `Failed (${res.status})`);
      }
      toast.success('Company onboarded');
      router.push('/platform/companies');
    } catch (err) {
      if (err instanceof NoSessionError) router.replace('/login');
      else toast.error(err instanceof Error ? err.message : 'Onboarding failed');
    } finally {
      setSubmitting(false);
    }
  };

  const field = (label: string, child: React.ReactNode) => (
    <div>
      <div className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-1">{label}</div>
      {child}
    </div>
  );

  return (
    <AppLayout>
      <PageContainer>
        <PageHeader title="Onboard company" subtitle="Create a tenant, default departments, and company admin." />
        <motion.form
          onSubmit={onSubmit}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6 max-w-2xl"
        >
          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-bold tracking-wide text-stone-500 uppercase">Company</h2>
            {field(
              'Company name',
              <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} required />,
            )}
            {field('Country', <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />)}
            {field(
              'Timezone',
              <Input
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                placeholder="e.g. Asia/Karachi"
              />,
            )}
            {field(
              'Currency',
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="e.g. PKR" />,
            )}
            <div>
              <div className="text-xs font-semibold text-stone-600 dark:text-stone-400 mb-1">Logo</div>
              <input type="file" accept="image/*" onChange={(e) => setLogo(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>
          </Card>
          <Card className="p-6 space-y-4">
            <h2 className="text-sm font-bold tracking-wide text-stone-500 uppercase">Super admin</h2>
            {field(
              'Full name',
              <Input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required />,
            )}
            {field(
              'Email',
              <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required />,
            )}
            {field(
              'Password',
              <PasswordInput
                value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                required
              />,
            )}
            {field('Phone', <Input value={form.adminPhone} onChange={(e) => setForm({ ...form, adminPhone: e.target.value })} />)}
          </Card>
          <Button type="submit" disabled={submitting} className="min-w-[160px]">
            {submitting ? 'Creating…' : 'Create company'}
          </Button>
        </motion.form>
      </PageContainer>
    </AppLayout>
  );
}
