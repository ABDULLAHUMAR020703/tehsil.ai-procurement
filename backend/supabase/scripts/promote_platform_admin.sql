-- One-time: promote an existing user to platform_admin (replace email).
-- Platform admins keep their company_id row for FK/profile but the API bypasses tenant filters for this role.

update public.users
set role = 'platform_admin'
where lower(email) = lower('REPLACE_WITH_EMAIL@example.com');
