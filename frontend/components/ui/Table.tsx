import type { ReactNode, TdHTMLAttributes } from 'react';
import { cn } from '@/lib/ui';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={cn('w-full text-sm', className)}>{children}</table>;
}

export function TableWrapper({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto', className)}>{children}</div>;
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <thead
      className={cn(
        'text-stone-600 dark:text-stone-400 uppercase tracking-wide text-xs font-semibold bg-stone-100/95 dark:bg-stone-800/90 border-b border-stone-200/90 dark:border-stone-600/70',
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function TBody({ children, className }: { children: ReactNode; className?: string }) {
  return <tbody className={cn('divide-y divide-stone-100 dark:divide-stone-700', className)}>{children}</tbody>;
}

export function TR({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('hover:bg-stone-50/90 dark:hover:bg-stone-800/55 transition-colors', className)}>{children}</tr>
  );
}

export function TH({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn('text-left font-medium px-4 py-3', className)}>{children}</th>;
}

export function TD({
  children,
  className,
  colSpan,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3', className)} colSpan={colSpan} {...rest}>
      {children}
    </td>
  );
}
