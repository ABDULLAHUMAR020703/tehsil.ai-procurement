import { supabaseAdmin } from '../../config/supabase';

async function companyIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('users').select('company_id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return (data?.company_id as string | undefined) ?? null;
}

export async function createInAppNotification(params: { userId: string; type: string; message: string }) {
  const companyId = await companyIdForUser(params.userId);
  if (!companyId) throw new Error('createInAppNotification: user missing company_id');

  const { error } = await supabaseAdmin.from('notifications').insert({
    user_id: params.userId,
    company_id: companyId,
    type: params.type,
    message: params.message,
    is_read: false,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function enqueueEmailPlaceholder(params: {
  toEmail: string;
  subject: string;
  body: string;
  userId?: string;
}) {
  let companyId: string | null = null;
  if (params.userId) {
    companyId = await companyIdForUser(params.userId);
  }
  if (!companyId) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('company_id')
      .ilike('email', params.toEmail)
      .maybeSingle();
    if (error) throw error;
    companyId = (data?.company_id as string | undefined) ?? null;
  }
  if (!companyId) throw new Error('enqueueEmailPlaceholder: could not resolve company_id');

  const { error } = await supabaseAdmin.from('email_outbox').insert({
    to_email: params.toEmail,
    subject: params.subject,
    body: params.body,
    status: 'queued',
    company_id: companyId,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getAdminUserIds(companyId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('company_id', companyId)
    .eq('role', 'admin');
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

export async function notifyAllAdmins(params: { type: string; message: string; companyId: string }) {
  const ids = await getAdminUserIds(params.companyId);
  for (const id of ids) {
    await createInAppNotification({
      userId: id,
      type: params.type,
      message: params.message,
    });
  }
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.email ?? null;
}
