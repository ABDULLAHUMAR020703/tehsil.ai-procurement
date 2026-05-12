import { supabaseAdmin } from '../../config/supabase';
import type { UserRole } from '../auth/types';
import { bypassesDepartmentScope } from '../auth/types';

export type ActivityFeedItem = {
  id: string;
  action: string;
  timestamp: string;
  entity_type: string;
  entity_id: string;
  department_scope: string | null;
  actor: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

/**
 * Cross-entity activity for dashboard. Non-admin rows are limited to `department_scope` matching the actor's department.
 * Admins see all rows, optionally filtered by `filterDepartment` (query param).
 */
export async function fetchActivityFeed(params: {
  limit: number;
  actorRole: UserRole;
  actorDepartment: string | null;
  filterDepartment?: string | null;
  companyId: string;
}): Promise<ActivityFeedItem[]> {
  const orgWide = bypassesDepartmentScope(params.actorRole);
  let q = supabaseAdmin
    .from('audit_logs')
    .select('id, action, user_id, timestamp, entity_type, entity_id, department_scope')
    .eq('company_id', params.companyId)
    .order('timestamp', { ascending: false })
    .limit(Math.min(Math.max(params.limit, 1), 200));

  if (!orgWide) {
    const d = params.actorDepartment;
    if (!d) return [];
    q = q.eq('department_scope', d);
  } else if (params.filterDepartment) {
    q = q.eq('department_scope', params.filterDepartment);
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const uids = [...new Set(rows.map((r) => r.user_id as string | null).filter(Boolean))] as string[];
  let actorMap = new Map<string, { id: string; name: string | null; email: string | null; role: string | null }>();
  if (uids.length > 0) {
    const { data: us, error: uErr } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('company_id', params.companyId)
      .in('id', uids);
    if (uErr) throw uErr;
    actorMap = new Map(
      (us ?? []).map((u) => [
        u.id as string,
        {
          id: u.id as string,
          name: (u.name as string | null) ?? null,
          email: (u.email as string | null) ?? null,
          role: (u.role as string | null) ?? null,
        },
      ]),
    );
  }

  return rows.map((r) => ({
    id: r.id as string,
    action: r.action as string,
    timestamp: String(r.timestamp),
    entity_type: r.entity_type as string,
    entity_id: r.entity_id as string,
    department_scope: (r.department_scope as string | null) ?? null,
    actor: r.user_id ? actorMap.get(r.user_id as string) ?? null : null,
  }));
}
