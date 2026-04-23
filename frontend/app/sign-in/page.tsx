'use client';

import { useState } from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { ThemeToggle } from '../../components/ThemeToggle';
import { useAuth } from '../../features/auth/AuthProvider';
import { BrandLogo } from '../../components/BrandLogo';
import InteractiveBackground from '../../components/InteractiveBackground';
import Link from 'next/link';

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
  },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function SignInPage() {
  const { signIn, signOut, session, profile, supabaseConfigError } = useAuth();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-8 relative overflow-hidden">
      <InteractiveBackground />
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="absolute top-6 right-6 z-20 flex items-center gap-3"
      >
        <Link
          href="/"
          className="text-xs font-semibold text-stone-500 dark:text-stone-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
        >
          Home
        </Link>
        <ThemeToggle compact />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.94, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.05 }}
        className="relative z-10 w-full max-w-md"
      >
        {!reduceMotion ? (
          <motion.div
            className="pointer-events-none absolute -inset-4 rounded-3xl bg-gradient-to-r from-orange-500/20 via-rose-500/15 to-amber-500/20 blur-2xl opacity-70"
            animate={{ opacity: [0.45, 0.7, 0.45] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
        ) : null}
        <Card className="relative p-8 shadow-xl shadow-orange-500/15 dark:shadow-stone-950/50 border-stone-200/90 dark:border-stone-600/80 overflow-hidden">
          <motion.div variants={stagger} initial="hidden" animate="show">
            <motion.div variants={item} className="flex justify-center mb-6">
              <motion.div whileHover={reduceMotion ? undefined : { scale: 1.05 }} transition={{ type: 'spring', stiffness: 400 }}>
                <BrandLogo size="lg" className="justify-center" />
              </motion.div>
            </motion.div>
            <motion.h1
              variants={item}
              className="text-2xl font-semibold text-center text-stone-900 dark:text-stone-50 tracking-tight"
            >
              Sign in
            </motion.h1>
            <motion.p variants={item} className="text-sm text-muted-foreground mt-1 text-center">
              Use your Supabase email and password.
            </motion.p>

            {session && profile ? (
              <motion.div
                variants={item}
                className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-900 dark:text-emerald-200"
              >
                Signed in as <span className="font-medium">{profile.name ?? profile.email ?? 'User'}</span> (
                {profile.role})
              </motion.div>
            ) : null}

            <motion.form variants={item} onSubmit={onSubmit} className="mt-6 space-y-3">
              {supabaseConfigError ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
                  {supabaseConfigError}
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Email</label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              {error ? (
                <motion.div
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-sm text-rose-600 dark:text-rose-400 font-medium"
                >
                  {error}
                </motion.div>
              ) : null}

              <motion.div whileHover={reduceMotion || loading ? undefined : { scale: 1.01 }} whileTap={reduceMotion ? undefined : { scale: 0.99 }}>
                <Button className="w-full" disabled={loading} type="submit">
                  {loading ? 'Signing in...' : 'Sign in'}
                </Button>
              </motion.div>

              {session ? (
                <Button className="w-full" variant="secondary" type="button" onClick={() => signOut()}>
                  Sign out
                </Button>
              ) : null}
            </motion.form>
          </motion.div>
        </Card>
      </motion.div>
    </div>
  );
}
