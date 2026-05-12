import { supabaseAdmin } from '../../config/supabase';

export type AuditEntityType =
  | 'purchase_order'
  | 'purchase_request'
  | 'project'
  | 'approval'
  | 'exception';

export type LastUpdatedByUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
};

export type LastUpdatedFields = {
  last_updated_at: string | null;
  last_updated_by: LastUpdatedByUser | null;
};

export type LastActivityResult = LastUpdatedFields & {
  last_action: string | null;
};

export type RowWithTouch = {
  id: string;
  updated_at?: string | null;
  updated_by?: string | null;
};

const CHUNK = 200;

/** Latest audit row per entity id (first hit wins because logs are ordered by timestamp desc). */
export async function fetchLatestAuditTouchByEntity(
  entityType: AuditEntityType,
  entityIds: string[],
  companyId: string,
): Promise<Map<string, { timestamp: string; user_id: string | null; action: string | null }>> {
  const latest = new Map<string, { timestamp: string; user_id: string | null; action: string | null }>();
  const unique = [...new Set(entityIds)].filter(Boolean);
  if (unique.length === 0) return latest;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('entity_id, user_id, timestamp, action')
      .eq('entity_type', entityType)
      .eq('company_id', companyId)
      .in('entity_id', chunk)
      .order('timestamp', { ascending: false })
      .limit(5000);
    if (error) throw error;
    for (const row of data ?? []) {
      const eid = row.entity_id as string;
      if (!latest.has(eid)) {
        latest.set(eid, {
          timestamp: String(row.timestamp),
          user_id: (row.user_id as string | null) ?? null,
          action: (row.action as string | null) ?? null,
        });
      }
    }
  }
  return latest;
}

async function loadUsersByIds(ids: string[], companyId: string): Promise<Map<string, LastUpdatedByUser>> {
  const map = new Map<string, LastUpdatedByUser>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('company_id', companyId)
      .in('id', chunk);
    if (error) throw error;
    for (const u of data ?? []) {
      map.set(u.id as string, {
        id: u.id as string,
        name: (u.name as string | null) ?? null,
        email: (u.email as string | null) ?? null,
        role: (u.role as string | null) ?? null,
      });
    }
  }
  return map;
}

/**
 * Prefer latest audit_logs row; fall back to table `updated_at` / `updated_by`.
 * Merges latest audit log (and user) with row `updated_*` fallbacks. Preserves all other row fields.
 */
export async function attachLastUpdatedFields<T extends RowWithTouch>(
  entityType: AuditEntityType,
  rows: T[],
  companyId: string,
): Promise<Array<T & LastUpdatedFields>> {
  if (rows.length === 0) return [];

  const auditMap = await fetchLatestAuditTouchByEntity(
    entityType,
    rows.map((r) => r.id),
    companyId,
  );

  const userIds = new Set<string>();
  for (const r of rows) {
    const a = auditMap.get(r.id);
    if (a?.user_id) userIds.add(a.user_id);
    const ub = r.updated_by;
    if (ub) userIds.add(ub);
  }
  const users = await loadUsersByIds([...userIds], companyId);

  return rows.map((r) => {
    const audit = auditMap.get(r.id);
    let at: string | null = null;
    let uid: string | null = null;
    if (audit?.timestamp) {
      at = audit.timestamp;
      uid = audit.user_id;
    } else if (r.updated_at) {
      at = String(r.updated_at);
      uid = r.updated_by ?? null;
    }
    const by = uid ? users.get(uid) ?? null : null;
    return {
      ...r,
      last_updated_at: at,
      last_updated_by: by,
    };
  });
}

/** Latest audit-driven activity for a single entity (PO / PR / project / approval / exception). */
export async function getLastActivity(
  entityType: AuditEntityType,
  entityId: string,
  companyId: string,
  rowFallback?: RowWithTouch | null,
): Promise<LastActivityResult> {
  const auditMap = await fetchLatestAuditTouchByEntity(entityType, [entityId], companyId);
  const audit = auditMap.get(entityId);

  const userIds = new Set<string>();
  if (audit?.user_id) userIds.add(audit.user_id);
  if (rowFallback?.updated_by) userIds.add(rowFallback.updated_by);
  const users = await loadUsersByIds([...userIds], companyId);

  let at: string | null = null;
  let uid: string | null = null;
  let lastAction: string | null = null;
  if (audit?.timestamp) {
    at = audit.timestamp;
    uid = audit.user_id;
    lastAction = audit.action ?? null;
  } else if (rowFallback?.updated_at) {
    at = String(rowFallback.updated_at);
    uid = rowFallback.updated_by ?? null;
  }

  const by = uid ? users.get(uid) ?? null : null;
  return {
    last_updated_at: at,
    last_updated_by: by,
    last_action: lastAction,
  };
}
