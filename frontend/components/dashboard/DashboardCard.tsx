'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Card } from '../ui/Card';

type Props = {
  title: string;
  value: number;
  onClick: () => void;
  accentClass?: string;
};

export function DashboardCard({
  title,
  value,
  onClick,
  accentClass = 'from-orange-50 via-[var(--surface)] to-rose-50/90 dark:from-orange-950/40 dark:via-stone-900/95 dark:to-rose-950/35',
}: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      whileHover={reduceMotion ? undefined : { scale: 1.02, y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
      className="h-full"
    >
      <button
        type="button"
        onClick={onClick}
        className={[
          'w-full h-full text-left cursor-pointer rounded-xl transition-all duration-300',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/45 dark:focus-visible:ring-orange-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]',
          'hover:shadow-lg hover:shadow-orange-500/15 dark:hover:shadow-orange-950/30',
        ].join(' ')}
      >
        <Card
          className={`p-4 h-full border border-stone-200/90 dark:border-stone-600/70 bg-gradient-to-br ${accentClass} hover:border-orange-200/90 dark:hover:border-orange-500/35 relative overflow-hidden group shadow-sm`}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-orange-200/30 dark:from-orange-500/10 to-transparent pointer-events-none" />
          <div className="relative">
            <div className="text-sm text-muted-foreground font-medium">{title}</div>
            <div className="text-2xl font-semibold mt-1 text-stone-900 dark:text-stone-50 tabular-nums">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-orange-600 dark:text-orange-400 font-semibold mt-2">
              Click to drill down
            </div>
          </div>
        </Card>
      </button>
    </motion.div>
  );
}
