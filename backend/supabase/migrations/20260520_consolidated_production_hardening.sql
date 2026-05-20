-- Consolidated production hardening migration for Tehsil AI Procurement Platform
-- Includes base schema, ordered historical migrations, atomic RPCs, indexes, storage, and final RLS policies.
-- Review in Supabase SQL Editor before production execution; run during a maintenance window.

-- ============================================================================
-- Base schema: backend/supabase/schema.sql
-- ============================================================================
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
  updated_by uuid references public.users (id) on delete set null
);

create index if not exists purchase_orders_remaining_idx on public.purchase_orders (remaining_value);

-- PROJECTS
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  po_id uuid references public.purchase_orders (id) on delete set null,
  budget numeric(20, 2) not null check (budget >= 0),
  department_id text not null,
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

-- Consolidated production hardening migration for Tehsil AI Procurement Platform
-- Generated from the previous ordered migration history; keep this as the single Supabase migration entrypoint.
-- Safe to re-run where statements use IF EXISTS / IF NOT EXISTS / idempotent updates.


-- ============================================================================
-- Source: 20260330_org_hierarchy.sql
-- ============================================================================

-- Migration: organizational hierarchy (roles admin|pm|employee; project department + team_lead_id; approval stages team_lead|pm|admin)
-- Run once against an existing database. Review data mappings before production.

-- 1) USERS: widen role/department constraints
alter table public.users drop constraint if exists users_role_check;
alter table public.users alter column department drop not null;

update public.users set role = 'employee' where role in ('team_lead', 'finance');
update public.users set role = 'pm' where role in ('dept_head', 'gm');
update public.users set role = 'employee' where role = 'manager';
update public.users set role = 'admin' where role in ('super_admin');

update public.users set department = coalesce(department, 'technical') where department is null;
update public.users set department = 'finance' where email ilike '%.batt@hadir.ai' and role = 'employee';

alter table public.users
  add constraint users_role_check check (role in ('admin', 'pm', 'employee'));

-- Enforce admin → management (adjust emails/rows as needed for your org)
update public.users set department = 'management' where role = 'admin';

-- Any legacy / custom department codes must fit the CHECK below (production may have
-- values like operations, procurement, ibs, etc. before later migrations widen the model).
update public.users
set department = 'technical'
where department is not null
  and department not in ('sales', 'hr', 'technical', 'finance', 'engineering', 'management');

alter table public.users alter column department set not null;

alter table public.users drop constraint if exists users_department_check;
alter table public.users
  add constraint users_department_check check (
    department in ('sales', 'hr', 'technical', 'finance', 'engineering', 'management')
  );

-- 2) PROJECTS: department + team_lead
alter table public.projects add column if not exists department text;
alter table public.projects add column if not exists team_lead_id uuid references public.users (id) on delete set null;

update public.projects p
set department = coalesce(
  u.department,
  'technical'
)
from public.users u
where p.created_by = u.id and p.department is null;

update public.projects set department = 'technical' where department is null;

update public.projects
set department = 'technical'
where department is not null
  and department not in ('sales', 'hr', 'technical', 'finance', 'engineering', 'management');

alter table public.projects drop constraint if exists projects_department_check;
alter table public.projects
  add constraint projects_department_check check (
    department in ('sales', 'hr', 'technical', 'finance', 'engineering', 'management')
  );

alter table public.projects alter column department set not null;

create index if not exists projects_department_idx on public.projects (department);
create index if not exists projects_team_lead_idx on public.projects (team_lead_id);

-- 3) APPROVALS: replace legacy finance/gm stages with admin
alter table public.approvals drop constraint if exists approvals_role_check;

delete from public.approvals where role = 'gm';

update public.approvals a
set
  role = 'admin',
  approver_id = coalesce(
    (select id from public.users where role = 'admin' and department = 'management' limit 1),
    (select id from public.users where role = 'admin' limit 1)
  )
where a.role = 'finance';

alter table public.approvals
  add constraint approvals_role_check check (role in ('team_lead', 'pm', 'admin'));

-- Optional: audit log reason (used by admin override)
alter table public.audit_logs add column if not exists reason text;

-- ============================================================================
-- Source: 20260401_departments_and_users_seed.sql
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.departments (
  code text primary key,
  display_name text not null
);

do $$
declare
  v_has_company_id boolean;
  v_company_id uuid;
begin
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'departments'
      and c.column_name = 'company_id'
  )
  into v_has_company_id;

  if v_has_company_id then
    if to_regclass('public.companies') is null then
      raise exception 'public.departments has company_id but public.companies does not exist';
    end if;

    insert into public.companies (name)
    select 'Main Company'
    where not exists (
      select 1 from public.companies c where c.name = 'Main Company'
    );

    insert into public.departments (company_id, code, display_name)
    select c.id, v.code, v.display_name
    from public.companies c
    cross join (values
      ('sales', 'Sales'),
      ('hr', 'HR'),
      ('technical', 'Technical'),
      ('finance', 'Finance'),
      ('engineering', 'Engineering'),
      ('management', 'Management'),
      ('ibs', 'IBS'),
      ('power', 'Power'),
      ('civil_works', 'Civil Works'),
      ('bss_wireless', 'BSS & Wireless'),
      ('fixed_network', 'Fixed Network'),
      ('warehouse', 'Warehouse')
    ) as v(code, display_name)
    where not exists (
      select 1
      from public.departments d
      where d.company_id = c.id
        and d.code = v.code
    );
  else
    insert into public.departments (code, display_name)
    select v.code, v.display_name
    from (values
      ('sales', 'Sales'),
      ('hr', 'HR'),
      ('technical', 'Technical'),
      ('finance', 'Finance'),
      ('engineering', 'Engineering'),
      ('management', 'Management'),
      ('ibs', 'IBS'),
      ('power', 'Power'),
      ('civil_works', 'Civil Works'),
      ('bss_wireless', 'BSS & Wireless'),
      ('fixed_network', 'Fixed Network'),
      ('warehouse', 'Warehouse')
    ) as v(code, display_name)
    where not exists (
      select 1 from public.departments d where d.code = v.code
    );
  end if;
end $$;

alter table public.users drop constraint if exists users_department_check;

alter table public.projects drop constraint if exists projects_department_check;

alter table public.users add constraint users_department_check check (
  department in (
    'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
    'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
  )
);

alter table public.projects add constraint projects_department_check check (
  department in (
    'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
    'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
  )
);

do $$
declare
  rec record;
  v_id uuid;
  v_email text;
  v_keeper uuid;
  v_users_has_company_id boolean;
  v_company_id uuid;
begin
  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'users'
      and c.column_name = 'company_id'
  )
  into v_users_has_company_id;

  if v_users_has_company_id and to_regclass('public.companies') is not null then
    select c.id
    into v_company_id
    from public.companies c
    where c.name = 'Main Company'
    limit 1;
    if v_company_id is null then
      select c.id into v_company_id from public.companies c order by c.created_at nulls last limit 1;
    end if;
  end if;

  if v_users_has_company_id and v_company_id is null then
    raise exception
      'public.users has company_id but public.companies has no rows; insert or run multi-tenant migration first';
  end if;

  select coalesce(
    (select id from public.users where lower(email) = lower('hammad.bakhtiar@hadir.ai') limit 1),
    (select id from public.users order by created_at nulls last, id limit 1)
  )
  into v_keeper;

  if v_keeper is not null then
    update public.users u
    set
      role = 'pm',
      department = case
        when u.department = 'management' then 'technical'
        else u.department
      end
    where u.role = 'admin'
      and u.id <> v_keeper;

    update public.users
    set role = 'admin', department = 'management'
    where id = v_keeper;
  end if;

  update public.users
  set department = 'technical'
  where role <> 'admin'
    and department = 'management';

  update public.users
  set role = 'pm', department = 'sales'
  where lower(email) = lower('abdullah.bin.ali@hadir.ai');

  update public.users
  set role = 'employee', department = 'sales'
  where lower(email) = lower('hasnain.ibrar@hadir.ai');

  update public.users
  set role = 'pm', department = 'finance'
  where lower(email) = lower('abdul.rehman.batt@hadir.ai');

  update public.users
  set role = 'employee', department = 'hr'
  where lower(email) = lower('abdullah.bin.umar@hadir.ai');

  update public.users
  set role = 'employee', department = 'technical'
  where lower(email) = lower('samad.kiani@hadir.ai');

  update public.users
  set role = 'pm', department = 'engineering'
  where lower(email) = lower('bilawal.cheema@hadir.ai');

  update public.users
  set role = 'employee', department = 'ibs'
  where lower(email) = lower('zidane.asghar@hadir.ai');

  update public.users
  set role = 'pm', department = 'power'
  where lower(email) = lower('moiz.kazi@hadir.ai');

  update public.users
  set role = 'employee', department = 'civil_works'
  where lower(email) = lower('balaj.nadeem.kiani@hadir.ai');

  for rec in
    select * from (
      values
        ('nadia.rahman', 'Nadia Rahman', 'pm', 'sales', 'nadiaRahman123'),
        ('omar.siddiqui', 'Omar Siddiqui', 'employee', 'sales', 'omarSiddiqui123'),
        ('laiba.malik', 'Laiba Malik', 'employee', 'sales', 'laibaMalik123'),
        ('hassan.raza', 'Hassan Raza', 'employee', 'sales', 'hassanRaza123'),
        ('sara.khan', 'Sara Khan', 'employee', 'sales', 'saraKhan123'),
        ('imran.qureshi', 'Imran Qureshi', 'pm', 'hr', 'imranQureshi123'),
        ('fatima.aziz', 'Fatima Aziz', 'employee', 'hr', 'fatimaAziz123'),
        ('yasmin.tariq', 'Yasmin Tariq', 'employee', 'hr', 'yasminTariq123'),
        ('bilal.hafeez', 'Bilal Hafeez', 'employee', 'hr', 'bilalHafeez123'),
        ('aisha.mehmood', 'Aisha Mehmood', 'employee', 'hr', 'aishaMehmood123'),
        ('danish.irfan', 'Danish Irfan', 'pm', 'technical', 'danishIrfan123'),
        ('hina.shahid', 'Hina Shahid', 'employee', 'technical', 'hinaShahid123'),
        ('usman.javed', 'Usman Javed', 'employee', 'technical', 'usmanJaved123'),
        ('mehwish.saleem', 'Mehwish Saleem', 'employee', 'technical', 'mehwishSaleem123'),
        ('kamran.akhtar', 'Kamran Akhtar', 'employee', 'technical', 'kamranAkhtar123'),
        ('rubina.farooq', 'Rubina Farooq', 'pm', 'finance', 'rubinaFarooq123'),
        ('adeel.naseem', 'Adeel Naseem', 'employee', 'finance', 'adeelNaseem123'),
        ('mariam.haider', 'Mariam Haider', 'employee', 'finance', 'mariamHaider123'),
        ('shahzad.ilyas', 'Shahzad Ilyas', 'employee', 'finance', 'shahzadIlyas123'),
        ('nighat.parveen', 'Nighat Parveen', 'employee', 'finance', 'nighatParveen123'),
        ('faisal.rehman', 'Faisal Rehman', 'pm', 'engineering', 'faisalRehman123'),
        ('saima.anjum', 'Saima Anjum', 'employee', 'engineering', 'saimaAnjum123'),
        ('tariq.mahmood', 'Tariq Mahmood', 'employee', 'engineering', 'tariqMahmood123'),
        ('nabeel.ashraf', 'Nabeel Ashraf', 'employee', 'engineering', 'nabeelAshraf123'),
        ('rumaisa.khalid', 'Rumaisa Khalid', 'employee', 'engineering', 'rumaisaKhalid123'),
        ('waleed.sultan', 'Waleed Sultan', 'pm', 'ibs', 'waleedSultan123'),
        ('hania.mirza', 'Hania Mirza', 'employee', 'ibs', 'haniaMirza123'),
        ('arshad.baig', 'Arshad Baig', 'employee', 'ibs', 'arshadBaig123'),
        ('sana.rafique', 'Sana Rafique', 'employee', 'ibs', 'sanaRafique123'),
        ('zohaib.saleem', 'Zohaib Saleem', 'employee', 'ibs', 'zohaibSaleem123'),
        ('amna.shakeel', 'Amna Shakeel', 'pm', 'power', 'amnaShakeel123'),
        ('rehan.gul', 'Rehan Gul', 'employee', 'power', 'rehanGul123'),
        ('farah.danish', 'Farah Danish', 'employee', 'power', 'farahDanish123'),
        ('khurram.said', 'Khurram Said', 'employee', 'power', 'khurramSaid123'),
        ('noor.hayat', 'Noor Hayat', 'employee', 'power', 'noorHayat123'),
        ('bilquis.rafiq', 'Bilquis Rafiq', 'pm', 'civil_works', 'bilquisRafiq123'),
        ('mudassar.iqbal', 'Mudassar Iqbal', 'employee', 'civil_works', 'mudassarIqbal123'),
        ('shakeela.noor', 'Shakeela Noor', 'employee', 'civil_works', 'shakeelaNoor123'),
        ('jawad.masood', 'Jawad Masood', 'employee', 'civil_works', 'jawadMasood123'),
        ('sumaira.latif', 'Sumaira Latif', 'employee', 'civil_works', 'sumairaLatif123'),
        ('atif.rehman', 'Atif Rehman', 'pm', 'bss_wireless', 'atifRehman123'),
        ('meena.sharma', 'Meena Sharma', 'employee', 'bss_wireless', 'meenaSharma123'),
        ('vikram.patel', 'Vikram Patel', 'employee', 'bss_wireless', 'vikramPatel123'),
        ('priya.nair', 'Priya Nair', 'employee', 'bss_wireless', 'priyaNair123'),
        ('rohan.kapoor', 'Rohan Kapoor', 'employee', 'bss_wireless', 'rohanKapoor123'),
        ('gul.e.naz', 'Gul E Naz', 'pm', 'fixed_network', 'gulENaz123'),
        ('sameer.umar', 'Sameer Umar', 'employee', 'fixed_network', 'sameerUmar123'),
        ('shazia.fiaz', 'Shazia Fiaz', 'employee', 'fixed_network', 'shaziaFiaz123'),
        ('waqas.minhas', 'Waqas Minhas', 'employee', 'fixed_network', 'waqasMinhas123'),
        ('rabia.younis', 'Rabia Younis', 'employee', 'fixed_network', 'rabiaYounis123'),
        ('nasir.jamil', 'Nasir Jamil', 'pm', 'warehouse', 'nasirJamil123'),
        ('tahira.butt', 'Tahira Butt', 'employee', 'warehouse', 'tahiraButt123'),
        ('irfan.qadir', 'Irfan Qadir', 'employee', 'warehouse', 'irfanQadir123'),
        ('sadia.mumtaz', 'Sadia Mumtaz', 'employee', 'warehouse', 'sadiaMumtaz123'),
        ('murtaza.abbas', 'Murtaza Abbas', 'employee', 'warehouse', 'murtazaAbbas123')
    ) as t(username, full_name, role, department, plain_password)
  loop
    v_email := rec.username || '@hadir.ai';
    select id into v_id from auth.users where lower(email) = lower(v_email) limit 1;
    if v_id is null then
      insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      values (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        v_email,
        crypt(rec.plain_password, gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']::text[]),
        jsonb_build_object('full_name', rec.full_name),
        now(),
        now()
      )
      returning id into v_id;
    end if;
    if v_users_has_company_id then
      insert into public.users (id, name, email, role, department, company_id)
      select v_id, rec.full_name, v_email, rec.role::text, rec.department::text, v_company_id
      where not exists (
        select 1 from public.users u where lower(u.email) = lower(v_email)
      );
    else
      insert into public.users (id, name, email, role, department)
      select v_id, rec.full_name, v_email, rec.role::text, rec.department::text
      where not exists (
        select 1 from public.users u where lower(u.email) = lower(v_email)
      );
    end if;
  end loop;

  select coalesce(
    (select id from public.users where lower(email) = lower('hammad.bakhtiar@hadir.ai') limit 1),
    (select id from public.users order by created_at nulls last, id limit 1)
  )
  into v_keeper;

  if v_keeper is not null then
    update public.users u
    set
      role = 'pm',
      department = case
        when u.department = 'management' then 'technical'
        else u.department
      end
    where u.role = 'admin'
      and u.id <> v_keeper;

    update public.users
    set role = 'admin', department = 'management'
    where id = v_keeper;
  end if;

  update public.users
  set department = 'technical'
  where role <> 'admin'
    and department = 'management';
end $$;

update public.projects p
set department = coalesce(
  (select u.department from public.users u where u.id = p.created_by limit 1),
  'technical'
)
where p.department is null
   or p.department not in (
     'sales', 'hr', 'technical', 'finance', 'engineering', 'management',
     'ibs', 'power', 'civil_works', 'bss_wireless', 'fixed_network', 'warehouse'
   );

-- ============================================================================
-- Source: 20260402_purchase_orders_line_items.sql
-- ============================================================================

create extension if not exists pgcrypto;

-- remaining_amount = po_amount - po_invoiced - po_acceptance_approved - pending_to_apply

alter table public.purchase_orders add column if not exists po text;

alter table public.purchase_orders add column if not exists issue_date date;

alter table public.purchase_orders add column if not exists month integer;

alter table public.purchase_orders add column if not exists year integer;

alter table public.purchase_orders add column if not exists customer text;

alter table public.purchase_orders add column if not exists project_name text;

alter table public.purchase_orders add column if not exists sub_contract_no text;

alter table public.purchase_orders add column if not exists project_code text;

alter table public.purchase_orders add column if not exists milestone text;

alter table public.purchase_orders add column if not exists item_code text;

alter table public.purchase_orders add column if not exists description text;

alter table public.purchase_orders add column if not exists site_code text;

alter table public.purchase_orders add column if not exists site_name text;

alter table public.purchase_orders add column if not exists site_id text;

alter table public.purchase_orders add column if not exists qc_status text;

alter table public.purchase_orders add column if not exists approver_level text;

alter table public.purchase_orders add column if not exists shipment_number text;

alter table public.purchase_orders add column if not exists line_no text;

alter table public.purchase_orders add column if not exists department text;

alter table public.purchase_orders add column if not exists sub_department text;

alter table public.purchase_orders add column if not exists uom text;

alter table public.purchase_orders add column if not exists po_quantity numeric(20, 4);

alter table public.purchase_orders add column if not exists unit_price numeric(20, 4);

alter table public.purchase_orders add column if not exists po_amount numeric(20, 4);

alter table public.purchase_orders add column if not exists start_date date;

alter table public.purchase_orders add column if not exists end_date date;

alter table public.purchase_orders add column if not exists po_line_sn text;

alter table public.purchase_orders add column if not exists po_invoiced numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists po_acceptance_approved numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists po_acceptance_pending numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists acceptance_rejected_amount numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists wnd numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists pending_to_apply numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists remaining_amount numeric(20, 4) not null default 0;

alter table public.purchase_orders add column if not exists milestone_status text;

alter table public.purchase_orders add column if not exists po_status text;

alter table public.purchase_orders add column if not exists confirmation_status text;

alter table public.purchase_orders add column if not exists pending_milestone text;

alter table public.purchase_orders add column if not exists acceptance_status text;

alter table public.purchase_orders add column if not exists rejection_remarks text;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'purchase_orders'
      and column_name = 'id'
  ) then
    alter table public.purchase_orders add column id uuid not null default gen_random_uuid();
    alter table public.purchase_orders add primary key (id);
  end if;
end $$;

create unique index if not exists purchase_orders_po_line_sn_uidx on public.purchase_orders (po_line_sn)
where po_line_sn is not null;

create index if not exists purchase_orders_item_code_idx on public.purchase_orders (item_code);

create index if not exists purchase_orders_project_code_idx on public.purchase_orders (project_code);

-- ============================================================================
-- Source: 20260403_purchase_orders_po_number_nullable.sql
-- ============================================================================

alter table public.purchase_orders drop constraint if exists purchase_orders_po_number_key;

alter table public.purchase_orders alter column po_number drop not null;

alter table public.purchase_orders alter column vendor drop not null;

-- ============================================================================
-- Source: 20260404_purchase_requests_item_duplicate.sql
-- ============================================================================

alter table public.purchase_requests add column if not exists item_code text;

alter table public.purchase_requests add column if not exists duplicate_count integer not null default 1;

create index if not exists purchase_requests_created_by_item_code_idx on public.purchase_requests (created_by, item_code)
where item_code is not null;

-- ============================================================================
-- Source: 20260405_purchase_requests_po_line.sql
-- ============================================================================

alter table public.purchase_requests add column if not exists po_line_id uuid references public.purchase_orders (id) on delete set null;

alter table public.purchase_requests add column if not exists requested_quantity numeric(20, 4);

create index if not exists purchase_requests_po_line_id_idx on public.purchase_requests (po_line_id)
where po_line_id is not null;

-- ============================================================================
-- Source: 20260406_pr_budget_deducted_finalize_rpc.sql
-- ============================================================================

-- Idempotent budget deduction when a PR is fully approved (atomic in one DB transaction).

alter table public.purchase_requests
  add column if not exists budget_deducted boolean not null default false;

comment on column public.purchase_requests.budget_deducted is
  'Set true when approved spend has been applied to PO line, PO header, or project budget. Prevents double deduction.';

-- Optional: PO utilization (total - remaining) for reporting; mirrors existing total_value/remaining_value.
alter table public.purchase_orders
  add column if not exists utilized_budget numeric(20, 4) generated always as (total_value - remaining_value) stored;

create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr record;
  v_proj record;
  v_line record;
  v_po record;
  v_amt numeric(20, 2);
  v_pending integer;
  v_new_rem_amt numeric;
  v_new_rem_val numeric;
  v_new_budget numeric;
begin
  select * into v_pr from purchase_requests where id = p_pr_id for update;
  if not found then
    raise exception 'PR_NOT_FOUND';
  end if;

  -- Idempotent: already closed with deduction recorded
  if v_pr.budget_deducted = true and v_pr.status = 'approved' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'pr_id', p_pr_id);
  end if;

  if v_pr.status not in ('pending', 'pending_exception') then
    raise exception 'PR_NOT_PENDING status=%', v_pr.status;
  end if;

  if v_pr.budget_deducted = true then
    raise exception 'PR_BUDGET_ALREADY_DEDUCTED_INCONSISTENT';
  end if;

  v_amt := v_pr.amount;
  if v_amt is null or v_amt <= 0 then
    raise exception 'PR_INVALID_AMOUNT';
  end if;

  select count(*)::integer into v_pending
  from approvals
  where request_id = p_pr_id and status = 'pending';

  if v_pending > 0 then
    raise exception 'PR_APPROVALS_STILL_PENDING count=%', v_pending;
  end if;

  -- 1) PO line on the PR
  if v_pr.po_line_id is not null then
    select * into v_line from purchase_orders where id = v_pr.po_line_id for update;
    if not found then
      raise exception 'PO_LINE_NOT_FOUND';
    end if;
    if v_line.remaining_amount < v_amt or v_line.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_LINE_BALANCE';
    end if;
    update purchase_orders
    set
      remaining_amount = remaining_amount - v_amt,
      remaining_value = remaining_value - v_amt
    where id = v_pr.po_line_id;

    v_new_rem_amt := v_line.remaining_amount - v_amt;
    v_new_rem_val := v_line.remaining_value - v_amt;

    update purchase_requests
    set status = 'approved', budget_deducted = true
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'po_line',
      'pr_id', p_pr_id,
      'po_line_id', v_pr.po_line_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  select * into v_proj from projects where id = v_pr.project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  -- 2) Project linked to a PO header row (no PR line): mirror legacy — prefer both columns when line-style amounts exist
  if v_proj.po_id is not null then
    select * into v_po from purchase_orders where id = v_proj.po_id for update;
    if not found then
      raise exception 'PO_NOT_FOUND';
    end if;

    if v_po.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_VALUE';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 and v_po.remaining_amount < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_AMOUNT';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 then
      update purchase_orders
      set
        remaining_amount = remaining_amount - v_amt,
        remaining_value = remaining_value - v_amt
      where id = v_proj.po_id;
      v_new_rem_amt := v_po.remaining_amount - v_amt;
      v_new_rem_val := v_po.remaining_value - v_amt;
    else
      update purchase_orders
      set remaining_value = remaining_value - v_amt
      where id = v_proj.po_id;
      v_new_rem_amt := coalesce(v_po.remaining_amount, 0);
      v_new_rem_val := v_po.remaining_value - v_amt;
    end if;

    update purchase_requests
    set status = 'approved', budget_deducted = true
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'project_po',
      'pr_id', p_pr_id,
      'purchase_order_id', v_proj.po_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  -- 3) No PO: project budget (schema column is budget, not remaining_budget)
  if v_proj.budget < v_amt then
    raise exception 'INSUFFICIENT_PROJECT_BUDGET';
  end if;

  update projects
  set budget = budget - v_amt
  where id = v_proj.id;

  v_new_budget := v_proj.budget - v_amt;

  update purchase_requests
  set status = 'approved', budget_deducted = true
  where id = p_pr_id;

  return jsonb_build_object(
    'ok', true,
    'deduction_type', 'project_budget',
    'pr_id', p_pr_id,
    'project_id', v_proj.id,
    'amount', v_amt,
    'remaining_budget', v_new_budget
  );
end;
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid) to service_role;

-- ============================================================================
-- Source: 20260407_update_tracking_audit_enhance.sql
-- ============================================================================

-- Last-updated metadata + audit log enhancements + touch triggers

-- ---------------------------------------------------------------------------
-- Core tables: updated_at / updated_by
-- ---------------------------------------------------------------------------
alter table public.purchase_requests
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.purchase_requests
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, created_by);

alter table public.projects
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.projects
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, created_by);

alter table public.purchase_orders
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.purchase_orders
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, uploaded_by);

alter table public.approvals
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users (id) on delete set null;

update public.approvals
set updated_at = coalesce(updated_at, created_at),
    updated_by = coalesce(updated_by, approver_id);

-- ---------------------------------------------------------------------------
-- Auto-touch updated_at on UPDATE (updated_by set in application code)
-- ---------------------------------------------------------------------------
create or replace function public.touch_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists purchase_requests_touch_updated_at on public.purchase_requests;
create trigger purchase_requests_touch_updated_at
  before update on public.purchase_requests
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists purchase_orders_touch_updated_at on public.purchase_orders;
create trigger purchase_orders_touch_updated_at
  before update on public.purchase_orders
  for each row execute procedure public.touch_row_updated_at();

drop trigger if exists approvals_touch_updated_at on public.approvals;
create trigger approvals_touch_updated_at
  before update on public.approvals
  for each row execute procedure public.touch_row_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs: entity_type + changes JSON (performed_by = user_id in API)
-- ---------------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists entity_type text not null default 'legacy',
  add column if not exists changes jsonb;

update public.audit_logs set entity_type = entity where entity_type = 'legacy' or entity_type is null;

create index if not exists audit_logs_entity_type_entity_id_idx on public.audit_logs (entity_type, entity_id);

comment on column public.audit_logs.entity_type is 'Normalized entity key, e.g. purchase_request, project, purchase_order.';
comment on column public.audit_logs.changes is 'Optional JSON payload: before/after snapshots or field-level deltas.';

-- ============================================================================
-- Source: 20260408_finalize_pr_pass_updated_by.sql
-- ============================================================================

-- Pass actor into finalize so purchase_requests.updated_by is set atomically with approval.

create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid, p_updated_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr record;
  v_proj record;
  v_line record;
  v_po record;
  v_amt numeric(20, 2);
  v_pending integer;
  v_new_rem_amt numeric;
  v_new_rem_val numeric;
  v_new_budget numeric;
begin
  select * into v_pr from purchase_requests where id = p_pr_id for update;
  if not found then
    raise exception 'PR_NOT_FOUND';
  end if;

  if v_pr.budget_deducted = true and v_pr.status = 'approved' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'pr_id', p_pr_id);
  end if;

  if v_pr.status not in ('pending', 'pending_exception') then
    raise exception 'PR_NOT_PENDING status=%', v_pr.status;
  end if;

  if v_pr.budget_deducted = true then
    raise exception 'PR_BUDGET_ALREADY_DEDUCTED_INCONSISTENT';
  end if;

  v_amt := v_pr.amount;
  if v_amt is null or v_amt <= 0 then
    raise exception 'PR_INVALID_AMOUNT';
  end if;

  select count(*)::integer into v_pending
  from approvals
  where request_id = p_pr_id and status = 'pending';

  if v_pending > 0 then
    raise exception 'PR_APPROVALS_STILL_PENDING count=%', v_pending;
  end if;

  if v_pr.po_line_id is not null then
    select * into v_line from purchase_orders where id = v_pr.po_line_id for update;
    if not found then
      raise exception 'PO_LINE_NOT_FOUND';
    end if;
    if v_line.remaining_amount < v_amt or v_line.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_LINE_BALANCE';
    end if;
    update purchase_orders
    set
      remaining_amount = remaining_amount - v_amt,
      remaining_value = remaining_value - v_amt,
      updated_by = coalesce(p_updated_by, updated_by)
    where id = v_pr.po_line_id;

    v_new_rem_amt := v_line.remaining_amount - v_amt;
    v_new_rem_val := v_line.remaining_value - v_amt;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'po_line',
      'pr_id', p_pr_id,
      'po_line_id', v_pr.po_line_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  select * into v_proj from projects where id = v_pr.project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_proj.po_id is not null then
    select * into v_po from purchase_orders where id = v_proj.po_id for update;
    if not found then
      raise exception 'PO_NOT_FOUND';
    end if;

    if v_po.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_VALUE';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 and v_po.remaining_amount < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_AMOUNT';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 then
      update purchase_orders
      set
        remaining_amount = remaining_amount - v_amt,
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := v_po.remaining_amount - v_amt;
      v_new_rem_val := v_po.remaining_value - v_amt;
    else
      update purchase_orders
      set
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := coalesce(v_po.remaining_amount, 0);
      v_new_rem_val := v_po.remaining_value - v_amt;
    end if;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'project_po',
      'pr_id', p_pr_id,
      'purchase_order_id', v_proj.po_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  if v_proj.budget < v_amt then
    raise exception 'INSUFFICIENT_PROJECT_BUDGET';
  end if;

  update projects
  set
    budget = budget - v_amt,
    updated_by = coalesce(p_updated_by, updated_by)
  where id = v_proj.id;

  v_new_budget := v_proj.budget - v_amt;

  update purchase_requests
  set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
  where id = p_pr_id;

  return jsonb_build_object(
    'ok', true,
    'deduction_type', 'project_budget',
    'pr_id', p_pr_id,
    'project_id', v_proj.id,
    'amount', v_amt,
    'remaining_budget', v_new_budget
  );
end;
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid, uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid, uuid) to service_role;

-- Keep one-arg overload for backwards compatibility (no updated_by attribution)
create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.finalize_pr_budget_after_approval(p_pr_id, null::uuid);
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid) to service_role;

-- ============================================================================
-- Source: 20260409_approval_admin_override_pm_final.sql
-- ============================================================================

-- PM is final required approver; admin is optional override only.
-- 1) Track admin-driven decisions on approval rows.
-- 2) Finalize budget only when no pending team_lead/pm rows (legacy admin pending no longer blocks).
-- 3) Auto-close legacy pending admin stages so in-flight PRs can complete after PM approves.

alter table public.approvals
  add column if not exists is_admin_override boolean not null default false;

comment on column public.approvals.is_admin_override is 'True when this row was decided via admin override/force approve (not the normal assignee chain).';

-- Legacy PRs may still have a pending admin row after TL+PM approved; waive those stages.
update public.approvals
set
  status = 'approved',
  comments = trim(both E'\n' from concat_ws(
    E'\n\n',
    nullif(trim(coalesce(comments, '')), ''),
    'Auto-closed: admin approval is no longer a required stage in the workflow.'
  )),
  is_admin_override = false
where role = 'admin'
  and status = 'pending';

create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid, p_updated_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr record;
  v_proj record;
  v_line record;
  v_po record;
  v_amt numeric(20, 2);
  v_pending integer;
  v_new_rem_amt numeric;
  v_new_rem_val numeric;
  v_new_budget numeric;
begin
  select * into v_pr from purchase_requests where id = p_pr_id for update;
  if not found then
    raise exception 'PR_NOT_FOUND';
  end if;

  if v_pr.budget_deducted = true and v_pr.status = 'approved' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'pr_id', p_pr_id);
  end if;

  if v_pr.status not in ('pending', 'pending_exception') then
    raise exception 'PR_NOT_PENDING status=%', v_pr.status;
  end if;

  if v_pr.budget_deducted = true then
    raise exception 'PR_BUDGET_ALREADY_DEDUCTED_INCONSISTENT';
  end if;

  v_amt := v_pr.amount;
  if v_amt is null or v_amt <= 0 then
    raise exception 'PR_INVALID_AMOUNT';
  end if;

  select count(*)::integer into v_pending
  from approvals
  where request_id = p_pr_id
    and status = 'pending'
    and role in ('team_lead', 'pm');

  if v_pending > 0 then
    raise exception 'PR_APPROVALS_STILL_PENDING count=%', v_pending;
  end if;

  if v_pr.po_line_id is not null then
    select * into v_line from purchase_orders where id = v_pr.po_line_id for update;
    if not found then
      raise exception 'PO_LINE_NOT_FOUND';
    end if;
    if v_line.remaining_amount < v_amt or v_line.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_LINE_BALANCE';
    end if;
    update purchase_orders
    set
      remaining_amount = remaining_amount - v_amt,
      remaining_value = remaining_value - v_amt,
      updated_by = coalesce(p_updated_by, updated_by)
    where id = v_pr.po_line_id;

    v_new_rem_amt := v_line.remaining_amount - v_amt;
    v_new_rem_val := v_line.remaining_value - v_amt;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'po_line',
      'pr_id', p_pr_id,
      'po_line_id', v_pr.po_line_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  select * into v_proj from projects where id = v_pr.project_id for update;
  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_proj.po_id is not null then
    select * into v_po from purchase_orders where id = v_proj.po_id for update;
    if not found then
      raise exception 'PO_NOT_FOUND';
    end if;

    if v_po.remaining_value < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_VALUE';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 and v_po.remaining_amount < v_amt then
      raise exception 'INSUFFICIENT_PO_REMAINING_AMOUNT';
    end if;

    if coalesce(v_po.remaining_amount, 0) > 0 then
      update purchase_orders
      set
        remaining_amount = remaining_amount - v_amt,
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := v_po.remaining_amount - v_amt;
      v_new_rem_val := v_po.remaining_value - v_amt;
    else
      update purchase_orders
      set
        remaining_value = remaining_value - v_amt,
        updated_by = coalesce(p_updated_by, updated_by)
      where id = v_proj.po_id;
      v_new_rem_amt := coalesce(v_po.remaining_amount, 0);
      v_new_rem_val := v_po.remaining_value - v_amt;
    end if;

    update purchase_requests
    set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
    where id = p_pr_id;

    return jsonb_build_object(
      'ok', true,
      'deduction_type', 'project_po',
      'pr_id', p_pr_id,
      'purchase_order_id', v_proj.po_id,
      'amount', v_amt,
      'remaining_amount', v_new_rem_amt,
      'remaining_value', v_new_rem_val
    );
  end if;

  if v_proj.budget < v_amt then
    raise exception 'INSUFFICIENT_PROJECT_BUDGET';
  end if;

  update projects
  set
    budget = budget - v_amt,
    updated_by = coalesce(p_updated_by, updated_by)
  where id = v_proj.id;

  v_new_budget := v_proj.budget - v_amt;

  update purchase_requests
  set status = 'approved', budget_deducted = true, updated_by = coalesce(p_updated_by, updated_by)
  where id = p_pr_id;

  return jsonb_build_object(
    'ok', true,
    'deduction_type', 'project_budget',
    'pr_id', p_pr_id,
    'project_id', v_proj.id,
    'amount', v_amt,
    'remaining_budget', v_new_budget
  );
end;
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid, uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid, uuid) to service_role;

create or replace function public.finalize_pr_budget_after_approval(p_pr_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.finalize_pr_budget_after_approval(p_pr_id, null::uuid);
$$;

revoke all on function public.finalize_pr_budget_after_approval(uuid) from public;
grant execute on function public.finalize_pr_budget_after_approval(uuid) to service_role;

-- PRs that had TL+PM approved but were blocked by a pending admin row: finalize now that admin is no longer required.
do $$
declare
  r record;
begin
  for r in
    select pr.id
    from purchase_requests pr
    where pr.status in ('pending', 'pending_exception')
      and coalesce(pr.budget_deducted, false) = false
      and not exists (
        select 1
        from approvals a
        where a.request_id = pr.id
          and a.status = 'pending'
          and a.role in ('team_lead', 'pm')
      )
  loop
    begin
      perform public.finalize_pr_budget_after_approval(r.id, null::uuid);
    exception
      when others then
        raise notice 'finalize_pr_budget_after_approval skipped for %: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- ============================================================================
-- Source: 20260410_project_pm_assignments.sql
-- ============================================================================

-- Project PM (explicit), employee assignments (many-to-many), optional job title on users.

alter table public.users add column if not exists job_title text;

alter table public.projects add column if not exists pm_id uuid references public.users (id) on delete set null;

create index if not exists projects_pm_id_idx on public.projects (pm_id);

comment on column public.projects.pm_id is 'Department PM responsible for this project (approval chain uses this user for the PM stage).';

create table if not exists public.project_assignments (
  project_id uuid not null references public.projects (id) on delete cascade,
  employee_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create index if not exists project_assignments_employee_idx on public.project_assignments (employee_id);

comment on table public.project_assignments is 'Employees (role employee) granted access to a project; must match project department.';

-- Backfill pm_id: first PM in same department per project.
update public.projects p
set pm_id = sub.chosen_pm
from (
  select distinct on (p2.id)
    p2.id as proj_id,
    u.id as chosen_pm
  from public.projects p2
  join public.users u on u.role = 'pm' and u.department = p2.department
  order by p2.id, u.created_at nulls last, u.id
) sub
where p.id = sub.proj_id
  and p.pm_id is null;

update public.projects
set pm_id = (select id from public.users where role = 'pm' order by created_at nulls last, id limit 1)
where pm_id is null;

do $$
begin
  if not exists (select 1 from public.projects where pm_id is null) then
    alter table public.projects alter column pm_id set not null;
  end if;
end $$;

-- ============================================================================
-- Source: 20260411_projects_department_id_dept_head.sql
-- ============================================================================

-- Projects: canonical FK to departments(code) as department_id; add dept_head app role.

alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check check (role in ('admin', 'pm', 'dept_head', 'employee'));

alter table public.projects add column if not exists department_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'department'
  ) then
    update public.projects p
    set department_id = coalesce(p.department_id, p.department)
    where p.department_id is null;
  end if;
end $$;

alter table public.projects drop constraint if exists projects_department_check;

alter table public.projects alter column department_id set not null;

alter table public.projects drop constraint if exists projects_department_id_fkey;
do $$
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'departments'
      and c.column_name = 'company_id'
  ) then
    alter table public.projects
      add constraint projects_department_id_fkey foreign key (department_id) references public.departments (code);
  end if;
end $$;

drop index if exists projects_department_idx;

alter table public.projects drop column if exists department;

create index if not exists projects_department_id_idx on public.projects (department_id);

-- ============================================================================
-- Source: 20260412_audit_logs_department_scope.sql
-- ============================================================================

-- Denormalized department for dashboard activity filtering (non-admin users).

alter table public.audit_logs add column if not exists department_scope text;

create index if not exists audit_logs_department_scope_timestamp_idx
  on public.audit_logs (department_scope, timestamp desc);

comment on column public.audit_logs.department_scope is
  'Department code for scoped activity feeds; set on new audit rows when known.';

-- ============================================================================
-- Source: 20260413_backfill_audit_department_scope_and_row_touch.sql
-- ============================================================================

-- Backfill data created before department_scope and consistent row touches.
-- Safe to re-run: only fills NULL department_scope / NULL updated_by where audits exist.
--
-- Ensure column exists if 20260412_audit_logs_department_scope.sql was not applied yet.

alter table public.audit_logs add column if not exists department_scope text;

create index if not exists audit_logs_department_scope_timestamp_idx
  on public.audit_logs (department_scope, timestamp desc);

comment on column public.audit_logs.department_scope is
  'Department code for scoped activity feeds; set on new audit rows when known.';

-- ---------------------------------------------------------------------------
-- 1) audit_logs.department_scope — resolve from domain tables (entity_id keys)
-- ---------------------------------------------------------------------------

-- Purchase requests → project department
update public.audit_logs al
set department_scope = p.department_id
from public.purchase_requests pr
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = pr.id;

-- Projects
update public.audit_logs al
set department_scope = p.department_id
from public.projects p
where al.department_scope is null
  and al.entity_id = p.id;

-- Approvals → PR → project
update public.audit_logs al
set department_scope = p.department_id
from public.approvals a
join public.purchase_requests pr on pr.id = a.request_id
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = a.id;

-- Exceptions: no_po reference = project id; over_budget reference = PR id
update public.audit_logs al
set department_scope = p.department_id
from public.exceptions e
join public.projects p on p.id = e.reference_id
where al.department_scope is null
  and al.entity_id = e.id
  and e.type = 'no_po';

update public.audit_logs al
set department_scope = p.department_id
from public.exceptions e
join public.purchase_requests pr on pr.id = e.reference_id
join public.projects p on p.id = pr.project_id
where al.department_scope is null
  and al.entity_id = e.id
  and e.type = 'over_budget';

-- Purchase orders: prefer a linked project’s department, else uploader’s department
update public.audit_logs al
set department_scope = coalesce(
  (
    select p.department_id
    from public.projects p
    where p.po_id = po.id
    order by p.created_at asc
    limit 1
  ),
  u.department
)
from public.purchase_orders po
join public.users u on u.id = po.uploaded_by
where al.department_scope is null
  and al.entity_id = po.id;

-- ---------------------------------------------------------------------------
-- 2) Remaining audit rows: actor’s department (helps legacy entity_type = legacy)
-- ---------------------------------------------------------------------------

update public.audit_logs al
set department_scope = u.department
from public.users u
where al.department_scope is null
  and al.user_id is not null
  and al.user_id = u.id
  and u.department is not null;

-- ---------------------------------------------------------------------------
-- 3) Row touch consistency: set updated_by / updated_at from latest audit per entity
--    Only where updated_by is still null and audit has user_id.
-- ---------------------------------------------------------------------------

with latest_pr as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.purchase_requests)
  order by entity_id, timestamp desc
)
update public.purchase_requests pr
set
  updated_by = la.user_id,
  updated_at = greatest(pr.updated_at, la.timestamp)
from latest_pr la
where pr.id = la.entity_id
  and pr.updated_by is null
  and la.user_id is not null;

with latest_proj as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.projects)
  order by entity_id, timestamp desc
)
update public.projects p
set
  updated_by = la.user_id,
  updated_at = greatest(p.updated_at, la.timestamp)
from latest_proj la
where p.id = la.entity_id
  and p.updated_by is null
  and la.user_id is not null;

with latest_po as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.purchase_orders)
  order by entity_id, timestamp desc
)
update public.purchase_orders po
set
  updated_by = la.user_id,
  updated_at = greatest(po.updated_at, la.timestamp)
from latest_po la
where po.id = la.entity_id
  and po.updated_by is null
  and la.user_id is not null;

with latest_appr as (
  select distinct on (entity_id)
    entity_id,
    user_id,
    timestamp
  from public.audit_logs
  where entity_id in (select id from public.approvals)
  order by entity_id, timestamp desc
)
update public.approvals a
set
  updated_by = la.user_id,
  updated_at = greatest(a.updated_at, la.timestamp)
from latest_appr la
where a.id = la.entity_id
  and a.updated_by is null
  and la.user_id is not null;

-- ============================================================================
-- Source: 20260414_users_department_fkey_dynamic.sql
-- ============================================================================

-- Dynamic departments: users.department must reference departments(code).
-- Drops the static CHECK list so new rows from /api/departments are valid.

alter table public.users drop constraint if exists users_department_fkey;

alter table public.users drop constraint if exists users_department_check;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'departments'
      and c.column_name = 'company_id'
  ) then
    alter table public.users
      add constraint users_department_fkey foreign key (department) references public.departments (code);
  end if;
end $$;

-- Case-insensitive uniqueness for display names (admin UI)
do $$
begin
  if not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'departments'
      and c.column_name = 'company_id'
  ) then
    create unique index if not exists departments_display_name_lower_key on public.departments (lower(display_name));
  end if;
end $$;

-- ============================================================================
-- Source: 20260415_user_permissions.sql
-- ============================================================================

-- Granular app permissions (extends role-based access). Admins bypass checks in middleware.

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  permission text not null,
  unique (user_id, permission),
  constraint user_permissions_permission_check check (
    permission in (
      'view_projects',
      'view_pos',
      'view_approvals',
      'approve_requests',
      'view_budget',
      'manage_exceptions'
    )
  )
);

create index if not exists user_permissions_user_id_idx on public.user_permissions (user_id);

-- No default rows: admins bypass in middleware; other users get access only via explicit rows (Settings → Permissions).

-- ============================================================================
-- Source: 20260416_clear_backfilled_user_permissions.sql
-- ============================================================================

-- Remove blanket grants from 20260415_user_permissions.sql so access matches explicit assignments only.
-- Non-admin users with no rows have no granular permissions until an admin sets them in Settings.
-- Application middleware still gives admins full access without storing rows.

delete from public.user_permissions;

-- ============================================================================
-- Source: 20260512_multi_tenant_companies.sql
-- ============================================================================

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
select 'Main Company'
where not exists (
  select 1 from public.companies c where c.name = 'Main Company'
);

insert into public.company_settings (company_id)
select c.id
from public.companies c
where c.name = 'Main Company'
  and not exists (
    select 1 from public.company_settings cs where cs.company_id = c.id
  );

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
alter table public.users drop constraint if exists users_company_department_fkey;
alter table public.projects drop constraint if exists projects_company_department_fkey;

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

-- ============================================================================
-- Source: 20260513_companies_schema_align.sql
-- ============================================================================

-- companies may have been created earlier with only (id, name, created_at).
-- 20260512 uses CREATE TABLE IF NOT EXISTS, so it never added new columns.
-- This migration aligns public.companies with what the API selects:
--   companies!inner(id, name, logo_url, is_active)
-- plus optional fields used by platform routes.

alter table public.companies add column if not exists logo_url text;
alter table public.companies add column if not exists country text;
alter table public.companies add column if not exists timezone text;
alter table public.companies add column if not exists currency text;

alter table public.companies add column if not exists is_active boolean;
update public.companies set is_active = true where is_active is null;
alter table public.companies alter column is_active set default true;
alter table public.companies alter column is_active set not null;

alter table public.companies add column if not exists created_at timestamptz;
update public.companies set created_at = now() where created_at is null;
alter table public.companies alter column created_at set default now();
alter table public.companies alter column created_at set not null;

-- ============================================================================
-- Source: 20260515120000_rls_tenant_isolation.sql
-- ============================================================================

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

-- ============================================================================
-- Source: 20260520_performance_indexes.sql
-- ============================================================================

-- purchase_requests
CREATE INDEX IF NOT EXISTS idx_pr_company_project_status ON purchase_requests(company_id, project_id, status);

-- approvals
CREATE INDEX IF NOT EXISTS idx_approvals_company_request ON approvals(company_id, request_id);

-- notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE is_read = false;

-- audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_entity ON audit_logs(company_id, entity_type, entity_id);

-- ============================================================================
-- Source: 20260520_rls_write_policies.sql
-- ============================================================================

-- Add INSERT/UPDATE/DELETE RLS policies for tenant-scoped tables
-- This ensures writes are restricted to the user's company_id

-- purchase_orders
drop policy if exists purchase_orders_tenant_insert on public.purchase_orders;
create policy purchase_orders_tenant_insert on public.purchase_orders
  for insert to authenticated
  with check (company_id = public.auth_user_company_id());

drop policy if exists purchase_orders_tenant_update on public.purchase_orders;
create policy purchase_orders_tenant_update on public.purchase_orders
  for update to authenticated
  using (company_id = public.auth_user_company_id())
  with check (company_id = public.auth_user_company_id());

drop policy if exists purchase_orders_tenant_delete on public.purchase_orders;
create policy purchase_orders_tenant_delete on public.purchase_orders
  for delete to authenticated
  using (company_id = public.auth_user_company_id());

-- projects
drop policy if exists projects_tenant_insert on public.projects;
create policy projects_tenant_insert on public.projects
  for insert to authenticated
  with check (company_id = public.auth_user_company_id());

drop policy if exists projects_tenant_update on public.projects;
create policy projects_tenant_update on public.projects
  for update to authenticated
  using (company_id = public.auth_user_company_id())
  with check (company_id = public.auth_user_company_id());

drop policy if exists projects_tenant_delete on public.projects;
create policy projects_tenant_delete on public.projects
  for delete to authenticated
  using (company_id = public.auth_user_company_id());

-- purchase_requests
drop policy if exists purchase_requests_tenant_insert on public.purchase_requests;
create policy purchase_requests_tenant_insert on public.purchase_requests
  for insert to authenticated
  with check (company_id = public.auth_user_company_id());

drop policy if exists purchase_requests_tenant_update on public.purchase_requests;
create policy purchase_requests_tenant_update on public.purchase_requests
  for update to authenticated
  using (company_id = public.auth_user_company_id())
  with check (company_id = public.auth_user_company_id());

drop policy if exists purchase_requests_tenant_delete on public.purchase_requests;
create policy purchase_requests_tenant_delete on public.purchase_requests
  for delete to authenticated
  using (company_id = public.auth_user_company_id());

-- approvals
drop policy if exists approvals_tenant_insert on public.approvals;
create policy approvals_tenant_insert on public.approvals
  for insert to authenticated
  with check (company_id = public.auth_user_company_id());

drop policy if exists approvals_tenant_update on public.approvals;
create policy approvals_tenant_update on public.approvals
  for update to authenticated
  using (company_id = public.auth_user_company_id())
  with check (company_id = public.auth_user_company_id());

drop policy if exists approvals_tenant_delete on public.approvals;
create policy approvals_tenant_delete on public.approvals
  for delete to authenticated
  using (company_id = public.auth_user_company_id());

-- exceptions
drop policy if exists exceptions_tenant_insert on public.exceptions;
create policy exceptions_tenant_insert on public.exceptions
  for insert to authenticated
  with check (company_id = public.auth_user_company_id());

drop policy if exists exceptions_tenant_update on public.exceptions;
create policy exceptions_tenant_update on public.exceptions
  for update to authenticated
  using (company_id = public.auth_user_company_id())
  with check (company_id = public.auth_user_company_id());

drop policy if exists exceptions_tenant_delete on public.exceptions;
create policy exceptions_tenant_delete on public.exceptions
  for delete to authenticated
  using (company_id = public.auth_user_company_id());

-- Fix notifications (map auth.uid() if needed, but it's already using it. Let's add insert/delete)
drop policy if exists notifications_insert_own on public.notifications;
create policy notifications_insert_own on public.notifications
  for insert to authenticated
  with check (
    company_id = public.auth_user_company_id()
    and user_id = auth.uid()
  );

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (
    company_id = public.auth_user_company_id()
    and user_id = auth.uid()
  );

-- ============================================================================
-- Source: 20260520_schema_fixes.sql
-- ============================================================================

-- 1. Add status CHECK constraint to projects
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check check (status in ('active', 'completed', 'archived', 'exception_pending', 'rejected'));

-- 2. Add updated_at trigger to exceptions
create or replace function public.update_exceptions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

alter table public.exceptions add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_exceptions_updated_at on public.exceptions;
create trigger set_exceptions_updated_at
  before update on public.exceptions
  for each row
  execute procedure public.update_exceptions_updated_at();

-- 3. Fix unique index on approvals (include company_id which was added in multi_tenant_companies.sql)
drop index if exists approvals_request_role_unique;
create unique index if not exists approvals_request_company_role_unique on public.approvals (request_id, company_id, role);

-- ============================================================================
-- Source: 20260520_storage_rls.sql
-- ============================================================================

-- Storage RLS for pr-documents bucket

-- 1. Ensure the bucket exists
insert into storage.buckets (id, name, public)
values ('pr-documents', 'pr-documents', false)
on conflict (id) do nothing;

-- 2. Drop any existing public policies if they exist
drop policy if exists "Public access to pr-documents" on storage.objects;
drop policy if exists "Users can upload to their own company's pr-documents" on storage.objects;
drop policy if exists "Users can read their own company's pr-documents" on storage.objects;
drop policy if exists "Users can delete their own company's pr-documents" on storage.objects;

-- 3. Create RLS policies for storage.objects
-- Note: Supabase storage objects have a bucket_id, and name (which is the path)
-- The path structure used in the app is: documents/{companyId}/pr-documents/{projectId}/{filename}

create policy "Users can upload to their own company's pr-documents"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'pr-documents' 
  and (storage.foldername(name))[1] = 'documents'
  and (storage.foldername(name))[2] = (select public.auth_user_company_id()::text)
);

create policy "Users can read their own company's pr-documents"
on storage.objects for select
to authenticated
using (
  bucket_id = 'pr-documents' 
  and (storage.foldername(name))[1] = 'documents'
  and (storage.foldername(name))[2] = (select public.auth_user_company_id()::text)
);

create policy "Users can delete their own company's pr-documents"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'pr-documents' 
  and (storage.foldername(name))[1] = 'documents'
  and (storage.foldername(name))[2] = (select public.auth_user_company_id()::text)
);

-- ============================================================================
-- Source: 20260520_transactions.sql
-- ============================================================================

-- RPC for atomic admin override
create or replace function public.admin_force_approve_pr(
  p_request_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_comments text
) returns jsonb
language plpgsql security definer
as $$
declare
  v_res jsonb;
begin
  -- update all pending approvals to approved
  update public.approvals
  set status = 'approved',
      updated_at = now(),
      updated_by = p_actor_id,
      comments = coalesce(p_comments, comments),
      is_admin_override = true
  where request_id = p_request_id and company_id = p_company_id and status = 'pending';

  -- call existing finalize RPC
  v_res := public.finalize_pr_budget_after_approval(p_request_id);
  
  return v_res;
end;
$$;

revoke all on function public.admin_force_approve_pr from public;
grant execute on function public.admin_force_approve_pr to service_role;

-- RPC for atomic PR creation with budget check
create or replace function public.create_purchase_request_guarded(
  p_pr jsonb
) returns jsonb
language plpgsql security definer
as $$
declare
  v_amount numeric;
  v_effective_remaining numeric;
  v_pending numeric;
  v_po_line_id uuid;
  v_project_id uuid;
  v_po_id uuid;
  v_po_rem numeric;
  v_proj_budget numeric;
  v_res record;
begin
  v_amount := (p_pr->>'amount')::numeric;
  v_po_line_id := (p_pr->>'po_line_id')::uuid;
  v_project_id := (p_pr->>'project_id')::uuid;

  if v_po_line_id is not null then
    select remaining_amount into v_effective_remaining
    from public.purchase_orders where id = v_po_line_id for update;
    
    if not found then
      raise exception 'PO_LINE_NOT_FOUND';
    end if;

    select coalesce(sum(amount), 0) into v_pending
    from public.purchase_requests
    where po_line_id = v_po_line_id and status in ('pending', 'pending_exception');
    
    v_effective_remaining := v_effective_remaining - v_pending;
    if v_amount > v_effective_remaining then
      raise exception 'EXCEEDS_PO_LINE_LIMIT';
    end if;
  else
    -- check project or PO header
    select po_id, budget into v_po_id, v_proj_budget
    from public.projects where id = v_project_id for update;
    
    if v_po_id is not null then
       select remaining_value into v_po_rem from public.purchase_orders where id = v_po_id for update;
       select coalesce(sum(amount), 0) into v_pending
       from public.purchase_requests
       where project_id = v_project_id and po_line_id is null and status in ('pending', 'pending_exception');
       if v_amount > (v_po_rem - v_pending) then
          raise exception 'EXCEEDS_PO_BUDGET';
       end if;
    else
       select coalesce(sum(amount), 0) into v_pending
       from public.purchase_requests
       where project_id = v_project_id and status in ('pending', 'pending_exception');
       if v_amount > (v_proj_budget - v_pending) then
          raise exception 'EXCEEDS_PROJECT_BUDGET';
       end if;
    end if;
  end if;

  insert into public.purchase_requests (
    project_id, company_id, description, amount, document_url,
    item_code, duplicate_count, po_line_id, requested_quantity, created_by, updated_by, status
  ) values (
    v_project_id,
    (p_pr->>'company_id')::uuid,
    p_pr->>'description',
    v_amount,
    p_pr->>'document_url',
    p_pr->>'item_code',
    (p_pr->>'duplicate_count')::integer,
    v_po_line_id,
    (p_pr->>'requested_quantity')::numeric,
    (p_pr->>'created_by')::uuid,
    (p_pr->>'created_by')::uuid,
    'pending'
  ) returning * into v_res;

  return row_to_json(v_res)::jsonb;
end;
$$;

revoke all on function public.create_purchase_request_guarded from public;
grant execute on function public.create_purchase_request_guarded to service_role;

-- ============================================================================
-- Final production RLS hardening pass
-- ============================================================================
-- The API server uses the service_role client and enforces RBAC in Express.
-- Browser/PostgREST access is intentionally read-limited and write-denied for
-- workflow tables, except for users marking their own notifications as read.

create or replace function public.auth_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid();
$$;

create or replace function public.auth_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role from public.users u where u.id = auth.uid() limit 1;
$$;

create or replace function public.auth_user_department()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.department from public.users u where u.id = auth.uid() limit 1;
$$;

create or replace function public.auth_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.auth_user_role() in ('admin', 'platform_admin'), false);
$$;

revoke all on function public.auth_user_id() from public;
revoke all on function public.auth_user_role() from public;
revoke all on function public.auth_user_department() from public;
revoke all on function public.auth_user_is_admin() from public;
grant execute on function public.auth_user_id() to authenticated;
grant execute on function public.auth_user_role() to authenticated;
grant execute on function public.auth_user_department() to authenticated;
grant execute on function public.auth_user_is_admin() to authenticated;

alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.departments enable row level security;
alter table public.users enable row level security;
alter table public.user_permissions enable row level security;
alter table public.project_assignments enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.projects enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.approvals enable row level security;
alter table public.exceptions enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.email_outbox enable row level security;

drop policy if exists companies_select_own_tenant on public.companies;
drop policy if exists company_settings_select_tenant on public.company_settings;
drop policy if exists departments_select_tenant on public.departments;
drop policy if exists users_select_tenant on public.users;
drop policy if exists purchase_orders_tenant_select on public.purchase_orders;
drop policy if exists projects_tenant_select on public.projects;
drop policy if exists purchase_requests_tenant_select on public.purchase_requests;
drop policy if exists approvals_tenant_select on public.approvals;
drop policy if exists exceptions_tenant_select on public.exceptions;
drop policy if exists project_assignments_tenant_select on public.project_assignments;
drop policy if exists user_permissions_tenant_select on public.user_permissions;
drop policy if exists audit_logs_tenant_select on public.audit_logs;
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
drop policy if exists purchase_orders_tenant_insert on public.purchase_orders;
drop policy if exists purchase_orders_tenant_update on public.purchase_orders;
drop policy if exists purchase_orders_tenant_delete on public.purchase_orders;
drop policy if exists projects_tenant_insert on public.projects;
drop policy if exists projects_tenant_update on public.projects;
drop policy if exists projects_tenant_delete on public.projects;
drop policy if exists purchase_requests_tenant_insert on public.purchase_requests;
drop policy if exists purchase_requests_tenant_update on public.purchase_requests;
drop policy if exists purchase_requests_tenant_delete on public.purchase_requests;
drop policy if exists approvals_tenant_insert on public.approvals;
drop policy if exists approvals_tenant_update on public.approvals;
drop policy if exists approvals_tenant_delete on public.approvals;
drop policy if exists exceptions_tenant_insert on public.exceptions;
drop policy if exists exceptions_tenant_update on public.exceptions;
drop policy if exists exceptions_tenant_delete on public.exceptions;
drop policy if exists notifications_insert_own on public.notifications;
drop policy if exists notifications_delete_own on public.notifications;

drop policy if exists rls_companies_read on public.companies;
create policy rls_companies_read on public.companies
  for select to authenticated
  using (id = public.auth_user_company_id() or public.auth_user_role() = 'platform_admin');

drop policy if exists rls_company_settings_read on public.company_settings;
create policy rls_company_settings_read on public.company_settings
  for select to authenticated
  using (company_id = public.auth_user_company_id() or public.auth_user_role() = 'platform_admin');

drop policy if exists rls_departments_read on public.departments;
create policy rls_departments_read on public.departments
  for select to authenticated
  using (company_id = public.auth_user_company_id() or public.auth_user_role() = 'platform_admin');

drop policy if exists rls_users_read on public.users;
create policy rls_users_read on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (
      company_id = public.auth_user_company_id()
      and public.auth_user_role() in ('pm', 'dept_head')
      and department = public.auth_user_department()
    )
  );

drop policy if exists rls_user_permissions_read on public.user_permissions;
create policy rls_user_permissions_read on public.user_permissions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
  );

drop policy if exists rls_project_assignments_read on public.project_assignments;
create policy rls_project_assignments_read on public.project_assignments
  for select to authenticated
  using (
    employee_id = auth.uid()
    or public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or exists (
      select 1 from public.projects p
      where p.id = project_assignments.project_id
        and p.company_id = project_assignments.company_id
        and (
          p.pm_id = auth.uid()
          or p.team_lead_id = auth.uid()
          or (
            public.auth_user_role() in ('pm', 'dept_head')
            and p.department_id = public.auth_user_department()
          )
        )
    )
  );

drop policy if exists rls_projects_read on public.projects;
create policy rls_projects_read on public.projects
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (
      company_id = public.auth_user_company_id()
      and public.auth_user_role() in ('pm', 'dept_head')
      and department_id = public.auth_user_department()
    )
    or (
      company_id = public.auth_user_company_id()
      and (
        created_by = auth.uid()
        or pm_id = auth.uid()
        or team_lead_id = auth.uid()
        or exists (
          select 1 from public.project_assignments pa
          where pa.project_id = projects.id
            and pa.company_id = projects.company_id
            and pa.employee_id = auth.uid()
        )
      )
    )
  );

drop policy if exists rls_purchase_orders_read on public.purchase_orders;
create policy rls_purchase_orders_read on public.purchase_orders
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (
      company_id = public.auth_user_company_id()
      and uploaded_by = auth.uid()
    )
    or (
      company_id = public.auth_user_company_id()
      and public.auth_user_role() in ('pm', 'dept_head')
      and department = public.auth_user_department()
    )
    or exists (
      select 1 from public.projects p
      where p.company_id = purchase_orders.company_id
        and p.po_id = purchase_orders.id
        and (
          p.created_by = auth.uid()
          or p.pm_id = auth.uid()
          or p.team_lead_id = auth.uid()
          or exists (
            select 1 from public.project_assignments pa
            where pa.project_id = p.id
              and pa.company_id = p.company_id
              and pa.employee_id = auth.uid()
          )
        )
    )
  );

drop policy if exists rls_purchase_requests_read on public.purchase_requests;
create policy rls_purchase_requests_read on public.purchase_requests
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (company_id = public.auth_user_company_id() and created_by = auth.uid())
    or exists (
      select 1 from public.approvals a
      where a.request_id = purchase_requests.id
        and a.company_id = purchase_requests.company_id
        and a.approver_id = auth.uid()
    )
    or exists (
      select 1 from public.projects p
      where p.id = purchase_requests.project_id
        and p.company_id = purchase_requests.company_id
        and (
          (
            public.auth_user_role() in ('pm', 'dept_head')
            and p.department_id = public.auth_user_department()
          )
          or p.created_by = auth.uid()
          or p.pm_id = auth.uid()
          or p.team_lead_id = auth.uid()
          or exists (
            select 1 from public.project_assignments pa
            where pa.project_id = p.id
              and pa.company_id = p.company_id
              and pa.employee_id = auth.uid()
          )
        )
    )
  );

drop policy if exists rls_approvals_read on public.approvals;
create policy rls_approvals_read on public.approvals
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (company_id = public.auth_user_company_id() and approver_id = auth.uid())
    or exists (
      select 1 from public.purchase_requests pr
      where pr.id = approvals.request_id
        and pr.company_id = approvals.company_id
        and pr.created_by = auth.uid()
    )
  );

drop policy if exists rls_exceptions_read on public.exceptions;
create policy rls_exceptions_read on public.exceptions
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (
      company_id = public.auth_user_company_id()
      and public.auth_user_role() in ('pm', 'dept_head')
      and (
        (
          type = 'no_po'
          and exists (
            select 1 from public.projects p
            where p.id = exceptions.reference_id
              and p.company_id = exceptions.company_id
              and p.department_id = public.auth_user_department()
          )
        )
        or (
          type = 'over_budget'
          and public.auth_user_department() = 'finance'
        )
      )
    )
    or (
      company_id = public.auth_user_company_id()
      and (
        exists (
          select 1 from public.projects p
          where exceptions.type = 'no_po'
            and p.id = exceptions.reference_id
            and p.company_id = exceptions.company_id
            and p.created_by = auth.uid()
        )
        or exists (
          select 1 from public.purchase_requests pr
          where exceptions.type = 'over_budget'
            and pr.id = exceptions.reference_id
            and pr.company_id = exceptions.company_id
            and pr.created_by = auth.uid()
        )
      )
    )
  );

drop policy if exists rls_notifications_read_own on public.notifications;
create policy rls_notifications_read_own on public.notifications
  for select to authenticated
  using (company_id = public.auth_user_company_id() and user_id = auth.uid());

drop policy if exists rls_notifications_update_own_read_state on public.notifications;
create policy rls_notifications_update_own_read_state on public.notifications
  for update to authenticated
  using (company_id = public.auth_user_company_id() and user_id = auth.uid())
  with check (company_id = public.auth_user_company_id() and user_id = auth.uid());

drop policy if exists rls_audit_logs_read on public.audit_logs;
create policy rls_audit_logs_read on public.audit_logs
  for select to authenticated
  using (
    public.auth_user_role() = 'platform_admin'
    or (company_id = public.auth_user_company_id() and public.auth_user_role() = 'admin')
    or (
      company_id = public.auth_user_company_id()
      and public.auth_user_role() in ('pm', 'dept_head')
      and department_scope = public.auth_user_department()
    )
    or (company_id = public.auth_user_company_id() and user_id = auth.uid())
  );

-- No authenticated direct policies for workflow writes or email_outbox.
-- Service role bypasses RLS and is restricted to the backend only.

insert into storage.buckets (id, name, public)
values ('pr-documents', 'pr-documents', false)
on conflict (id) do update set public = false;

drop policy if exists "Public access to pr-documents" on storage.objects;
drop policy if exists "Users can upload to their own company's pr-documents" on storage.objects;
drop policy if exists "Users can read their own company's pr-documents" on storage.objects;
drop policy if exists "Users can delete their own company's pr-documents" on storage.objects;
drop policy if exists "pr_documents_read_authorized" on storage.objects;
drop policy if exists "pr_documents_write_authorized" on storage.objects;
drop policy if exists "pr_documents_delete_admin" on storage.objects;

create policy "pr_documents_read_authorized"
on storage.objects for select
to authenticated
using (
  bucket_id = 'pr-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (
    (storage.foldername(name))[2] = public.auth_user_company_id()::text
    or public.auth_user_role() = 'platform_admin'
  )
);

create policy "pr_documents_write_authorized"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'pr-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (
    public.auth_user_is_admin()
    or public.auth_user_role() in ('pm', 'dept_head')
  )
  and (storage.foldername(name))[2] = public.auth_user_company_id()::text
);

create policy "pr_documents_delete_admin"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'pr-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (
    public.auth_user_role() = 'platform_admin'
    or (
      public.auth_user_role() = 'admin'
      and (storage.foldername(name))[2] = public.auth_user_company_id()::text
    )
  )
);


