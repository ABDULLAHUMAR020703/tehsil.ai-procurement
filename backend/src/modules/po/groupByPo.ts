/** Rows returned from GET /api/po before grouping. */
export type PurchaseOrderDbRow = {
  id: string;
  company_id?: string;
  po_number: string | null;
  vendor: string | null;
  total_value: number | string | null;
  remaining_value: number | string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at?: string | null;
  po: string | null;
  po_line_sn: string | null;
  item_code: string | null;
  description: string | null;
  unit_price: number | string | null;
  line_no: string | null;
  department: string | null;
  po_amount: number | string | null;
  remaining_amount: number | string | null;
  source_row?: Record<string, unknown> | null;
  issue_date: string | null;
  customer: string | null;
  project_name: string | null;
};

export type PurchaseOrderGroupItem = {
  id: string;
  item_code: string | null;
  description: string | null;
  line_no: string | null;
  po_line_sn: string | null;
  unit_price: number | null;
  po_amount: number;
  remaining_amount: number;
  unit_price_display: number | '-';
  po_amount_display: number | '-';
  remaining_amount_display: number | '-';
  department: string | null;
  uploaded_by: string | null;
  created_at: string;
};

export type PurchaseOrderGroup = {
  /** Business PO number / identifier; unique key for the group in CSV line-item mode. */
  po: string;
  issue_date: string | null;
  customer: string | null;
  vendor: string | null;
  /** Sum of line po_amount (or legacy total_value). */
  total_amount: number;
  /** Sum of line remaining_amount (or legacy remaining_value). */
  remaining_amount: number;
  total_amount_display: number | '-';
  remaining_amount_display: number | '-';
  /** Same as total_amount; mirrors legacy header PO fields for clients. */
  total_value: number;
  /** Same as remaining_amount. */
  remaining_value: number;
  /** One row id to store on projects.po_id when linking the PO. */
  anchor_po_line_id: string;
  /** Latest line update in the group. */
  created_at: string;
  /** Max(line.updated_at, line.created_at) for the group. */
  updated_at: string;
  /** From CSV "Project Name" column on line rows (first non-empty in group). */
  project_name: string | null;
  /** From CSV "Department" / "Department name" on line rows (first non-empty in group). */
  department: string | null;
  items: PurchaseOrderGroupItem[];
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSourceHeader(s: string) {
  return s.toLowerCase().trim().replace(/\+/g, '').replace(/[\s_-]+/g, '');
}

function sourceValue(row: PurchaseOrderDbRow, canon: string): unknown {
  const source = row.source_row;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const match = Object.keys(source).find((key) => normalizeSourceHeader(key) === canon);
  return match ? source[match] : undefined;
}

function sourceWasDash(row: PurchaseOrderDbRow, canon: string): boolean {
  const raw = sourceValue(row, canon);
  return typeof raw === 'string' && /^[-\u2013\u2014]+$/.test(raw.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ''));
}

export function budgetPairFromRow(row: PurchaseOrderDbRow): { amount: number; remaining: number } {
  const pa = num(row.po_amount, NaN);
  const ra = num(row.remaining_amount, NaN);
  const tv = num(row.total_value, 0);
  const rv = num(row.remaining_value, 0);
  const amount = pa > 0 ? pa : tv;
  const remaining = Number.isFinite(ra) ? ra : rv;
  return { amount, remaining };
}

/** Group key: canonical PO text, else po_number, else row id (one group per legacy row). */
export function purchaseOrderGroupKey(row: PurchaseOrderDbRow): string {
  const p = String(row.po ?? '').trim();
  if (p) return p;
  const pn = String(row.po_number ?? '').trim();
  if (pn) return pn;
  return row.id;
}

function displayPoLabel(rows: PurchaseOrderDbRow[]): string {
  const r = rows[0];
  const p = String(r.po ?? '').trim();
  if (p) return p;
  const pn = String(r.po_number ?? '').trim();
  if (pn) return pn;
  return `Legacy row - ${r.id.slice(0, 8)}`;
}

function toItem(row: PurchaseOrderDbRow): PurchaseOrderGroupItem {
  const up = num(row.unit_price, NaN);
  const { amount, remaining } = budgetPairFromRow(row);
  return {
    id: row.id,
    item_code: row.item_code,
    description: row.description,
    line_no: row.line_no,
    po_line_sn: row.po_line_sn,
    unit_price: Number.isFinite(up) ? up : null,
    po_amount: amount,
    remaining_amount: remaining,
    unit_price_display: sourceWasDash(row, 'unitprice') ? '-' : Number.isFinite(up) ? up : 0,
    po_amount_display: sourceWasDash(row, 'poamount') ? '-' : amount,
    remaining_amount_display: sourceWasDash(row, 'remainingamount') ? '-' : remaining,
    department: row.department,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
  };
}

export function groupPurchaseOrdersByPo(rows: PurchaseOrderDbRow[]): PurchaseOrderGroup[] {
  const map = new Map<string, PurchaseOrderDbRow[]>();
  for (const row of rows) {
    const key = purchaseOrderGroupKey(row);
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }

  const groups: PurchaseOrderGroup[] = [];
  for (const [, groupRows] of map) {
    const sorted = [...groupRows].sort((a, b) => {
      const ca = new Date(a.created_at).getTime();
      const cb = new Date(b.created_at).getTime();
      if (ca !== cb) return ca - cb;
      return a.id.localeCompare(b.id);
    });

    let totalAmount = 0;
    let totalRemaining = 0;
    let amountDashCount = 0;
    let remainingDashCount = 0;
    for (const r of sorted) {
      const { amount, remaining } = budgetPairFromRow(r);
      totalAmount += amount;
      totalRemaining += remaining;
      if (sourceWasDash(r, 'poamount')) amountDashCount += 1;
      if (sourceWasDash(r, 'remainingamount')) remainingDashCount += 1;
    }

    const issueDates = sorted.map((r) => r.issue_date).filter((d): d is string => !!d && String(d).trim().length > 0);
    issueDates.sort();
    const customer =
      sorted.map((r) => r.customer).find((c) => c != null && String(c).trim().length > 0) ?? null;
    const vendor =
      sorted.map((r) => r.vendor).find((v) => v != null && String(v).trim().length > 0) ?? null;
    const project_name =
      sorted.map((r) => r.project_name).find((n) => n != null && String(n).trim().length > 0) ?? null;
    const department =
      sorted.map((r) => r.department).find((x) => x != null && String(x).trim().length > 0) ?? null;

    const createdAt = sorted.reduce((max, r) => (r.created_at > max ? r.created_at : max), sorted[0].created_at);
    const updatedAt = sorted.reduce((max, r) => {
      const u = String(r.updated_at ?? r.created_at);
      return u > max ? u : max;
    }, String(sorted[0].updated_at ?? sorted[0].created_at));

    groups.push({
      po: displayPoLabel(sorted),
      issue_date: issueDates[0] ?? null,
      customer: customer != null ? String(customer).trim() : null,
      vendor,
      total_amount: totalAmount,
      remaining_amount: totalRemaining,
      total_amount_display: amountDashCount === sorted.length ? '-' : totalAmount,
      remaining_amount_display: remainingDashCount === sorted.length ? '-' : totalRemaining,
      total_value: totalAmount,
      remaining_value: totalRemaining,
      anchor_po_line_id: sorted[0].id,
      created_at: createdAt,
      updated_at: updatedAt,
      project_name: project_name != null ? String(project_name).trim() : null,
      department: department != null ? String(department).trim() : null,
      items: sorted.map(toItem),
    });
  }

  groups.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return groups;
}
