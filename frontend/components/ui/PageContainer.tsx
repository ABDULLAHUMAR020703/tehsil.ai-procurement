import { cn } from '@/lib/ui';

/** Warm content panel so list/table pages match the cream + terracotta theme (not flat white). */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8 rounded-2xl',
        'border border-stone-200/75 dark:border-stone-700/55',
        'bg-gradient-to-b from-[var(--surface-muted)] via-[var(--surface)]/50 to-orange-50/35 dark:from-stone-950 dark:via-stone-900/85 dark:to-orange-950/20',
        'shadow-[0_2px_8px_rgba(120,53,15,0.06)] dark:shadow-black/25',
        className,
      )}
    >
      {children}
    </div>
  );
}
