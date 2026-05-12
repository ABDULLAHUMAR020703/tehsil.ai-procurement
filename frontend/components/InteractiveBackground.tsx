'use client';

import { motion, useReducedMotion } from 'framer-motion';

/** Warm mesh (coral / amber / rose) + grid; animates gently; respects reduced motion. */
export default function InteractiveBackground() {
  const reduceMotion = useReducedMotion();

  const blob = (
    className: string,
    animate: { y?: number[]; x?: number[]; scale?: number[] },
    t: { duration: number; delay?: number },
  ) =>
    reduceMotion ? (
      <div className={className} />
    ) : (
      <motion.div
        className={className}
        animate={animate}
        transition={{ ...t, repeat: Infinity, ease: 'easeInOut' }}
      />
    );

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[var(--background)] transition-[background] duration-500 ease-out" />

      {blob(
        'absolute -top-28 -right-20 h-[400px] w-[400px] rounded-full blur-3xl bg-gradient-to-br from-orange-400/35 to-rose-500/25 dark:from-orange-600/20 dark:to-rose-600/15',
        { y: [0, -22, 0], x: [0, 10, 0] },
        { duration: 17 },
      )}
      {blob(
        'absolute top-1/3 -left-28 h-[360px] w-[360px] rounded-full blur-3xl bg-gradient-to-tr from-amber-300/30 to-orange-400/25 dark:from-amber-600/12 dark:to-orange-500/10',
        { y: [0, 18, 0], x: [0, -14, 0] },
        { duration: 20, delay: 0.8 },
      )}
      {blob(
        'absolute bottom-[-40px] right-1/4 h-[280px] w-[280px] rounded-full blur-3xl bg-gradient-to-tl from-rose-400/25 to-amber-200/30 dark:from-rose-500/15 dark:to-amber-600/10',
        { y: [0, -14, 0], scale: [1, 1.06, 1] },
        { duration: 15, delay: 0.4 },
      )}

      <div
        className="absolute inset-0 opacity-[var(--grid-opacity)] transition-opacity duration-500"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%2378716c' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
