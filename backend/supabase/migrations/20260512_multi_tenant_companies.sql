-- Multi-tenant SaaS: companies, company_settings, company_id on tenant tables.
-- Safe for existing production: creates "Main Company", backfills, then enforces NOT NULL.
-- Future RLS: all tenant rows carry company_id; app layer scopes queries by company_id (platform_admin bypass).

-- ---------------------------------------------------------------------------
-- 1) Core company tables
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  logo_url text,
  country text,
  timezone text,
  currency text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  high_value_threshold numeric(20, 2) not null default 500000,
  allow_exception_flow boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id)
);

create index if not exists company_settings_company_id_idx on public.company_settings (company_id);

comment on table public.companies is 'Tenant root; all tenant-owned rows reference companies.id via company_id.';
comment on table public.company_settings is 'Per-tenant configuration (thresholds, feature flags).';

-- ---------------------------------------------------------------------------
-- 2) Default tenant + settings row
-- ---------------------------------------------------------------------------
insert into public.companies (name)
values ('Main Company')
on conflict (name) do nothing;

insert into public.company_settings (company_id)
select c.id from public.companies c where c.name = 'Main Company'
on conflict (company_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Widen users.role for platform_admin; optional phone for onboarding
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists phone text;

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('admin', 'pm', 'dept_head', 'employee', 'platform_admin'));

-- ---------------------------------------------------------------------------
-- 4) departments: add company_id, then composite PK (company_id, code)
-- ---------------------------------------------------------------------------
alter table public.departments add column if not exists company_id uuid references public.companies (id);

update public.departments d
set company_id = c.id
from public.companies c
where c.name = 'Main Company'
  and d.company_id is null;

alter table public.users drop constraint if exists users_department_fkey;
alter table public.projects drop constraint if exists projects_department_id_fkey;

alter table public.departments drop constraint if exists departments_pkey;

alter table public.departments alter column company_id set not null;

alter table public.departments
  add primary key (company_id, code);

drop index if exists departments_display_name_lower_key;

create unique index if not exists departments_company_display_name_lower_idx
  on public.departments (company_id, lower(display_name));

create index if not exists departments_company_id_idx on public.departments (company_id);

-- ---------------------------------------------------------------------------
-- 5) users.company_id + composite FK to departments
-- ---------------------------------------------------------------------------
alter table public.users add column if not exists company_id uuid references public.companies (id);

update public.users u
set company_id = c.id
from public.companies c
where c.name = 'Main Company'
  and u.company_id is null;

alter table public.users alter column company_id set not null;

alter table public.users drop constraint if exists users_company_department_fkey;
alter table public.users
  add constraint users_company_department_fkey
  foreign key (company_id, department) references public.departments (company_id, code);

create index if not exists users_company_id_idx on public.users (company_id);

-- ---------------------------------------------------------------------------
-- 6) Remaining tenant tables: nullable company_id, backfill, NOT NULL, FK, index
-- ---------------------------------------------------------------------------
alter table public.purchase_orders add column if not exists company_id uuid references public.companies (id);
update public.purchase_orders po
set company_id = u.company_id
from public.users u
where po.uploaded_by = u.id
  and po.company_id is null;
update public.purchase_orders po
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where po.company_id is null;
alter table public.purchase_orders alter column company_id set not null;
create index if not exists purchase_orders_company_id_idx on public.purchase_orders (company_id);

alter table public.projects add column if not exists company_id uuid references public.companies (id);
update public.projects p
set company_id = u.company_id
from public.users u
where p.created_by = u.id
  and p.company_id is null;
update public.projects p
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where p.company_id is null;
alter table public.projects alter column company_id set not null;
create index if not exists projects_company_id_idx on public.projects (company_id);

alter table public.projects drop constraint if exists projects_company_department_fkey;
alter table public.projects
  add constraint projects_company_department_fkey
  foreign key (company_id, department_id) references public.departments (company_id, code);

alter table public.purchase_requests add column if not exists company_id uuid references public.companies (id);
update public.purchase_requests pr
set company_id = p.company_id
from public.projects p
where pr.project_id = p.id
  and pr.company_id is null;
update public.purchase_requests pr
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where pr.company_id is null;
alter table public.purchase_requests alter column company_id set not null;
create index if not exists purchase_requests_company_id_idx on public.purchase_requests (company_id);

alter table public.approvals add column if not exists company_id uuid references public.companies (id);
update public.approvals a
set company_id = pr.company_id
from public.purchase_requests pr
where a.request_id = pr.id
  and a.company_id is null;
update public.approvals a
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where a.company_id is null;
alter table public.approvals alter column company_id set not null;
create index if not exists approvals_company_id_idx on public.approvals (company_id);

alter table public.exceptions add column if not exists company_id uuid references public.companies (id);
update public.exceptions e
set company_id = p.company_id
from public.projects p
where e.type = 'no_po' and e.reference_id = p.id and e.company_id is null;
update public.exceptions e
set company_id = pr.company_id
from public.purchase_requests pr
where e.type = 'over_budget' and e.reference_id = pr.id and e.company_id is null;
update public.exceptions e
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where e.company_id is null;
alter table public.exceptions alter column company_id set not null;
create index if not exists exceptions_company_id_idx on public.exceptions (company_id);

alter table public.notifications add column if not exists company_id uuid references public.companies (id);
update public.notifications n
set company_id = u.company_id
from public.users u
where n.user_id = u.id
  and n.company_id is null;
update public.notifications n
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where n.company_id is null;
alter table public.notifications alter column company_id set not null;
create index if not exists notifications_company_id_idx on public.notifications (company_id);

alter table public.audit_logs add column if not exists company_id uuid references public.companies (id);
update public.audit_logs a
set company_id = u.company_id
from public.users u
where a.user_id = u.id
  and a.company_id is null;
update public.audit_logs a
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where a.company_id is null;
alter table public.audit_logs alter column company_id set not null;
create index if not exists audit_logs_company_id_idx on public.audit_logs (company_id);
create index if not exists audit_logs_company_timestamp_idx on public.audit_logs (company_id, timestamp desc);

alter table public.email_outbox add column if not exists company_id uuid references public.companies (id);
update public.email_outbox e
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where e.company_id is null;
alter table public.email_outbox alter column company_id set not null;
create index if not exists email_outbox_company_id_idx on public.email_outbox (company_id);

alter table public.project_assignments add column if not exists company_id uuid references public.companies (id);
update public.project_assignments pa
set company_id = p.company_id
from public.projects p
where pa.project_id = p.id
  and pa.company_id is null;
update public.project_assignments pa
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where pa.company_id is null;
alter table public.project_assignments alter column company_id set not null;
create index if not exists project_assignments_company_id_idx on public.project_assignments (company_id);

alter table public.user_permissions add column if not exists company_id uuid references public.companies (id);
update public.user_permissions up
set company_id = u.company_id
from public.users u
where up.user_id = u.id
  and up.company_id is null;
update public.user_permissions up
set company_id = (select id from public.companies where name = 'Main Company' limit 1)
where up.company_id is null;
alter table public.user_permissions alter column company_id set not null;
create index if not exists user_permissions_company_id_idx on public.user_permissions (company_id);

comment on column public.users.company_id is 'Tenant scope; enforced in API queries (platform_admin may bypass).';
comment on column public.audit_logs.company_id is 'Denormalized tenant scope for future RLS and filtered feeds.';
