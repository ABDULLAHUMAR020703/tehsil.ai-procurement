import { cn } from '@/lib/ui';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type ButtonSize = 'default' | 'icon';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ className, variant = 'primary', size = 'default', type = 'button', ...props }: ButtonProps) {
  const variantClass =
    variant === 'secondary'
      ? 'border border-stone-300 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-800 text-stone-800 dark:text-stone-100 shadow-sm hover:bg-stone-50 dark:hover:bg-stone-700 hover:border-stone-400 dark:hover:border-stone-500'
      : variant === 'danger'
        ? 'bg-rose-600 text-white shadow-sm hover:bg-rose-700'
        : variant === 'success'
          ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
          : variant === 'ghost'
            ? 'text-stone-700 dark:text-stone-200 hover:bg-stone-100/80 dark:hover:bg-stone-800/70'
            : 'bg-gradient-to-r from-orange-500 to-rose-500 text-white shadow-sm shadow-orange-500/25 hover:brightness-105 dark:from-orange-600 dark:to-rose-600';
  const sizeClass = size === 'icon' ? 'h-10 w-10 p-0' : 'px-4 py-2';

  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        variantClass,
        sizeClass,
        className,
      )}
      {...props}
    />
  );
}
