import { cn } from '@/lib/ui';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ className, variant = 'primary', type = 'button', ...props }: ButtonProps) {
  const variantClass =
    variant === 'secondary'
      ? 'border border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-800 text-stone-800 dark:text-stone-100 shadow-sm hover:bg-stone-50 dark:hover:bg-stone-700 hover:border-stone-400 dark:hover:border-stone-500'
      : variant === 'danger'
        ? 'bg-rose-600 text-white shadow-sm hover:bg-rose-700'
        : variant === 'success'
          ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
          : 'bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm shadow-orange-500/25 hover:brightness-105 dark:from-orange-600 dark:to-rose-600';

  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        variantClass,
        className,
      )}
      {...props}
    />
  );
}
