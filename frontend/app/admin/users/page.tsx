'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppLayout } from '../../../components/AppLayout';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { PageContainer } from '../../../components/ui/PageContainer';
import { PageHeader } from '../../../components/ui/PageHeader';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../../../components/ui/Table';
import { useAuth, type Department, type UserRole } from '../../../features/auth/AuthProvider';
import { ApiError, authedFetchWithSupabase, NoSessionError } from '../../../lib/api';

const ROLES: UserRole[] = ['admin', 'pm', 'dept_head', 'employee'];

type DeptOption = { code: string; display_name: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  created_at: string;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { accessToken, profile, supabase } = useAuth();
  const token = accessToken ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['departments'],
    enabled: !!token && !!supabase && profile?.role === 'admin',
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: DeptOption[] }>(supabase!, '/api/departments');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const departmentOptions = departmentsData?.departments ?? [];

  const patchMutation = useMutation({
    mutationFn: async (params: { id: string; role?: UserRole; department?: Department }) => {
      const { id, role, department } = params;
      const body: { role?: UserRole; department?: Department } = {};
      if (role !== undefined) body.role = role;
      if (department !== undefined) body.department = department;
      try {
        return await authedFetchWithSupabase<{ user: UserRow }>(supabase, `/api/users/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
    onSuccess: () => {
      setLocalEdits({});
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });

  const [localEdits, setLocalEdits] = useState<Record<string, { role: UserRole; department: Department }>>({});

  if (profile && profile.role !== 'admin') {
    return (
      <AppLayout>
        <PageContainer className="space-y-4">
          <PageHeader title="Users" subtitle="Admin only" />
          <Card className="p-6 text-sm text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40">
            Access denied.
          </Card>
        </PageContainer>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <PageContainer className="space-y-6">
        <PageHeader title="Users" subtitle="Assign roles and departments. Admins are always in management." />

        {isLoading ? (
          <Card className="p-4 text-sm text-stone-600 dark:text-stone-400 border-stone-200/90 dark:border-stone-600/70">
            Loading…
          </Card>
        ) : error ? (
          <Card className="p-4 text-sm text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40">
            {error instanceof Error ? error.message : 'Failed to load users'}
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden border-stone-200/90 dark:border-stone-600/70">
            <TableWrapper className="scrollbar-warm max-h-[min(560px,70vh)] overflow-y-auto bg-orange-50/25 dark:bg-stone-900/35">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Email</TH>
                    <TH>Role</TH>
                    <TH>Department</TH>
                    <TH className="text-right">Save</TH>
                  </TR>
                </THead>
                <TBody>
                  {(data?.users ?? []).length === 0 ? (
                    <TR>
                      <TD colSpan={5} className="py-10 text-center text-sm text-stone-600 dark:text-stone-400">
                        No users found.
                      </TD>
                    </TR>
                  ) : null}
                  {(data?.users ?? []).map((u) => {
                    const edit = localEdits[u.id] ?? { role: u.role, department: u.department as Department };
                    return (
                      <TR key={u.id}>
                        <TD className="font-medium text-stone-900 dark:text-stone-100">{u.name}</TD>
                        <TD className="text-xs text-stone-600 dark:text-stone-400">{u.email}</TD>
                        <TD>
                          <select
                            className="w-full min-w-[100px] max-w-[140px] rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-2 py-1.5 text-xs text-stone-900 dark:text-stone-100 shadow-sm outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500"
                            value={edit.role}
                            onChange={(e) =>
                              setLocalEdits((prev) => ({
                                ...prev,
                                [u.id]: { ...edit, role: e.target.value as UserRole },
                              }))
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </TD>
                        <TD>
                          <select
                            className="rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-2 py-1 text-xs text-stone-900 dark:text-stone-100 capitalize outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-400 dark:focus:border-orange-500"
                            value={edit.role === 'admin' ? 'management' : edit.department}
                            disabled={edit.role === 'admin'}
                            onChange={(e) =>
                              setLocalEdits((prev) => ({
                                ...prev,
                                [u.id]: { ...edit, department: e.target.value as Department },
                              }))
                            }
                          >
                            {departmentOptions.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.display_name}
                              </option>
                            ))}
                          </select>
                        </TD>
                        <TD className="text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            className="text-xs px-3 py-1.5 border-stone-200 dark:border-stone-600 hover:border-orange-300 dark:hover:border-orange-600 hover:bg-orange-50/80 dark:hover:bg-orange-950/35"
                            disabled={patchMutation.isPending || (edit.role === u.role && edit.department === u.department)}
                            onClick={() => {
                              const payload: { id: string; role?: UserRole; department?: Department } = { id: u.id };
                              if (edit.role !== u.role) payload.role = edit.role;
                              if (edit.role !== 'admin' && edit.department !== u.department) {
                                payload.department = edit.department;
                              }
                              if (payload.role === undefined && payload.department === undefined) return;
                              patchMutation.mutate(payload);
                            }}
                          >
                            Save
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
        {patchMutation.error ? (
          <Card className="p-3 text-sm text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40">
            {patchMutation.error instanceof ApiError
              ? patchMutation.error.message
              : String(patchMutation.error)}
          </Card>
        ) : null}
      </PageContainer>
    </AppLayout>
  );
}
