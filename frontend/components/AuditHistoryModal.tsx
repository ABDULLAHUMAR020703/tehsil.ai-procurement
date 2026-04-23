'use client';

import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authedFetchWithSupabase, NoSessionError } from '../lib/api';
import { Button } from './ui/Button';

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  performedBy: { id: string; name: string | null; email: string | null; role: string | null } | null;
  reason: string | null;
  changes: Record<string, unknown> | null;
  timestamp: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  entityType: 'purchase_request' | 'project' | 'purchase_order' | 'approval';
  entityId: string;
  title?: string;
  supabase: SupabaseClient | null;
  token: string;
  onAuthRedirect?: () => void;
};

function actionTone(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('reject')) {
    return 'border-l-rose-500 dark:border-l-rose-400 bg-rose-50/80 dark:bg-rose-950/35';
  }
  if (a.includes('approv') || a.includes('budget_deducted')) {
    return 'border-l-orange-500 dark:border-l-orange-400 bg-orange-50/85 dark:bg-orange-950/30';
  }
  return 'border-l-orange-500 dark:border-l-orange-400 bg-orange-50/50 dark:bg-orange-950/25';
}

export function AuditHistoryModal({
  open,
  onClose,
  entityType,
  entityId,
  title = 'Activity history',
  supabase,
  token,
  onAuthRedirect,
}: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', entityType, entityId],
    enabled: open && !!token && !!supabase && !!entityId,
    queryFn: async () => {
      try {
        return await authedFetchWithSupabase<{ auditLogs: AuditLogRow[] }>(
          supabase!,
          `/api/audit-logs/${entityType}/${entityId}`,
        );
      } catch (e) {
        if (e instanceof NoSessionError) onAuthRedirect?.();
        throw e;
      }
    },
  });

  if (!open) return null;

  const logs = data?.auditLogs ?? [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-stone-900/50 dark:bg-black/60 backdrop-blur-[2px] p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-history-title"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-slate-200 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 dark:border-stone-700 px-4 py-3">
          <h2 id="audit-history-title" className="text-base font-semibold text-stone-900 dark:text-stone-50">
            {title}
          </h2>
          <Button type="button" variant="secondary" className="text-xs px-2 py-1" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3 flex-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {error instanceof Error ? error.message : 'Failed to load history'}
            </p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history entries for this record.</p>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`rounded-lg border border-stone-200 dark:border-stone-600 border-l-4 pl-3 pr-2 py-2 text-sm ${actionTone(log.action)}`}
              >
                <div className="font-medium text-foreground">{log.action.replace(/_/g, ' ')}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {log.performedBy?.name || log.performedBy?.email || log.performedBy?.id?.slice(0, 8) || 'System'}
                  {log.performedBy?.role ? ` · ${log.performedBy.role}` : ''}
                </div>
                <div className="text-xs text-muted-foreground">{new Date(log.timestamp).toLocaleString()}</div>
                {log.reason ? (
                  <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-words">{log.reason}</div>
                ) : null}
                {log.changes && Object.keys(log.changes).length > 0 ? (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-600 p-2 text-[11px] text-stone-700 dark:text-stone-300">
                    {JSON.stringify(log.changes, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
