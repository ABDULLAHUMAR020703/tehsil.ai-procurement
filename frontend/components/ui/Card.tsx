import { cn } from '@/lib/ui';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-stone-200/90 dark:border-stone-600/75 p-6 shadow-sm shadow-stone-200/35 dark:shadow-stone-950/40',
        'bg-gradient-to-br from-[var(--surface)] to-orange-50/45 dark:from-stone-900/85 dark:to-stone-900',
        className,
      )}
    >
      {children}
    </div>
  );
}
