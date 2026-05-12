import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { env } from '../../config/env';
import { seedDefaultDepartmentsForCompany } from '../departments/service';

export type OnboardCompanyInput = {
  companyName: string;
  country?: string | null;
  timezone?: string | null;
  currency?: string | null;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminPhone?: string | null;
  logoBuffer?: Buffer | null;
  logoMime?: string | null;
  logoExt?: string | null;
};

export async function onboardNewCompany(input: OnboardCompanyInput) {
  const name = input.companyName.trim();
  if (!name) throw new AppError('Company name is required', 400);

  const { data: existing, error: exErr } = await supabaseAdmin.from('companies').select('id').eq('name', name).maybeSingle();
  if (exErr) throw exErr;
  if (existing) throw new AppError('A company with this name already exists', 409);

  const { data: company, error: cErr } = await supabaseAdmin
    .from('companies')
    .insert({
      name,
      country: input.country?.trim() || null,
      timezone: input.timezone?.trim() || null,
      currency: input.currency?.trim() || null,
    })
    .select('id, name, logo_url, country, timezone, currency, is_active, created_at')
    .single();
  if (cErr || !company) throw cErr ?? new AppError('Failed to create company', 500);
  const companyId = company.id as string;

  let logoUrl: string | null = null;
  if (input.logoBuffer?.length) {
    const bucket = env.SUPABASE_STORAGE_BUCKET_DOCUMENTS;
    const ext = input.logoExt || '.png';
    const path = `documents/${companyId}/logo-${Date.now()}${ext}`.replace(/\\/g, '/');
    const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, input.logoBuffer, {
      contentType: input.logoMime ?? 'application/octet-stream',
      upsert: true,
    });
    if (upErr) throw upErr;
    logoUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
    const { error: luErr } = await supabaseAdmin.from('companies').update({ logo_url: logoUrl }).eq('id', companyId);
    if (luErr) throw luErr;
  }

  await seedDefaultDepartmentsForCompany(companyId);

  const { error: csErr } = await supabaseAdmin.from('company_settings').insert({ company_id: companyId });
  if (csErr) throw csErr;

  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: input.adminEmail.trim().toLowerCase(),
    password: input.adminPassword,
    email_confirm: true,
    user_metadata: { full_name: input.adminName.trim() },
  });
  if (authErr || !authData?.user) throw authErr ?? new AppError('Failed to create auth user', 500);
  const newUserId = authData.user.id;

  const { error: uErr } = await supabaseAdmin.from('users').insert({
    id: newUserId,
    name: input.adminName.trim(),
    email: input.adminEmail.trim().toLowerCase(),
    role: 'admin',
    department: 'operations',
    company_id: companyId,
    phone: input.adminPhone?.trim() || null,
  });
  if (uErr) throw uErr;

  const { data: out, error: oErr } = await supabaseAdmin
    .from('companies')
    .select('id, name, logo_url, country, timezone, currency, is_active, created_at')
    .eq('id', companyId)
    .single();
  if (oErr || !out) throw oErr ?? new AppError('Failed to load company', 500);

  return { company: { ...out, logo_url: logoUrl ?? (out.logo_url as string | null) }, adminUserId: newUserId };
}
