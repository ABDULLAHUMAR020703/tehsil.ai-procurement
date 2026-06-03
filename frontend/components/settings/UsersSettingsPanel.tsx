'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Table, TBody, TD, TH, THead, TR, TableWrapper } from '../ui/Table';
import { ApiError, authedFetchWithSupabase, authedFetchWithSupabaseNoContent, NoSessionError } from '@/lib/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '@/features/auth/AuthProvider';
import { useAuth } from '@/features/auth/AuthProvider';

const ROLES: UserRole[] = ['admin', 'pm', 'dept_head', 'employee'];

type UserRow = { id: string; name: string; email: string; role: UserRole; department: string; created_at: string };
type DeptRow = { code: string; display_name: string };

const inputCls =
  'mt-1 w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500';
const labelCls = 'block text-sm font-medium text-stone-700 dark:text-stone-300';

type Props = { supabase: SupabaseClient | null };

export function UsersSettingsPanel({ supabase }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  // form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [department, setDepartment] = useState('');
  const [newDeptName, setNewDeptName] = useState('');
  const [creatingDept, setCreatingDept] = useState(false);

  const { data: usersData, isLoading, error } = useQuery({
    queryKey: ['admin', 'users'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ users: UserRow[] }>(supabase!, '/api/users');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const { data: deptsData } = useQuery({
    queryKey: ['departments'],
    enabled: Boolean(supabase),
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ departments: DeptRow[] }>(supabase!, '/api/departments');
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const departments = deptsData?.departments ?? [];

  const createDeptMutation = useMutation({
    mutationFn: async (display_name: string) => {
      return authedFetchWithSupabase<{ department: DeptRow }>(supabase!, '/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name }),
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      toast.success(`Department "${res.department.display_name}" created`);
      setDepartment(res.department.code);
      setNewDeptName('');
      setCreatingDept(false);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create department');
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (body: { name: string; email: string; password: string; role: UserRole; department?: string }) => {
      return authedFetchWithSupabase<{ user: UserRow }>(supabase!, '/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User created successfully');
      resetForm();
      setAddOpen(false);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create user');
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await authedFetchWithSupabaseNoContent(supabase!, `/api/users/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User deleted');
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete user');
    },
  });

  function resetForm() {
    setName('');
    setEmail('');
    setPassword('');
    setRole('employee');
    setDepartment('');
    setNewDeptName('');
    setCreatingDept(false);
  }

  const needsDept = role !== 'admin' && role !== 'platform_admin';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      toast.error('Name, email and password are required');
      return;
    }
    if (needsDept && !department) {
      toast.error('Please select or create a department');
      return;
    }
    createUserMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      department: needsDept ? department : undefined,
    });
  }

  const users = usersData?.users ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-50">User management</h2>
          <p className="text-xs text-muted-foreground mt-1">Add users to your company. They can log in immediately with the password you set.</p>
        </div>
        <Button
          type="button"
          className="gap-2 shrink-0 shadow-sm hover:shadow-md transition-shadow"
          onClick={() => { resetForm(); setAddOpen(true); }}
        >
          <UserPlus className="w-4 h-4" aria-hidden />
          Add user
        </Button>
      </div>

      {isLoading ? (
        <Card className="p-4 text-sm text-muted-foreground">Loading users…</Card>
      ) : error ? (
        <Card className="p-4 text-sm text-rose-600 border-rose-200 bg-rose-50">
          {error instanceof Error ? error.message : 'Failed to load users'}
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden border border-stone-200/90 dark:border-stone-600/70">
          <TableWrapper className="scrollbar-warm max-h-[min(560px,70vh)] overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Department</TH>
                  <TH className="w-16 text-right">Delete</TH>
                </TR>
              </THead>
              <TBody>
                {users.length === 0 ? (
                  <TR>
                    <TD colSpan={5} className="text-center text-sm text-muted-foreground py-8">No users found.</TD>
                  </TR>
                ) : users.map((u) => (
                  <TR key={u.id} className="hover:bg-orange-50/70 dark:hover:bg-stone-800/55 transition-colors">
                    <TD className="font-medium text-stone-900 dark:text-stone-100">{u.name}</TD>
                    <TD className="text-xs text-stone-600 dark:text-stone-400">{u.email}</TD>
                    <TD>
                      <span className="inline-block rounded-full bg-orange-100 dark:bg-orange-950/50 px-2 py-0.5 text-xs font-medium text-orange-800 dark:text-orange-300">
                        {u.role}
                      </span>
                    </TD>
                    <TD className="text-xs text-stone-600 dark:text-stone-400 capitalize">{u.department ?? '—'}</TD>
                    <TD className="text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        className="p-2 rounded-lg border-rose-200 dark:border-rose-800/60 hover:border-rose-400 dark:hover:border-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Delete user"
                        disabled={u.id === profile?.id}
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      )}

      <Modal
        open={deleteTarget != null}
        onClose={() => !deleteUserMutation.isPending && setDeleteTarget(null)}
        title="Delete user"
      >
        {deleteTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-stone-900 dark:text-stone-100">{deleteTarget.name}</span>?{' '}
              This will remove their account permanently and they will no longer be able to log in.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" disabled={deleteUserMutation.isPending} onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleteUserMutation.isPending}
                onClick={() => deleteUserMutation.mutate(deleteTarget.id)}
              >
                {deleteUserMutation.isPending ? 'Deleting…' : 'Delete user'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={addOpen} onClose={() => !createUserMutation.isPending && setAddOpen(false)} title="Add user">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className={labelCls}>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Ali Hassan" autoFocus />
          </label>

          <label className={labelCls}>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="user@example.com" />
          </label>

          <label className={labelCls}>
            Temporary password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="Min. 6 characters" />
          </label>

          <label className={labelCls}>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={inputCls}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          {needsDept ? (
            <div className="space-y-2">
              <label className={labelCls}>
                Department
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>
                  <option value="">— select department —</option>
                  {departments.map((d) => (
                    <option key={d.code} value={d.code}>{d.display_name}</option>
                  ))}
                </select>
              </label>

              {!creatingDept ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 hover:underline"
                  onClick={() => setCreatingDept(true)}
                >
                  <Plus className="w-3 h-3" aria-hidden />
                  Create new department
                </button>
              ) : (
                <div className="rounded-lg border border-orange-200 dark:border-orange-700/50 bg-orange-50/60 dark:bg-orange-950/20 p-3 space-y-2">
                  <p className="text-xs font-medium text-stone-700 dark:text-stone-300">New department name</p>
                  <div className="flex gap-2">
                    <input
                      value={newDeptName}
                      onChange={(e) => setNewDeptName(e.target.value)}
                      className="flex-1 rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-1.5 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 focus:border-orange-400 dark:focus:border-orange-500"
                      placeholder="e.g. Field Operations"
                    />
                    <Button
                      type="button"
                      className="shrink-0 text-xs px-3"
                      disabled={createDeptMutation.isPending || !newDeptName.trim()}
                      onClick={() => createDeptMutation.mutate(newDeptName.trim())}
                    >
                      {createDeptMutation.isPending ? 'Creating…' : 'Create'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0 text-xs px-3"
                      disabled={createDeptMutation.isPending}
                      onClick={() => { setCreatingDept(false); setNewDeptName(''); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" disabled={createUserMutation.isPending} onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createUserMutation.isPending}>
              {createUserMutation.isPending ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
