'use client';

import { formatPkr } from '../lib/api';
import { TD } from './ui/Table';

export type PoLineSummary = {
  item_code: string | null;
  pr_description: string;
  line_description: string | null;
  unit_price: number | null;
  requested_quantity: number | null;
  requested_amount: number;
  remaining_amount: number;
  remaining_after_approval: number;
  exceeds_po_limit: boolean;
  po_line_sn: string | null;
  remaining_tooltip: string;
};

function qtyLabel(q: number | null) {
  if (q == null || !Number.isFinite(q)) return '—';
  return String(q);
}

export function PrPoLineMetricsCells({ summary }: { summary: PoLineSummary | null | undefined }) {
  if (!summary) {
    return (
      <>
        <TD className="text-muted-foreground text-xs">—</TD>
        <TD className="text-muted-foreground text-xs max-w-[140px] truncate">—</TD>
        <TD className="text-muted-foreground text-xs">—</TD>
        <TD className="text-muted-foreground text-xs">—</TD>
        <TD className="text-muted-foreground text-xs">—</TD>
        <TD className="text-muted-foreground text-xs">—</TD>
        <TD className="text-muted-foreground text-xs">—</TD>
      </>
    );
  }

  const desc = summary.line_description ?? summary.pr_description;
  const tone = summary.exceeds_po_limit
    ? 'text-rose-900 dark:text-rose-100'
    : 'text-stone-800 dark:text-orange-100';
  const border = summary.exceeds_po_limit
    ? 'border-l-[3px] border-rose-500'
    : 'border-l-[3px] border-orange-500 dark:border-orange-400';
  const rowTint = summary.exceeds_po_limit
    ? 'bg-rose-50/85 dark:bg-rose-950/30'
    : 'bg-orange-50/70 dark:bg-orange-950/25';

  return (
    <>
      <TD className={`text-xs ${tone} ${border} pl-2 ${rowTint}`}>{summary.item_code ?? '—'}</TD>
      <TD className={`text-xs max-w-[160px] truncate ${tone} ${rowTint}`}>
        <span title={desc}>{desc}</span>
      </TD>
      <TD className={`text-xs tabular-nums ${tone} ${rowTint}`}>
        {summary.unit_price != null ? formatPkr(summary.unit_price) : '—'}
      </TD>
      <TD className={`text-xs ${tone} ${rowTint}`}>{qtyLabel(summary.requested_quantity)}</TD>
      <TD className={`text-xs tabular-nums ${tone} ${rowTint}`}>{formatPkr(summary.requested_amount)}</TD>
      <TD className={`text-xs tabular-nums ${tone} ${rowTint}`}>
        <span title={summary.remaining_tooltip}>{formatPkr(summary.remaining_amount)}</span>
      </TD>
      <TD className={`text-xs font-medium tabular-nums ${tone} ${rowTint}`}>
        <span className="inline-flex flex-col gap-0.5">
          <span>{formatPkr(summary.remaining_after_approval)}</span>
          {summary.exceeds_po_limit ? (
            <span className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-300">
              Exceeds PO limit
            </span>
          ) : null}
        </span>
      </TD>
    </>
  );
}
