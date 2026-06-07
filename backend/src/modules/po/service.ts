import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { AppError } from '../../utils/errors';
import { OPTIONAL_HEADER_TO_COLUMN } from './lineItemMap';

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

function normalizeHeader(s: string) {
  return s.toLowerCase().replace(/[\s_-]+/g, '');
}

export function normalizeLineHeader(s: string) {
  return s.toLowerCase().trim().replace(/\+/g, '').replace(/[\s_-]+/g, '');
}

function buildHeaderNormMap(sample: Record<string, unknown>) {
  const m = new Map<string, string>();
  for (const k of Object.keys(sample)) {
    m.set(normalizeLineHeader(k), k);
  }
  return m;
}

export function detectPoFileFormat(sample: Record<string, unknown> | null | undefined): 'line_items' | 'legacy_vendor' {
  if (!sample || Object.keys(sample).length === 0) return 'legacy_vendor';
  const keys = new Set(Object.keys(sample).map(normalizeLineHeader));
  const required = ['po', 'itemcode', 'description', 'unitprice', 'poamount', 'polinesn'];
  if (required.every((k) => keys.has(k))) return 'line_items';
  return 'legacy_vendor';
}

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

function toRowFromObject(obj: Record<string, unknown>): ParsedPoRow {
  const keys = Object.keys(obj);
  const headerMap = new Map(keys.map((k) => [normalizeHeader(k), k] as const));
  const is_cancelled = Object.values(obj).some(isExplicitCancelledValue);
  const dash_fields = Object.entries(obj)
    .filter(([, value]) => isSourceDash(value))
    .map(([key]) => key);

  const poKey = headerMap.get('ponumber') ?? headerMap.get('po');
  const vendorKey = headerMap.get('vendor');
  const totalKey = headerMap.get('totalvalue') ?? headerMap.get('total_value') ?? headerMap.get('amount');

  if (!poKey || !vendorKey || !totalKey) {
    throw new AppError('Missing required columns: po_number, vendor, total_value', 400);
  }

  const po_number = String(obj[poKey] ?? '').trim();
  const vendor = String(obj[vendorKey] ?? '').trim();
  const total_value = parseNullableMoney(obj[totalKey]);

  if (!po_number) throw new AppError('po_number cannot be empty', 400);
  if (!is_cancelled) {
    if (!vendor) throw new AppError('vendor cannot be empty', 400);
  }

  return { po_number, vendor, total_value, is_cancelled, dash_fields, source_row: obj };
}

function getByCanon(obj: Record<string, unknown>, headerNormToOrig: Map<string, string>, canon: string): unknown {
  const orig = headerNormToOrig.get(canon);
  return orig != null ? obj[orig] : undefined;
}

function lineItemFromObject(
  obj: Record<string, unknown>,
  headerNormToOrig: Map<string, string>,
): ParsedLineItemRow {
  const is_cancelled = Object.values(obj).some(isExplicitCancelledValue);
  const dash_fields = Object.entries(obj)
    .filter(([, value]) => isSourceDash(value))
    .map(([key]) => key);
  const po_line_sn = String(getByCanon(obj, headerNormToOrig, 'polinesn') ?? '').trim();
  const po = String(getByCanon(obj, headerNormToOrig, 'po') ?? '').trim();
  const item_code = String(getByCanon(obj, headerNormToOrig, 'itemcode') ?? '').trim();
  const description = String(getByCanon(obj, headerNormToOrig, 'description') ?? '').trim();
  const unit_price = parseNullableMoney(getByCanon(obj, headerNormToOrig, 'unitprice'));
  const po_amount = parseNullableMoney(getByCanon(obj, headerNormToOrig, 'poamount'));

  if (!po_line_sn) throw new AppError('PO+LINE+SN cannot be empty', 400);
  if (!po) throw new AppError('PO cannot be empty', 400);
  if (!is_cancelled) {
    if (!item_code) throw new AppError('Item Code cannot be empty', 400);
    if (!description) throw new AppError('Description cannot be empty', 400);
    if (unit_price != null && unit_price < 0) throw new AppError('Unit Price cannot be negative', 400);
  }

  const extras: Record<string, unknown> = {};
  for (const [canon, col] of Object.entries(OPTIONAL_HEADER_TO_COLUMN)) {
    const orig = headerNormToOrig.get(canon);
    if (orig == null || !(orig in obj)) continue;
    const raw = obj[orig];
    if (raw === null || raw === undefined || raw === '') continue;

    if (col === 'month' || col === 'year') {
      const v = parseOptionalInt(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    if (col === 'issue_date' || col === 'start_date' || col === 'end_date') {
      const v = parseOptionalDate(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    if (
      col === 'po_quantity' ||
      col === 'po_invoiced' ||
      col === 'po_acceptance_approved' ||
      col === 'po_acceptance_pending' ||
      col === 'acceptance_rejected_amount' ||
      col === 'wnd' ||
      col === 'pending_to_apply'
    ) {
      const v = parseOptionalMoney(raw);
      if (v !== undefined) extras[col] = v;
      continue;
    }
    extras[col] = String(raw).trim();
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
    extras,
  };
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
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false }) as Record<string, unknown>[];
    if (!jsonRows.length) throw new AppError('Excel file contains no rows', 400);
    return jsonRows;
  }

  throw new AppError('Unsupported file type. Use .csv, .xlsx, or .xls', 400);
}

export function parsePoUploadFile(params: { fileBuffer: Buffer; originalName: string; mimeType?: string }): PoParseResult {
  const rawRows = loadRawRows(params.fileBuffer, params.originalName);
  if (rawRows.length === 0) throw new AppError('No valid PO rows found', 400);

  const sample = rawRows[0];
  if (detectPoFileFormat(sample) === 'line_items') {
    const headerNormToOrig = buildHeaderNormMap(sample);
    const seen = new Set<string>();
    const rows: ParsedLineItemRow[] = [];
    for (const obj of rawRows) {
      const sn = String(getByCanon(obj, headerNormToOrig, 'polinesn') ?? '').trim();
      if (sn) {
        if (seen.has(sn)) throw new AppError(`Duplicate PO+LINE+SN in file: ${sn}`, 400);
        seen.add(sn);
      }
      rows.push(lineItemFromObject(obj, headerNormToOrig));
    }
    return { mode: 'line_items', rows };
  }

  return { mode: 'legacy_vendor', rows: rawRows.map(toRowFromObject) };
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
