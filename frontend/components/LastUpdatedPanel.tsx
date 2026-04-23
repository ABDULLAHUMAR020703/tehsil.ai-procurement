'use client';

import { Button } from './ui/Button';

export type ActorSummary = { id: string; name?: string | null; email?: string | null; role?: string | null } | null;

function formatRole(role: string | null | undefined): string {
  if (!role) return '';
  if (role === 'pm') return 'PM';
  if (role === 'dept_head') return 'Dept head';
  if (role === 'admin') return 'Admin';
  if (role === 'employee') return 'Team member';
  return role;
}

function displayName(actor: ActorSummary): string {
  if (!actor) return 'Unknown';
  return actor.name?.trim() || actor.email?.trim() || actor.id.slice(0, 8) + '…';
}

function isWithin24h(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

/** Compact two-line block for tables and cards. */
export function LastUpdatedMeta({
  at,
  user,
}: {
  at: string | null | undefined;
  user: { id?: string; name?: string | null; email?: string | null; role?: string | null } | null | undefined;
}) {
  const hasUser = Boolean(user && (user.name?.trim() || user.email?.trim() || user.id));
  if (!at && !hasUser) {
    return <span className="text-muted-foreground">Not updated yet</span>;
  }
  const name = hasUser ? displayName(user as ActorSummary) : '—';
  return (
    <div className="text-[11px] text-muted-foreground space-y-0.5 leading-snug">
      <div>
        Last updated by:{' '}
        <span className="text-stone-900 dark:text-stone-100 font-medium">{hasUser ? name : '—'}</span>
      </div>
      <div>
        At: <span className="text-stone-900 dark:text-stone-100 font-medium">{at ? new Date(at).toLocaleString() : '—'}</span>
      </div>
    </div>
  );
}

type Props = {
  updatedAt: string | null | undefined;
  updatedBy: ActorSummary;
  onViewHistory?: () => void;
  className?: string;
};

export function LastUpdatedPanel({ updatedAt, updatedBy, onViewHistory, className }: Props) {
  const hasActor = Boolean(updatedBy && (updatedBy.name?.trim() || updatedBy.email?.trim() || updatedBy.id));
  const notYet = !updatedAt && !hasActor;
  const recent = isWithin24h(updatedAt ?? null);
  const when = updatedAt ? new Date(updatedAt).toLocaleString() : null;
  const who = hasActor ? `${displayName(updatedBy)} (${formatRole(updatedBy?.role)})` : null;

  return (
    <div
      className={`rounded-lg border border-stone-200 dark:border-stone-600 bg-stone-50/90 dark:bg-stone-800/50 px-4 py-3 text-sm space-y-2 ${className ?? ''}`}
    >
      {notYet ? (
        <div className="text-muted-foreground">Not updated yet</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {recent ? (
              <span className="rounded-full bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/70">
                Recently updated
              </span>
            ) : null}
          </div>
          <div className="text-muted-foreground">
            Last updated by: <span className="text-stone-900 dark:text-stone-100 font-medium">{who ?? '—'}</span>
          </div>
          <div className="text-muted-foreground">
            At: <span className="text-stone-900 dark:text-stone-100 font-medium">{when ?? '—'}</span>
          </div>
        </>
      )}
      {onViewHistory ? (
        <Button type="button" variant="secondary" className="mt-1 text-xs px-3 py-1.5" onClick={onViewHistory}>
          View history
        </Button>
      ) : null}
    </div>
  );
}
