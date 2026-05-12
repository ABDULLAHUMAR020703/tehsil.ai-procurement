import { formatPkr } from '../../lib/api';

/** Safe display for missing API fields. */
export function na(value: unknown): string {
  if (value == null) return 'N/A';
  if (typeof value === 'string' && !value.trim()) return 'N/A';
  return String(value);
}

export function prStatusBadgeClasses(status: string): string {
  const u = status.toLowerCase().replace(/\s+/g, '_');
  const base = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize';
  if (u === 'approved')
    return `${base} bg-orange-100 text-orange-900 ring-1 ring-orange-300/70 dark:bg-orange-950/50 dark:text-orange-100 dark:ring-orange-700/50`;
  if (u === 'rejected') return `${base} bg-red-100 text-red-800 ring-1 ring-red-200/60`;
  if (u === 'pending' || u === 'pending_exception') return `${base} bg-amber-100 text-amber-900 ring-1 ring-amber-200/70`;
  return `${base} bg-gray-100 text-gray-700 ring-1 ring-gray-200/80`;
}

export function projectStatusBadgeClasses(status: string): string {
  const u = status.toLowerCase();
  const base = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium capitalize';
  if (u === 'active')
    return `${base} bg-orange-100 text-orange-900 ring-1 ring-orange-300/70 dark:bg-orange-950/50 dark:text-orange-100 dark:ring-orange-700/50`;
  if (u === 'archived') return `${base} bg-gray-200 text-gray-800 ring-1 ring-gray-300/80`;
  return `${base} bg-amber-100 text-amber-900 ring-1 ring-amber-200/70`;
}

export function formatPkrSafe(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'N/A';
  return formatPkr(n);
}
