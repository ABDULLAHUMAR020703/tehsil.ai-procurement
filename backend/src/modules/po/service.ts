import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AppError } from '../../utils/errors';
import {
  buildPoHeaderMap,
  detectPoFileFormat,
  normalizeLineHeader,
  PO_OPTIONAL_DB_COLUMN,
  resolvePoField,
  resolvePoFieldFirst,
  type PoCanonicalField,
  type PoHeaderMap,
} from './lineItemMap';

export { detectPoFileFormat, normalizeLineHeader } from './lineItemMap';

export type ParsedPoRow = {
  po_number: string;
  vendor: string;
  total_value: number | null;
  is_cancelled: boolean;
  dash_fields: string[];
  source_row: Record<string, unknown>;
};

export type ParsedLineItemRow = {
  po_line_sn: string;
  po: string;
  item_code: string;
  description: string;
  unit_price: number | null;
  po_amount: number | null;
  is_cancelled: boolean;
  dash_fields: string[];
  source_row: Record<string, unknown>;
  extras: Record<string, unknown>;
};

export type PoParseResult =
  | { mode: 'line_items'; rows: ParsedLineItemRow[] }
  | { mode: 'legacy_vendor'; rows: ParsedPoRow[] };

const MONEY_DB_COLUMNS = new Set([
  'po_quantity',
  'po_invoiced',
  'po_acceptance_approved',
  'po_acceptance_pending',
  'acceptance_rejected_amount',
  'wnd',
  'pending_to_apply',
  'remaining_amount',
]);

const DATE_DB_COLUMNS = new Set(['issue_date', 'start_date', 'end_date']);
const INT_DB_COLUMNS = new Set(['month', 'year']);

const LEGACY_TOTAL_ALIASES = ['totalvalue', 'totalamount', 'grandtotal'] as const;

function normalizeMoneyString(value: string): string {
  return value
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '')
    .replace(/[\u20a8\u0024\u00a3\u20ac]/g, '')
    .replace(/\s+/g, '')
    .replace(/^\((.*)\)$/, '-$1');
}

function isDashPlaceholder(value: string): boolean {
  const normalized = value.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, '');
  return !normalized || /^[-\u2013\u2014]+$/.test(normalized);
}

function isExplicitCancelledValue(value: unknown): boolean {
  return typeof value === 'string' && /^po\s+cancell?ed$/i.test(value.trim());
}

function isSourceDash(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, '');
  return !!normalized && /^[-\u2013\u2014]+$/.test(normalized);
}

function parseMoney(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') throw new AppError('Numeric field must be a number or string', 400);
  const normalized = normalizeMoneyString(value);
  const num = Number(normalized);
  if (!Number.isFinite(num)) throw new AppError(`Invalid number: ${value}`, 400);
  return num;
}

function parseOptionalMoney(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string' && isDashPlaceholder(value)) return undefined;
  return parseMoney(value);
}

function parseNullableMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && isDashPlaceholder(value)) return null;
  return parseMoney(value);
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const n = Number(String(value).trim());
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

function parseOptionalDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 1 && value < 100000) {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + value * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return undefined;
}

function textValue(value: unknown): string {
  return String(value ?? '').trim();
}

/** When PO column is absent, derive from PO+LINE+SN (e.g. "4500123456-10-001"). */
export function derivePoFromLineSn(poLineSn: string): string {
  const trimmed = poLineSn.trim();
  if (!trimmed) return '';
  const segment = trimmed.split(/[-/|]/)[0]?.trim();
  return segment || trimmed;
}

function dbColumnsByCanonical(): Map<string, PoCanonicalField[]> {
  const grouped = new Map<string, PoCanonicalField[]>();
  for (const [canonical, col] of Object.entries(PO_OPTIONAL_DB_COLUMN)) {
    const list = grouped.get(col) ?? [];
    list.push(canonical as PoCanonicalField);
    grouped.set(col, list);
  }
  return grouped;
}

const OPTIONAL_BY_DB_COLUMN = dbColumnsByCanonical();

function parseOptionalExtras(obj: Record<string, unknown>, headerMap: PoHeaderMap): Record<string, unknown> {
  const extras: Record<string, unknown> = {};

  for (const [col, fields] of OPTIONAL_BY_DB_COLUMN) {
    const raw = resolvePoFieldFirst(obj, headerMap, ...fields);
    if (raw === null || raw === undefined || raw === '') continue;

    if (INT_DB_COLUMNS.has(col)) {
      const v = parseOptionalInt(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    if (DATE_DB_COLUMNS.has(col)) {
      const v = parseOptionalDate(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    if (MONEY_DB_COLUMNS.has(col)) {
      const v = parseOptionalMoney(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    extras[col] = String(raw).trim();
  }

  if (!extras.department) {
    const dept = resolvePoFieldFirst(obj, headerMap, 'departmentname', 'maindepartment');
    if (dept != null && String(dept).trim()) extras.department = String(dept).trim();
  }
  if (!extras.sub_department) {
    const sub = resolvePoFieldFirst(obj, headerMap, 'subdeptarment', 'subdepartment');
    if (sub != null && String(sub).trim()) extras.sub_department = String(sub).trim();
  }

  return extras;
}

function deriveItemCode(obj: Record<string, unknown>, headerMap: PoHeaderMap, poLineSn: string): string {
  const direct = textValue(resolvePoFieldFirst(obj, headerMap, 'itemcode'));
  if (direct && !isDashPlaceholder(direct)) return direct;
  const lineNo = textValue(resolvePoField(obj, headerMap, 'lineno'));
  if (lineNo && !isDashPlaceholder(lineNo)) return lineNo;
  const shipment = textValue(resolvePoField(obj, headerMap, 'shipmentnumber'));
  if (shipment && !isDashPlaceholder(shipment)) return shipment;
  return poLineSn;
}

function deriveDescription(obj: Record<string, unknown>, headerMap: PoHeaderMap, itemCode: string): string {
  const direct = textValue(resolvePoFieldFirst(obj, headerMap, 'description'));
  if (direct && !isDashPlaceholder(direct)) return direct;
  const shipment = textValue(resolvePoField(obj, headerMap, 'shipmentnumber'));
  const lineNo = textValue(resolvePoField(obj, headerMap, 'lineno'));
  const parts: string[] = [];
  if (shipment && !isDashPlaceholder(shipment)) parts.push(`Shipment ${shipment}`);
  if (lineNo && !isDashPlaceholder(lineNo)) parts.push(`Line ${lineNo}`);
  if (parts.length > 0) return parts.join(' / ');
  return itemCode || 'PO line';
}

function lineItemFromObject(obj: Record<string, unknown>, headerMap: PoHeaderMap): ParsedLineItemRow {
  const is_cancelled = Object.values(obj).some(isExplicitCancelledValue);
  const dash_fields = Object.entries(obj)
    .filter(([, value]) => isSourceDash(value))
    .map(([key]) => key);

  const po_line_sn = textValue(resolvePoField(obj, headerMap, 'polinesn'));
  const po =
    textValue(resolvePoFieldFirst(obj, headerMap, 'po')) || derivePoFromLineSn(po_line_sn);
  const item_code = deriveItemCode(obj, headerMap, po_line_sn);
  const description = deriveDescription(obj, headerMap, item_code);
  const unit_price = parseNullableMoney(resolvePoField(obj, headerMap, 'unitprice'));
  const po_amount = parseNullableMoney(resolvePoField(obj, headerMap, 'poamount'));

  if (!po_line_sn) throw new AppError('PO+LINE+SN cannot be empty', 400);
  if (!po) throw new AppError('PO cannot be empty', 400);
  if (!is_cancelled) {
    if (!item_code) throw new AppError('Item Code cannot be empty', 400);
    if (!description) throw new AppError('Description cannot be empty', 400);
    if (unit_price != null && unit_price < 0) throw new AppError('Unit Price cannot be negative', 400);
  }

  return {
    po_line_sn,
    po,
    item_code,
    description,
    unit_price,
    po_amount,
    is_cancelled,
    dash_fields,
    source_row: obj,
    extras: parseOptionalExtras(obj, headerMap),
  };
}

function resolveLegacyTotalValue(obj: Record<string, unknown>, headerMap: PoHeaderMap): number | null {
  for (const alias of LEGACY_TOTAL_ALIASES) {
    const orig = Object.keys(obj).find((k) => normalizeLineHeader(k) === alias);
    if (orig) return parseNullableMoney(obj[orig]);
  }
  if (!headerMap.has('polinesn') && headerMap.has('poamount')) {
    return parseNullableMoney(resolvePoField(obj, headerMap, 'poamount'));
  }
  return null;
}

function toRowFromObject(obj: Record<string, unknown>, headerMap: PoHeaderMap): ParsedPoRow {
  const is_cancelled = Object.values(obj).some(isExplicitCancelledValue);
  const dash_fields = Object.entries(obj)
    .filter(([, value]) => isSourceDash(value))
    .map(([key]) => key);

  const po_number = textValue(resolvePoFieldFirst(obj, headerMap, 'po'));
  const vendor = textValue(resolvePoFieldFirst(obj, headerMap, 'customer'));
  const total_value = resolveLegacyTotalValue(obj, headerMap);

  if (!po_number || !vendor || total_value === null) {
    throw new AppError('Missing required columns: po_number (or PO), vendor (or Customer), total_value', 400);
  }
  if (!is_cancelled && !vendor) throw new AppError('vendor cannot be empty', 400);

  return { po_number, vendor, total_value, is_cancelled, dash_fields, source_row: obj };
}

function loadRawRows(fileBuffer: Buffer, originalName: string): Record<string, unknown>[] {
  const lower = originalName.toLowerCase();

  if (lower.endsWith('.csv')) {
    const text = fileBuffer.toString('utf8');
    const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true, trimHeaders: true });
    if (parsed.errors?.length) {
      throw new AppError(`CSV parse error: ${parsed.errors[0]?.message ?? 'unknown error'}`, 400);
    }
    return (parsed.data ?? []).filter((r) => !!r && Object.keys(r as object).length > 0) as Record<string, unknown>[];
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, {
      defval: null,
      raw: false,
      blankrows: false,
    }) as Record<string, unknown>[];
    if (!jsonRows.length) throw new AppError('Excel file contains no rows', 400);
    return jsonRows;
  }

  throw new AppError('Unsupported file type. Use .csv, .xlsx, or .xls', 400);
}

export function parsePoUploadFile(params: { fileBuffer: Buffer; originalName: string; mimeType?: string }): PoParseResult {
  const rawRows = loadRawRows(params.fileBuffer, params.originalName);
  if (rawRows.length === 0) throw new AppError('No valid PO rows found', 400);

  const sample = rawRows[0]!;
  const headerMap = buildPoHeaderMap(sample);

  if (detectPoFileFormat(sample) === 'line_items') {
    const seen = new Set<string>();
    const rows: ParsedLineItemRow[] = [];
    for (const obj of rawRows) {
      const sn = textValue(resolvePoField(obj, headerMap, 'polinesn'));
      if (!sn) continue;
      if (seen.has(sn)) throw new AppError(`Duplicate PO+LINE+SN in file: ${sn}`, 400);
      seen.add(sn);
      rows.push(lineItemFromObject(obj, headerMap));
    }
    if (rows.length === 0) throw new AppError('No valid PO rows found (PO+LINE+SN column empty on all rows)', 400);
    return { mode: 'line_items', rows };
  }

  return { mode: 'legacy_vendor', rows: rawRows.map((obj) => toRowFromObject(obj, headerMap)) };
}

export function calcRemainingAmount(params: {
  po_amount: number | null;
  po_invoiced: number;
  po_acceptance_approved: number;
  pending_to_apply: number;
}): number {
  if (params.po_amount == null) return 0;
  const r =
    Number(params.po_amount) -
    Number(params.po_invoiced) -
    Number(params.po_acceptance_approved) -
    Number(params.pending_to_apply);
  return Math.max(0, Math.round(r * 10000) / 10000);
}

export function parsePoFile(params: { fileBuffer: Buffer; originalName: string; mimeType?: string }): ParsedPoRow[] {
  const r = parsePoUploadFile(params);
  if (r.mode !== 'legacy_vendor') {
    throw new AppError('This file uses line-item format (PO+LINE+SN). Use the line-item upload path.', 400);
  }
  return r.rows;
}
