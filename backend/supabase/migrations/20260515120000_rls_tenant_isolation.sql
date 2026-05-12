-- Row Level Security: tenant isolation for authenticated PostgREST (browser Supabase client).
-- The API uses service_role and bypasses RLS; this blocks cross-tenant reads/writes via anon key + user JWT.

create or replace function public.auth_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.company_id
  from public.users u
  where u.id = auth.uid()
  limit 1;
$$;

comment on function public.auth_user_company_id() is
  'Returns public.users.company_id for the signed-in auth user; used in RLS policies.';

revoke all on function public.auth_user_company_id() from public;
grant execute on function public.auth_user_company_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Helper macro pattern: policies use company_id = auth_user_company_id()
-- ---------------------------------------------------------------------------

-- companies: only the row for the caller's tenant (JWT user profile).
alter table public.companies enable row level security;
drop policy if exists companies_select_own_tenant on public.companies;
create policy companies_select_own_tenant on public.companies
  for select to authenticated
  using (id = public.auth_user_company_id());

-- company_settings: one row per company
alter table public.company_settings enable row level security;
drop policy if exists company_settings_select_tenant on public.company_settings;
create policy company_settings_select_tenant on public.company_settings
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- departments: composite tenant key
alter table public.departments enable row level security;
drop policy if exists departments_select_tenant on public.departments;
create policy departments_select_tenant on public.departments
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- users: same-tenant directory + own row
alter table public.users enable row level security;
drop policy if exists users_select_tenant on public.users;
create policy users_select_tenant on public.users
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- purchase_orders, projects, purchase_requests, approvals, exceptions
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_tenant_select on public.purchase_orders;
create policy purchase_orders_tenant_select on public.purchase_orders
  for select to authenticated
  using (company_id = public.auth_user_company_id());

alter table public.projects enable row level security;
drop policy if exists projects_tenant_select on public.projects;
create policy projects_tenant_select on public.projects
  for select to authenticated
  using (company_id = public.auth_user_company_id());

alter table public.purchase_requests enable row level security;
drop policy if exists purchase_requests_tenant_select on public.purchase_requests;
create policy purchase_requests_tenant_select on public.purchase_requests
  for select to authenticated
  using (company_id = public.auth_user_company_id());

alter table public.approvals enable row level security;
drop policy if exists approvals_tenant_select on public.approvals;
create policy approvals_tenant_select on public.approvals
  for select to authenticated
  using (company_id = public.auth_user_company_id());

alter table public.exceptions enable row level security;
drop policy if exists exceptions_tenant_select on public.exceptions;
create policy exceptions_tenant_select on public.exceptions
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- project_assignments
alter table public.project_assignments enable row level security;
drop policy if exists project_assignments_tenant_select on public.project_assignments;
create policy project_assignments_tenant_select on public.project_assignments
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- user_permissions
alter table public.user_permissions enable row level security;
drop policy if exists user_permissions_tenant_select on public.user_permissions;
create policy user_permissions_tenant_select on public.user_permissions
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- audit_logs: tenant-scoped read (same as API list intent)
alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_tenant_select on public.audit_logs;
create policy audit_logs_tenant_select on public.audit_logs
  for select to authenticated
  using (company_id = public.auth_user_company_id());

-- notifications: only own rows in own tenant
alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (
    company_id = public.auth_user_company_id()
    and user_id = auth.uid()
  );
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (
    company_id = public.auth_user_company_id()
    and user_id = auth.uid()
  )
  with check (
    company_id = public.auth_user_company_id()
    and user_id = auth.uid()
  );

-- email_outbox: server-side only from app; no authenticated policies (deny direct client).
alter table public.email_outbox enable row level security;
