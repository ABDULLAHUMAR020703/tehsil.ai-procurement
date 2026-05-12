'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/ui';
import type { ThemePreference } from '@/features/theme/ThemeProvider';
import { useTheme } from '@/features/theme/ThemeProvider';

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Match system', icon: Monitor },
];

type Props = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className, compact }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        'inline-flex rounded-xl border border-stone-200/90 dark:border-stone-600/80 bg-[var(--surface)]/90 dark:bg-stone-900/90 backdrop-blur-sm p-1 shadow-sm',
        className,
      )}
      role="group"
      aria-label="Color theme"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              'rounded-lg transition-all duration-200 flex items-center justify-center',
              compact ? 'p-2' : 'px-2.5 py-2',
              active
                ? 'bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-md shadow-orange-500/25'
                : 'text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100/90 dark:hover:bg-stone-800/80',
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
