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
