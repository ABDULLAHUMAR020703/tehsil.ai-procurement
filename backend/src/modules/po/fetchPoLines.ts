import { supabaseAdmin } from '../../config/supabase';
import type { PurchaseOrderDbRow } from './groupByPo';
import { isMissingColumnError, missingColumnFromError } from '../../utils/supabaseError';

/** Columns for list/overview queries — omit `source_row` (optional; large JSON). */
export const PO_LINE_LIST_COLUMNS = [
  'id',
  'po_number',
  'vendor',
  'total_value',
  'remaining_value',
  'uploaded_by',
  'created_at',
  'updated_at',
  'updated_by',
  'po',
  'po_line_sn',
  'item_code',
  'description',
  'unit_price',
  'line_no',
  'department',
  'project_name',
  'po_amount',
  'remaining_amount',
  'issue_date',
  'customer',
  'status',
] as const;

const PO_LINE_LIST_LIMIT = 5000;

function isActivePoRow(row: { status?: string | null }): boolean {
  return row.status !== 'cancelled';
}

type PoLineScope = {
  or?: string;
};

function applyScope<T extends { or: (filter: string) => T }>(query: T, scope?: PoLineScope): T {
  if (scope?.or) return query.or(scope.or);
  return query;
}

/**
 * Load non-cancelled PO line rows with retries when prod DB lags migrations
 * (missing optional columns or `status` filter).
 */
export async function fetchActivePurchaseOrderLines(
  companyId: string,
  opts: { limit?: number; scope?: PoLineScope } = {},
): Promise<PurchaseOrderDbRow[]> {
  const limit = opts.limit ?? PO_LINE_LIST_LIMIT;
  let columns = [...PO_LINE_LIST_COLUMNS];
  let filterByStatus = true;

  for (let attempt = 0; attempt < 25; attempt++) {
    let query = supabaseAdmin
      .from('purchase_orders')
      .select(columns.join(', '))
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit);

    query = applyScope(query, opts.scope);
    if (filterByStatus) query = query.not('status', 'eq', 'cancelled');

    const { data, error } = await query;
    if (!error) {
      const rows = (data ?? []) as unknown as PurchaseOrderDbRow[];
      return filterByStatus ? rows : rows.filter(isActivePoRow);
    }

    if (!isMissingColumnError(error)) throw error;

    const missing = missingColumnFromError(error);
    if (missing && columns.includes(missing as (typeof PO_LINE_LIST_COLUMNS)[number])) {
      columns = columns.filter((col) => col !== missing);
      continue;
    }
    if (filterByStatus) {
      filterByStatus = false;
      continue;
    }

    throw error;
  }

  throw new Error('fetchActivePurchaseOrderLines: too many schema retries');
}

/** Count line rows shown in PO overview (excludes cancelled when `status` exists). */
export async function countActivePurchaseOrderLines(companyId: string): Promise<number> {
  let filterByStatus = true;

  for (let attempt = 0; attempt < 5; attempt++) {
    let query = supabaseAdmin
      .from('purchase_orders')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    if (filterByStatus) query = query.not('status', 'eq', 'cancelled');

    const { count, error } = await query;
    if (!error) return count ?? 0;

    if (isMissingColumnError(error) && filterByStatus) {
      filterByStatus = false;
      continue;
    }

    throw error;
  }

  return 0;
}
