import { supabaseAdmin } from '../../config/supabase';
import { createInAppNotification, enqueueEmailPlaceholder, getUserEmail } from '../notifications/service';
import { writeAuditLog, type AuditLogInsert } from './service';

export type TouchableTable = 'projects' | 'purchase_orders' | 'purchase_requests' | 'approvals';

export type TrackedNotifyEntry = {
  userId: string;
  type: string;
  message: string;
  emailSubject?: string;
};

/** Bump row `updated_by` so DB triggers refresh `updated_at`. Always scoped by tenant. */
export async function touchEntityRow(
  table: TouchableTable,
  id: string,
  userId: string,
  companyId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from(table).update({ updated_by: userId }).eq('id', id).eq('company_id', companyId);
  if (error) throw error;
}

/** Deduped in-app (+ optional email) delivery; use after multiple `writeAuditLog` rows in one operation. */
export async function deliverTrackedNotifications(entries: TrackedNotifyEntry[]): Promise<void> {
  const seen = new Set<string>();
  for (const n of entries) {
    const key = `${n.userId}\0${n.type}\0${n.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await createInAppNotification({ userId: n.userId, type: n.type, message: n.message });
    if (n.emailSubject) {
      const email = await getUserEmail(n.userId);
      if (email) {
        await enqueueEmailPlaceholder({
          toEmail: email,
          subject: n.emailSubject,
          body: n.message,
          userId: n.userId,
        });
      }
    }
  }
}

/**
 * Single path for meaningful domain events: audit row (with optional department scope for feeds),
 * optional entity touch for `last_updated_*` consistency, and in-app (+ optional email) notifications.
 */
export async function recordTrackedAction(params: {
  audit: AuditLogInsert;
  touch?: { table: TouchableTable; id: string; companyId: string };
  notify?: TrackedNotifyEntry[];
}): Promise<void> {
  await writeAuditLog(params.audit);
  if (params.touch) {
    await touchEntityRow(params.touch.table, params.touch.id, params.audit.userId, params.touch.companyId);
  }
  if (params.notify && params.notify.length > 0) {
    await deliverTrackedNotifications(params.notify);
  }
}
