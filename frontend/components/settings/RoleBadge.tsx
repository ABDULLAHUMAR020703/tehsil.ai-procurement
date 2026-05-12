import { cn } from '@/lib/ui';

const LABELS: Record<string, string> = {
  admin: 'Admin',
  pm: 'PM',
  dept_head: 'Dept head',
  employee: 'Employee',
};

function badgeClass(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-orange-200/90 text-orange-950 border-orange-400/70 dark:bg-orange-950/55 dark:text-orange-100 dark:border-orange-700/60';
    case 'pm':
      return 'bg-amber-100 text-amber-950 border-amber-300/80 dark:bg-amber-950/45 dark:text-amber-100 dark:border-amber-700/50';
    case 'dept_head':
      return 'bg-amber-50 text-amber-950 border-amber-200 dark:bg-stone-800 dark:text-amber-100 dark:border-amber-800/50';
    case 'employee':
      return 'bg-stone-100 text-stone-800 border-stone-300 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-600';
    default:
      return 'bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-950/50 dark:text-orange-100 dark:border-orange-700/60';
  }
}

export function RoleBadge({ role }: { role: string }) {
  const label = LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={cn(
        'inline-flex px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md border',
        badgeClass(role),
      )}
    >
      {label}
    </span>
  );
}
