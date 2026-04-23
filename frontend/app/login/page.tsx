'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../../features/auth/AuthProvider';
import InteractiveBackground from '../../components/InteractiveBackground';
import { BrandLogo } from '../../components/BrandLogo';
import { ThemeToggle } from '../../components/ThemeToggle';
import Link from 'next/link';
import { User, Lock, Eye, EyeOff } from 'lucide-react';
import { APP_NAME } from '@/lib/appMeta';

const formItem = {
  hidden: { opacity: 0, x: -12 },
  show: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { delay: 0.35 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function LoginPage() {
  const { signIn, session, supabaseConfigError } = useAuth();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn({ email, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session) {
      router.replace('/dashboard');
    }
  }, [session, router]);

  return (
    <div className="min-h-screen flex flex-col text-stone-800 dark:text-stone-100 font-sans relative overflow-hidden">
      <InteractiveBackground />

      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-20 flex items-center justify-between px-6 md:px-10 py-5 border-b border-stone-200/80 dark:border-stone-700/80 bg-[var(--surface)]/75 dark:bg-stone-900/70 backdrop-blur-md"
      >
        <BrandLogo size="md">
          <span className="font-bold tracking-tight text-sm text-stone-900 dark:text-stone-50">{APP_NAME}</span>
        </BrandLogo>

        <div className="flex items-center gap-4">
          <ThemeToggle compact className="hidden sm:inline-flex" />
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold tracking-wide text-stone-500 dark:text-stone-400">
            <Link href="/" className="hover:text-orange-600 dark:hover:text-orange-400 transition-colors">
              Home
            </Link>
            <span className="text-stone-300 dark:text-stone-600">|</span>
            <Link href="/login" className="text-orange-600 dark:text-orange-400 font-medium">
              Sign in
            </Link>
          </nav>
        </div>
      </motion.header>

      <main className="flex-1 flex flex-col lg:flex-row items-stretch justify-center w-full max-w-6xl mx-auto px-6 py-12 lg:py-16 z-10 gap-12 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, x: reduceMotion ? 0 : -36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          className="w-full lg:w-[42%] flex flex-col justify-center order-2 lg:order-1"
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400 mb-3">
            Procurement workspace
          </p>
          <h1 className="text-4xl md:text-5xl font-bold text-stone-900 dark:text-stone-50 tracking-tight leading-tight mb-4">
            Welcome back
          </h1>
          <p className="text-stone-600 dark:text-stone-400 text-base leading-relaxed max-w-md">
            Sign in to manage approvals, purchase requests, and budgets in one secure place.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-stone-600 dark:text-stone-400">
            {['Role-based access and audit-friendly actions', 'PO lines, projects, and exceptions in sync'].map(
              (text, i) => (
                <motion.li
                  key={text}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.1, duration: 0.4 }}
                  className="flex items-center gap-2"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/80 text-orange-800 dark:text-orange-300 text-xs font-bold">
                    ✓
                  </span>
                  {text}
                </motion.li>
              ),
            )}
          </ul>
        </motion.div>

        <div className="w-full lg:w-[58%] flex justify-center order-1 lg:order-2">
          <motion.div
            initial={{ opacity: 0, y: 28, scale: reduceMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.12 }}
            className="w-full max-w-[420px]"
          >
            <motion.div
              className="rounded-2xl border border-stone-200/90 dark:border-stone-600/80 bg-[var(--surface)]/95 dark:bg-stone-900/80 p-8 md:p-10 shadow-xl shadow-orange-500/10 dark:shadow-stone-950/50 backdrop-blur-sm relative overflow-hidden"
              whileHover={reduceMotion ? undefined : { boxShadow: '0 25px 50px -12px rgba(234, 88, 12, 0.18)' }}
              transition={{ duration: 0.35 }}
            >
              {!reduceMotion ? (
                <motion.div
                  className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-orange-400/15 dark:bg-orange-500/10 blur-3xl"
                  animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
                  aria-hidden
                />
              ) : null}
              <div className="relative z-[1] flex flex-col items-center mb-8">
                <motion.div
                  whileHover={reduceMotion ? undefined : { scale: 1.04 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <BrandLogo padded className="justify-center" />
                </motion.div>
                <h2 className="mt-4 text-lg font-semibold text-stone-900 dark:text-stone-50">Sign in to {APP_NAME}</h2>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">Use your work email and password</p>
              </div>

              <form onSubmit={onSubmit} className="w-full space-y-4 relative z-[1]">
                {supabaseConfigError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="text-xs text-amber-900 dark:text-amber-100 text-left leading-relaxed rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-3"
                  >
                    {supabaseConfigError}
                  </motion.div>
                )}
                <motion.div custom={0} variants={formItem} initial="hidden" animate="show" className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                    <User size={18} strokeWidth={2} />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl border border-stone-200 dark:border-stone-600 bg-stone-50/80 dark:bg-stone-950/50 py-3 pl-11 pr-4 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 dark:focus:ring-orange-400/25 transition-shadow"
                  />
                </motion.div>

                <motion.div custom={1} variants={formItem} initial="hidden" animate="show" className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stone-400">
                    <Lock size={18} strokeWidth={2} />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    required
                    autoComplete="current-password"
                    className="w-full rounded-xl border border-stone-200 dark:border-stone-600 bg-stone-50/80 dark:bg-stone-950/50 py-3 pl-11 pr-12 text-sm text-stone-900 dark:text-stone-100 placeholder-stone-400 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20 dark:focus:ring-orange-400/25 transition-shadow"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-12 text-stone-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </motion.div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm text-rose-600 dark:text-rose-400 text-center font-medium"
                  >
                    {error}
                  </motion.div>
                )}

                <motion.div custom={2} variants={formItem} initial="hidden" animate="show">
                  <motion.button
                    type="submit"
                    disabled={loading}
                    whileHover={reduceMotion || loading ? undefined : { scale: 1.02 }}
                    whileTap={reduceMotion || loading ? undefined : { scale: 0.98 }}
                    className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 hover:brightness-105 dark:from-orange-600 dark:to-rose-600 text-white font-semibold text-sm py-3.5 mt-2 transition-all shadow-md shadow-orange-500/25 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Signing in…' : 'Sign in'}
                  </motion.button>
                </motion.div>

                <motion.div
                  custom={3}
                  variants={formItem}
                  initial="hidden"
                  animate="show"
                  className="flex items-center justify-between pt-1 text-xs text-stone-500 dark:text-stone-400"
                >
                  <label className="flex items-center gap-2 cursor-pointer hover:text-stone-700 dark:hover:text-stone-200">
                    <input
                      type="checkbox"
                      className="rounded border-stone-300 dark:border-stone-600 text-orange-600 focus:ring-orange-500/30"
                    />
                    Remember me
                  </label>
                  <span className="text-stone-400 dark:text-stone-500">Need help? Contact your admin</span>
                </motion.div>
              </form>
            </motion.div>
          </motion.div>
        </div>
      </main>

      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className="relative z-10 px-6 md:px-10 py-5 border-t border-stone-200/80 dark:border-stone-700/80 bg-[var(--surface)]/65 dark:bg-stone-900/60 backdrop-blur-sm flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-stone-500 dark:text-stone-400"
      >
        <BrandLogo size="sm">
          <span>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
        </BrandLogo>
        <span>Secure procurement · {APP_NAME}</span>
      </motion.footer>
    </div>
  );
}
