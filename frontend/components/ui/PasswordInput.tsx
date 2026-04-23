'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/ui';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  containerClassName?: string;
};

export function PasswordInput({ className, containerClassName, disabled, ...props }: Props) {
  const [show, setShow] = useState(false);

  return (
    <div className={cn('relative', containerClassName)}>
      <input
        type={show ? 'text' : 'password'}
        disabled={disabled}
        className={cn(
          'w-full rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900/85 px-3 py-2 pr-11 text-sm text-stone-900 dark:text-stone-100 shadow-sm placeholder:text-stone-400 dark:placeholder:text-stone-500',
          'outline-none focus:border-orange-400 dark:focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:focus:ring-orange-400/25',
          disabled && 'opacity-60 cursor-not-allowed',
          className,
        )}
        {...props}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setShow((s) => !s)}
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-center w-11 text-stone-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors',
          disabled && 'pointer-events-none opacity-50',
        )}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="w-4 h-4" strokeWidth={2} /> : <Eye className="w-4 h-4" strokeWidth={2} />}
      </button>
    </div>
  );
}
