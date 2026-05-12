'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { APP_NAME } from '@/lib/appMeta';

export default function Header() {
  return (
    <motion.header
      initial={{ y: -14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-0 left-0 w-full flex items-center justify-between px-6 md:px-10 py-5 z-10 border-b border-stone-200/80 dark:border-stone-700/80 bg-[var(--surface)]/80 dark:bg-stone-900/75 backdrop-blur-md"
    >
      <BrandLogo size="md">
        <span className="font-bold tracking-tight text-sm text-stone-900 dark:text-stone-50">{APP_NAME}</span>
      </BrandLogo>

      <nav className="hidden md:flex items-center gap-8 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400">
        <Link href="/" className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
          HOME
        </Link>
        <Link href="/login" className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
          SIGN IN
        </Link>
      </nav>

      <div className="flex items-center gap-3">
        <ThemeToggle compact className="hidden sm:inline-flex" />
        <Link
          href="/login"
          className="px-5 py-2 text-xs font-semibold tracking-wide rounded-xl border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-800 text-stone-800 dark:text-stone-100 shadow-sm hover:border-orange-300 dark:hover:border-orange-500/40 hover:shadow-md hover:shadow-orange-500/10 transition-all"
        >
          SIGN IN
        </Link>
      </div>
    </motion.header>
  );
}
