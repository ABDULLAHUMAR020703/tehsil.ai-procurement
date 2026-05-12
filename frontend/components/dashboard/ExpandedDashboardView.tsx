'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { authedFetchWithSupabase, NoSessionError } from '@/lib/api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DepartmentCard } from './DepartmentCard';
import type { DashboardDepartmentsResponse, DashboardDrillCard } from './dashboardTypes';

const TITLES: Record<DashboardDrillCard, string> = {
  projects: 'Projects overview',
  approvals: 'Pending approvals by department',
  exceptions: 'Pending exceptions by department',
  po: 'PO records by department',
};

function DrillSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-stone-200 dark:border-stone-600 bg-stone-100 dark:bg-stone-800/60 p-4 h-40 animate-pulse"
        >
          <div className="h-4 w-1/2 rounded bg-stone-200 dark:bg-stone-600 mb-3" />
          <div className="h-3 w-1/3 rounded bg-stone-200/80 dark:bg-stone-700 mb-4" />
          <div className="space-y-2">
            <div className="h-3 w-full rounded bg-stone-200/80 dark:bg-stone-700" />
            <div className="h-3 w-4/5 rounded bg-stone-200/80 dark:bg-stone-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Props = {
  active: DashboardDrillCard;
  onBack: () => void;
  supabase: SupabaseClient | null;
  onAuthError: () => void;
};

export function ExpandedDashboardView({ active, onBack, supabase, onAuthError }: Props) {
  const [filter, setFilter] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', 'departments', active],
    enabled: Boolean(supabase),
    queryFn: async () => {
      try {
        const q = `/api/dashboard/departments?section=${encodeURIComponent(active)}`;
        return await authedFetchWithSupabase<DashboardDepartmentsResponse>(supabase!, q);
      } catch (e) {
        if (e instanceof NoSessionError) onAuthError();
        throw e;
      }
    },
  });

  const filtered = useMemo(() => {
    const rows = data?.departments ?? [];
    const t = filter.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((d) => d.name.toLowerCase().includes(t) || d.code.toLowerCase().includes(t));
  }, [data?.departments, filter]);

  return (
    <motion.div
      key="expanded"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="space-y-4"
    >
      <Card className="p-4 border-orange-200/90 dark:border-orange-800/45 bg-gradient-to-r from-[var(--surface)] to-orange-50/50 dark:from-stone-900 dark:to-orange-950/20 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" className="shrink-0 gap-2" onClick={onBack}>
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-50">{TITLES[active]}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Department-level breakdown</p>
            </div>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter departments…"
            className="rounded-lg border border-stone-200 dark:border-stone-600 bg-[var(--surface)] dark:bg-stone-900 px-3 py-2 text-sm text-stone-900 dark:text-stone-100 outline-none focus:ring-2 focus:ring-orange-500/25 dark:focus:ring-orange-400/25 focus:border-orange-400 dark:focus:border-orange-500 w-full sm:max-w-xs shadow-sm"
          />
        </div>
      </Card>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div key="sk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <DrillSkeleton />
          </motion.div>
        ) : error ? (
          <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="p-4 text-sm text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/70 bg-rose-50 dark:bg-rose-950/35">
              {error instanceof Error ? error.message : 'Failed to load department data'}
            </Card>
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="p-6 text-center text-sm text-muted-foreground border-stone-200 dark:border-stone-600">
              No departments match your filter, or you have no access to department data.
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {filtered.map((bucket, i) => (
              <DepartmentCard key={bucket.code} bucket={bucket} section={active} index={i} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
