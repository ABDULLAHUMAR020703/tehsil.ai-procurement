'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authedFetchWithSupabase, formatPkr, NoSessionError } from '../lib/api';
import { Input } from './ui/Input';

export type PoSearchLine = {
  po_line_sn: string;
  item_code: string | null;
  description: string | null;
  unit_price: number;
  remaining_amount: number;
  effective_remaining: number;
  po: string | null;
  line_no: string | null;
};

export const PO_LINE_LOW_REMAINING_PKR = 100_000;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function formatPoLineOptionLabel(line: PoSearchLine) {
  const ic = line.item_code ?? '—';
  const desc = (line.description ?? '—').slice(0, 56);
  const po = line.po ?? '—';
  const ln = line.line_no?.trim() ? line.line_no : '—';
  return `${ic} | ${desc} | ${po} | Line ${ln} | Remaining: ${formatPkr(line.effective_remaining)}`;
}

type PoLineTypeaheadProps = {
  projectId: string;
  enabled: boolean;
  supabase: SupabaseClient | null;
  token: string;
  selectedLine: PoSearchLine | null;
  onSelectLine: (line: PoSearchLine | null) => void;
};

export function PoLineTypeahead({
  projectId,
  enabled,
  supabase,
  token,
  selectedLine,
  onSelectLine,
}: PoLineTypeaheadProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    setQuery('');
    setOpen(false);
  }, [projectId]);

  const { data, isFetching } = useQuery({
    queryKey: ['po', 'search', projectId, debouncedQuery],
    enabled: !!token && !!supabase && enabled && !!projectId,
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          project_id: projectId,
          q: debouncedQuery,
          limit: '20',
        });
        return await authedFetchWithSupabase<{ lines: PoSearchLine[] }>(supabase, `/api/po/search?${params.toString()}`);
      } catch (e) {
        if (e instanceof NoSessionError) router.replace('/login');
        throw e;
      }
    },
  });

  const lines = data?.lines ?? [];

  if (selectedLine) {
    const low = selectedLine.effective_remaining < PO_LINE_LOW_REMAINING_PKR;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className={low ? 'text-amber-800 font-medium' : 'text-foreground'}>{formatPoLineOptionLabel(selectedLine)}</span>
          <button
            type="button"
            className="ml-auto text-xs text-orange-700 dark:text-orange-400 underline font-medium hover:text-orange-900 dark:hover:text-orange-300"
            onClick={() => onSelectLine(null)}
          >
            Change
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Item code</span>
            <span className="text-foreground">{selectedLine.item_code ?? '—'}</span>
          </div>
          <div>
            <span className="block text-[10px] uppercase tracking-wide">Line description</span>
            <span className="text-foreground line-clamp-2">{selectedLine.description ?? '—'}</span>
          </div>
        </div>
        {low ? (
          <p className="text-xs text-amber-800">Low remaining on this PO line ({formatPkr(selectedLine.effective_remaining)} available).</p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative space-y-1">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search by item code, description, or PO…"
        autoComplete="off"
      />
      {isFetching ? <p className="text-xs text-muted-foreground">Searching…</p> : null}
      {open && enabled && (
        <ul className="absolute z-40 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {lines.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matching lines</li>
          ) : (
            lines.map((line) => {
              const low = line.effective_remaining < PO_LINE_LOW_REMAINING_PKR;
              return (
                <li key={line.po_line_sn}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-xs text-slate-900 hover:bg-slate-50 ${
                      low ? 'border-l-2 border-amber-500 bg-amber-50' : 'border-l-2 border-transparent'
                    }`}
                    onClick={() => {
                      onSelectLine(line);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    {formatPoLineOptionLabel(line)}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
