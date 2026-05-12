'use client';

import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import Header from '../components/Header';
import InteractiveBackground from '../components/InteractiveBackground';
import { BrandLogo } from '../components/BrandLogo';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart2,
  ChevronDown,
  ClipboardList,
  Layers,
  LogIn,
  Route,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { APP_NAME } from '@/lib/appMeta';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.09, delayChildren: 0.06 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const features = [
  { title: 'Multi-tier', sub: 'Approval workflows', tone: 'text-orange-600 dark:text-orange-400', glow: 'from-orange-500/25' },
  { title: 'Budgets', sub: 'PO & project limits', tone: 'text-rose-600 dark:text-rose-400', glow: 'from-rose-500/25' },
  { title: 'Exceptions', sub: 'Smart handling', tone: 'text-amber-700 dark:text-amber-400', glow: 'from-amber-500/25' },
  { title: 'RBAC', sub: 'Secure roles', tone: 'text-red-700 dark:text-red-400', glow: 'from-red-500/20' },
];

const steps = [
  {
    icon: ClipboardList,
    title: 'Capture requests',
    desc: 'PRs tied to projects, PO lines, and documents in one flow.',
    accent: 'from-orange-500/30 to-rose-500/20',
  },
  {
    icon: Route,
    title: 'Route approvals',
    desc: 'Team Lead → PM stages with clear ownership and audit trail.',
    accent: 'from-amber-500/30 to-orange-500/20',
  },
  {
    icon: Wallet,
    title: 'Guard budgets',
    desc: 'Live PO remaining and limits before spend is committed.',
    accent: 'from-rose-500/25 to-amber-500/25',
  },
];

const HERO_SUBTITLE =
  'Automate procurement with role-based approvals, exception handling, and budget / PO tracking—from PO lines to final sign-off, all in one place.';

export default function LandingPage() {
  const reduceMotion = useReducedMotion();
  const scrollRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: scrollRef, offset: ['start start', 'end start'] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, reduceMotion ? 0 : 80]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, reduceMotion ? 1 : 0.985]);
  const subtitleWords = HERO_SUBTITLE.split(' ');

  return (
    <div
      ref={scrollRef}
      className="min-h-screen relative overflow-hidden font-sans text-stone-800 dark:text-stone-100"
    >
      <InteractiveBackground />
      <Header />

      <motion.div style={{ y: heroY, scale: heroScale }} className="will-change-transform">
        <main className="pt-28 md:pt-36 px-6 max-w-7xl mx-auto flex flex-col items-center text-center pb-24">
          {/* Decorative rings */}
          {!reduceMotion ? (
            <>
              <motion.div
                className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 w-[min(90vw,520px)] h-[min(90vw,520px)] rounded-full border border-orange-200/40 dark:border-orange-500/15"
                animate={{ scale: [1, 1.03, 1], opacity: [0.35, 0.55, 0.35] }}
                transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
                aria-hidden
              />
              <motion.div
                className="pointer-events-none absolute left-1/2 top-[20%] -translate-x-1/2 w-[min(78vw,440px)] h-[min(78vw,440px)] rounded-full border border-rose-300/25 dark:border-rose-500/10"
                animate={{ scale: [1.02, 1, 1.02], opacity: [0.2, 0.4, 0.2], rotate: [0, 3, 0] }}
                transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
                aria-hidden
              />
            </>
          ) : null}

          {/* Floating orbs (hero only) */}
          {!reduceMotion ? (
            <>
              <motion.div
                className="pointer-events-none absolute top-[28%] left-[12%] md:left-[18%] w-2 h-2 rounded-full bg-orange-400/80 dark:bg-orange-400/50 shadow-lg shadow-orange-500/40"
                animate={{ y: [0, -14, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
                aria-hidden
              />
              <motion.div
                className="pointer-events-none absolute top-[40%] right-[14%] md:right-[20%] w-1.5 h-1.5 rounded-full bg-rose-400/90 dark:bg-rose-400/55"
                animate={{ y: [0, 12, 0], x: [0, 6, 0] }}
                transition={{ duration: 6.2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                aria-hidden
              />
              <motion.div
                className="pointer-events-none absolute top-[52%] left-[22%] w-1 h-1 rounded-full bg-amber-400/90"
                animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0.9, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                aria-hidden
              />
            </>
          ) : null}

          <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl space-y-6 relative z-[1]">
            <motion.div variants={fadeUp}>
              <motion.div
                whileHover={reduceMotion ? undefined : { scale: 1.03 }}
                transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              >
                <BrandLogo size="xl" className="justify-center mb-2" />
              </motion.div>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-orange-200/90 dark:border-orange-500/35 bg-orange-50/90 dark:bg-orange-950/40 px-4 py-1.5 text-xs font-semibold text-orange-800 dark:text-orange-200"
            >
              <motion.span
                animate={reduceMotion ? undefined : { rotate: [0, 14, -14, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden />
              </motion.span>
              Procurement workspace
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-5xl md:text-7xl font-bold text-stone-900 dark:text-stone-50 tracking-tight leading-tight"
            >
              <motion.span
                className="inline-block"
                initial={reduceMotion ? false : { opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
              >
                {APP_NAME}
              </motion.span>
              <br />
              <motion.span
                className="inline-block text-4xl md:text-6xl bg-gradient-to-r from-orange-500 via-rose-500 to-amber-500 dark:from-orange-400 dark:via-rose-400 dark:to-amber-300 bg-clip-text text-transparent"
                style={{ backgroundSize: '200% auto' }}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.92, backgroundPosition: '0% 50%' }}
                animate={
                  reduceMotion
                    ? { opacity: 1, scale: 1 }
                    : {
                        opacity: 1,
                        scale: 1,
                        backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                      }
                }
                transition={
                  reduceMotion
                    ? { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
                    : {
                        opacity: { duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.18 },
                        scale: { duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.18 },
                        backgroundPosition: { duration: 12, repeat: Infinity, ease: 'linear', delay: 1 },
                      }
                }
              >
                Procurement
              </motion.span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-stone-600 dark:text-stone-300 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto"
            >
              {subtitleWords.map((word, i) => (
                <motion.span
                  key={`${i}-${word}`}
                  className="inline-block"
                  initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.35 + i * 0.028,
                    duration: 0.45,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{ marginRight: i < subtitleWords.length - 1 ? '0.28em' : 0 }}
                >
                  {word}
                </motion.span>
              ))}
            </motion.p>

            <motion.div variants={fadeUp} className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
              <motion.div
                whileHover={reduceMotion ? undefined : { scale: 1.04, y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Link
                  href="/login"
                  className="group relative inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-orange-500 via-rose-500 to-orange-600 dark:from-orange-500 dark:via-rose-500 dark:to-amber-600 text-white font-semibold tracking-wide shadow-lg shadow-orange-500/30 dark:shadow-orange-900/40 overflow-hidden"
                >
                  {!reduceMotion ? (
                    <motion.span
                      className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/25 to-white/0 skew-x-12"
                      initial={{ x: '-120%' }}
                      animate={{ x: '120%' }}
                      transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 1.2, ease: 'easeInOut' }}
                      aria-hidden
                    />
                  ) : null}
                  <Zap className="relative z-[1] w-4 h-4 opacity-90" aria-hidden />
                  <span className="relative z-[1]">Get started</span>
                  <ArrowRight
                    className="relative z-[1] w-4 h-4 transition-transform group-hover:translate-x-1.5"
                    aria-hidden
                  />
                </Link>
              </motion.div>

              <motion.div
                whileHover={reduceMotion ? undefined : { scale: 1.03, y: -1 }}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              >
                <Link
                  href="/sign-in"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl border-2 border-orange-300/80 dark:border-orange-500/45 bg-[var(--surface)]/80 dark:bg-stone-900/60 text-orange-900 dark:text-orange-100 font-semibold tracking-wide shadow-md shadow-stone-200/30 dark:shadow-stone-950/40 backdrop-blur-sm hover:border-orange-400 dark:hover:border-orange-400 hover:bg-orange-50/90 dark:hover:bg-orange-950/35 transition-colors duration-300"
                >
                  <LogIn className="w-4 h-4" aria-hidden />
                  Sign in
                </Link>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.6 }}
              className="pt-10 flex flex-col items-center gap-2"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-stone-500">
                Explore
              </span>
              <motion.a
                href="#how-it-works"
                className="flex flex-col items-center gap-1 text-orange-700 dark:text-orange-400 hover:text-orange-900 dark:hover:text-orange-300 transition-colors"
                animate={reduceMotion ? undefined : { y: [0, 6, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                aria-label="Scroll to how it works"
              >
                <ChevronDown className="w-6 h-6" strokeWidth={2.5} aria-hidden />
              </motion.a>
            </motion.div>
          </motion.div>

          {/* How it works */}
          <motion.section
            id="how-it-works"
            initial={{ opacity: 0, y: 56 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="mt-20 md:mt-28 w-full max-w-6xl relative z-[1] scroll-mt-28"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 140, damping: 18 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-200/90 dark:border-amber-600/40 bg-amber-50/90 dark:bg-amber-950/35 mb-5 text-xs font-bold tracking-widest text-amber-900 dark:text-amber-200 uppercase"
            >
              <Layers className="w-3.5 h-3.5" aria-hidden />
              How it works
            </motion.div>
            <h2 className="text-3xl md:text-4xl font-bold mb-3 text-stone-900 dark:text-stone-50 text-center">
              From request to{' '}
              <span className="text-orange-600 dark:text-orange-400">signed-off spend</span>
            </h2>
            <p className="text-stone-600 dark:text-stone-400 max-w-2xl mx-auto mb-12 text-center">
              Three beats your team feels every day—fast capture, clear approvals, protected budgets.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
              {steps.map((step, i) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, y: 36 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{
                    delay: i * 0.12,
                    duration: 0.55,
                    type: 'spring',
                    stiffness: 100,
                    damping: 20,
                  }}
                  whileHover={
                    reduceMotion
                      ? undefined
                      : { y: -8, transition: { type: 'spring', stiffness: 320, damping: 18 } }
                  }
                  className="relative text-center md:text-left"
                >
                  <div
                    className={`absolute -inset-px rounded-2xl bg-gradient-to-br ${step.accent} to-transparent opacity-60 blur-xl`}
                    aria-hidden
                  />
                  <div className="relative rounded-2xl border border-stone-200/90 dark:border-stone-600/70 bg-[var(--surface)]/95 dark:bg-stone-900/80 p-8 h-full shadow-lg shadow-stone-200/25 dark:shadow-stone-950/50">
                    <motion.div
                      className="mx-auto md:mx-0 mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/15 to-rose-500/10 dark:from-orange-500/25 dark:to-rose-600/15 border border-orange-200/60 dark:border-orange-500/30"
                      whileHover={reduceMotion ? undefined : { rotate: [0, -4, 4, 0], scale: 1.05 }}
                      transition={{ duration: 0.45 }}
                    >
                      <step.icon className="w-7 h-7 text-orange-600 dark:text-orange-400" strokeWidth={1.75} />
                    </motion.div>
                    <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                      <span className="text-xs font-bold text-orange-600/80 dark:text-orange-400/90 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="text-xl font-bold text-stone-900 dark:text-stone-50">{step.title}</h3>
                    </div>
                    <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">{step.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.section>

          {/* Features */}
          <motion.div
            id="features"
            initial={{ opacity: 0, y: 48 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-24 w-full max-w-6xl relative z-[1] scroll-mt-28"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1, duration: 0.5, type: 'spring', stiffness: 120 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-orange-200 dark:border-orange-500/40 bg-orange-50/95 dark:bg-orange-950/45 mb-6 text-xs font-bold tracking-widest text-orange-800 dark:text-orange-200 uppercase"
            >
              <BarChart2 className="w-3.5 h-3.5" aria-hidden />
              Platform features
            </motion.div>
            <h2 className="text-3xl md:text-4xl font-bold mb-3 text-stone-900 dark:text-stone-50">
              Everything you need for{' '}
              <span className="text-orange-600 dark:text-orange-400">smarter approvals</span>
            </h2>
            <p className="text-stone-600 dark:text-stone-400 max-w-xl mx-auto mb-12">
              Centralize your workflows securely from PO creation to finance sign-off.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {features.map((f, i) => (
                <motion.div
                  key={f.title}
                  initial={{ opacity: 0, y: 28, rotateX: reduceMotion ? 0 : -6 }}
                  whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
                  viewport={{ once: true, margin: '-30px' }}
                  transition={{
                    delay: i * 0.08,
                    duration: 0.5,
                    type: 'spring',
                    stiffness: 100,
                    damping: 18,
                  }}
                  whileHover={
                    reduceMotion
                      ? undefined
                      : {
                          y: -10,
                          rotateY: 2,
                          transition: { type: 'spring', stiffness: 300, damping: 18 },
                        }
                  }
                  style={{ perspective: 1200 }}
                  className="relative group"
                >
                  <motion.div
                    animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
                    transition={{
                      duration: 5 + i * 0.55,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: 1.2 + i * 0.18,
                    }}
                  >
                    <div
                      className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-br ${f.glow} to-transparent opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-500`}
                      aria-hidden
                    />
                    <motion.div
                      className="relative bg-[var(--surface)]/95 dark:bg-stone-900/85 border border-stone-200/90 dark:border-stone-600/70 p-8 rounded-2xl flex flex-col items-center justify-center text-center shadow-md shadow-stone-200/40 dark:shadow-stone-950/50 hover:border-orange-200/90 dark:hover:border-orange-500/35 hover:shadow-xl hover:shadow-orange-500/10 transition-colors duration-300"
                      whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                    >
                      <motion.h3
                        className={`text-3xl font-bold mb-2 ${f.tone}`}
                        initial={false}
                        whileHover={reduceMotion ? undefined : { scale: 1.05 }}
                      >
                        {f.title}
                      </motion.h3>
                      <p className="text-sm font-medium text-stone-600 dark:text-stone-400">{f.sub}</p>
                    </motion.div>
                  </motion.div>
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.35, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="mt-16 flex justify-center"
            >
              <motion.div whileHover={reduceMotion ? undefined : { scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-400 underline-offset-4 hover:underline"
                >
                  Open the workspace
                  <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
              </motion.div>
            </motion.div>
          </motion.div>
        </main>
      </motion.div>
    </div>
  );
}
