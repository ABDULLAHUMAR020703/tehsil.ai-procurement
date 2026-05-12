'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Card } from '../ui/Card';
import { formatPkr } from '@/lib/api';
import type { DashboardDepartmentBucket, DashboardDrillCard } from './dashboardTypes';

type Props = {
  bucket: DashboardDepartmentBucket;
  section: DashboardDrillCard;
  index: number;
};

function exceptionTone(severity: string) {
  if (severity === 'high') {
    return 'border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200';
  }
  return 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200';
}

export function DepartmentCard({ bucket, section, index }: Props) {
  const hasProjects = section === 'projects' && bucket.projects.length > 0;
  const hasApprovals = section === 'approvals' && bucket.pendingApprovals.length > 0;
  const hasExceptions = section === 'exceptions' && bucket.exceptions.length > 0;
  const hasPo = section === 'po' && bucket.poRecords.length > 0;
  const empty = !hasProjects && !hasApprovals && !hasExceptions && !hasPo;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="p-4 border-stone-200/90 dark:border-stone-600/75 h-full flex flex-col shadow-sm">
        <div className="border-b border-stone-100 dark:border-stone-700 pb-2 mb-3">
          <h3 className="text-base font-semibold text-stone-900 dark:text-stone-50">{bucket.name}</h3>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{bucket.code}</p>
        </div>

        {section === 'projects' && bucket.projects.length > 0 ? (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="text-stone-900 dark:text-stone-100 font-semibold tabular-nums">{bucket.projects.length}</span>{' '}
            project
            {bucket.projects.length === 1 ? '' : 's'}
          </p>
        ) : null}
        {section === 'approvals' && bucket.pendingApprovals.length > 0 ? (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="text-stone-900 dark:text-stone-100 font-semibold tabular-nums">
              {bucket.pendingApprovals.length}
            </span>{' '}
            pending
          </p>
        ) : null}
        {section === 'exceptions' && bucket.exceptions.length > 0 ? (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="text-stone-900 dark:text-stone-100 font-semibold tabular-nums">{bucket.exceptions.length}</span>{' '}
            exception
            {bucket.exceptions.length === 1 ? '' : 's'}
          </p>
        ) : null}
        {section === 'po' && bucket.poRecords.length > 0 ? (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="text-stone-900 dark:text-stone-100 font-semibold tabular-nums">{bucket.poRecords.length}</span>{' '}
            purchase order
            {bucket.poRecords.length === 1 ? '' : 's'}
          </p>
        ) : null}

        {empty ? <p className="text-sm text-muted-foreground flex-1">No data available for this section.</p> : null}

        {hasProjects ? (
          <ul className="space-y-2 text-sm flex-1 max-h-56 overflow-y-auto pr-1">
            {bucket.projects.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border border-stone-100 dark:border-stone-600 bg-stone-50/90 dark:bg-stone-800/50 px-2 py-1.5"
              >
                <Link
                  href={`/projects/${p.id}`}
                  className="text-orange-700 dark:text-orange-400 font-medium hover:underline hover:text-orange-900 dark:hover:text-orange-300"
                >
                  {p.name}
                </Link>
                <span className="text-muted-foreground text-xs ml-2 capitalize">{p.status}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {hasApprovals ? (
          <ul className="space-y-2 text-sm flex-1 max-h-56 overflow-y-auto pr-1">
            {bucket.pendingApprovals.map((a) => (
              <li
                key={a.id}
                className="rounded-lg border border-stone-100 dark:border-stone-600 bg-stone-50/90 dark:bg-stone-800/50 px-2 py-1.5"
              >
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
                  <Link
                    href={`/purchase-requests/${a.request_id}`}
                    className="text-orange-700 dark:text-orange-400 text-xs font-mono hover:underline hover:text-orange-900 dark:hover:text-orange-300"
                  >
                    {a.request_id.slice(0, 8)}…
                  </Link>
                  <span className="text-[10px] uppercase text-orange-800 dark:text-orange-400 font-semibold">
                    {a.role}
                  </span>
                </div>
                {a.pr_description ? (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.pr_description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {hasExceptions ? (
          <ul className="space-y-2 text-sm flex-1 max-h-56 overflow-y-auto pr-1">
            {bucket.exceptions.map((ex) => (
              <li key={ex.id} className={`rounded-lg border px-2 py-1.5 text-xs ${exceptionTone(ex.severity)}`}>
                <div className="font-medium uppercase tracking-wide">{ex.type.replace('_', ' ')}</div>
                <div className="opacity-90 mt-0.5">Ref: {ex.reference_id.slice(0, 8)}…</div>
              </li>
            ))}
          </ul>
        ) : null}

        {hasPo ? (
          <ul className="space-y-2 text-sm flex-1 max-h-56 overflow-y-auto pr-1">
            {bucket.poRecords.map((po) => (
              <li
                key={po.id}
                className="rounded-lg border border-stone-100 dark:border-stone-600 bg-stone-50/90 dark:bg-stone-800/50 px-2 py-2 space-y-1"
              >
                <div className="font-medium text-stone-900 dark:text-stone-100">{po.label}</div>
                {po.vendor ? <div className="text-xs text-muted-foreground">{po.vendor}</div> : null}
                <div className="grid grid-cols-2 gap-1 text-[11px] tabular-nums">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-right">{formatPkr(po.total_value)}</span>
                  <span className="text-muted-foreground">Remaining</span>
                  <span className="text-right text-orange-900 dark:text-orange-300 font-medium tabular-nums">
                    {formatPkr(po.remaining_value)}
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">Projects linked: {po.line_count}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </motion.div>
  );
}
