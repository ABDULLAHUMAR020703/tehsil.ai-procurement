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
