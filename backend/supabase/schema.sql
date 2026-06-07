-- Tehsil.ai procurement app — Supabase schema
-- Notes:
-- - Uses UUID primary keys and timestamptz timestamps.
-- - "reference_id" in exceptions is intentionally polymorphic (can point to projects or purchase_requests).
-- - User-facing roles: admin | pm | dept_head | employee (team_lead is project-scoped via projects.team_lead_id).

create extension if not exists pgcrypto;

create table if not exists public.departments (
  code text primary key,
  display_name text not null
);

-- USERS (application profile for RBAC)
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'pm', 'dept_head', 'employee')),
  department text not null check (
    department in (
      'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
      'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
    )
  ),
  created_at timestamptz not null default now()
);

create index if not exists users_department_idx on public.users (department);
create index if not exists users_role_idx on public.users (role);

-- PURCHASE ORDERS (PO) — line-level rows use po_line_sn unique; po_number/vendor nullable for line items
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text,
  vendor text,
  total_value numeric(20, 2) not null default 0 check (total_value >= 0),
  remaining_value numeric(20, 2) not null default 0 check (remaining_value >= 0),
  utilized_budget numeric(20, 2) generated always as (total_value - remaining_value) stored,
  uploaded_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  source_row jsonb
);

create index if not exists purchase_orders_remaining_idx on public.purchase_orders (remaining_value);

-- PROJECTS
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  po_id uuid references public.purchase_orders (id) on delete set null,
  budget numeric(20, 2) not null check (budget >= 0),
  department_id text not null references public.departments (code),
  team_lead_id uuid references public.users (id) on delete set null,
  created_by uuid not null references public.users (id),
  status text not null default 'active',
  is_exception boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

create index if not exists projects_po_idx on public.projects (po_id);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_department_id_idx on public.projects (department_id);
create index if not exists projects_team_lead_idx on public.projects (team_lead_id);

-- PURCHASE REQUESTS (PR)
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  description text not null,
  amount numeric(20, 2) not null check (amount > 0),
  document_url text,
  item_code text,
  duplicate_count integer not null default 1,
  po_line_id uuid references public.purchase_orders (id) on delete set null,
  requested_quantity numeric(20, 4),
  budget_deducted boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected','pending_exception')),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

create index if not exists purchase_requests_project_idx on public.purchase_requests (project_id);
create index if not exists purchase_requests_status_idx on public.purchase_requests (status);
create index if not exists purchase_requests_created_by_item_code_idx on public.purchase_requests (created_by, item_code)
where item_code is not null;

create index if not exists purchase_requests_po_line_id_idx on public.purchase_requests (po_line_id)
where po_line_id is not null;

-- APPROVALS (sequential stages: team_lead → pm → admin; team_lead row omitted when no team_lead_id)
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests (id) on delete cascade,
  approver_id uuid not null references public.users (id),
  role text not null check (role in ('team_lead', 'pm', 'admin')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  comments text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

create index if not exists approvals_request_idx on public.approvals (request_id);
create index if not exists approvals_approver_idx on public.approvals (approver_id);
create unique index if not exists approvals_request_role_unique on public.approvals (request_id, role);

-- Exceptions (pause/resume the main flow)
-- type: no_po, over_budget
create table if not exists public.exceptions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('no_po', 'over_budget')),
  reference_id uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index if not exists exceptions_type_status_idx on public.exceptions (type, status);

-- AUDIT LOGS
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  user_id uuid references public.users (id),
  entity text not null,
  entity_type text not null default 'legacy',
  entity_id uuid not null,
  reason text,
  changes jsonb,
  department_scope text,
  timestamp timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index if not exists audit_logs_department_scope_timestamp_idx
  on public.audit_logs (department_scope, timestamp desc);

-- IN-APP NOTIFICATIONS
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  type text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, is_read);

-- EMAIL OUTBOX (placeholder for "send email" without SMTP)
create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  created_at timestamptz not null default now()
);
