import { cn } from '@/lib/ui';

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900/80 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 shadow-sm placeholder:text-stone-400 dark:placeholder:text-stone-500',
        'outline-none focus:border-orange-400 dark:focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:focus:ring-orange-400/25',
        className,
      )}
      {...props}
    />
  );
}
