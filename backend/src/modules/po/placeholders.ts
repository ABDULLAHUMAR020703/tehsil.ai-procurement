/** Normalize spreadsheet cell text for placeholder / cancellation checks. */
export function normalizeCellText(value: string): string {
  return value.trim().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Empty, null, blank, "-", em-dash, "N/A", "NA", etc. — valid PO data meaning "not provided".
 */
export function isMissingValuePlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' && !Number.isFinite(value)) return true;
  if (typeof value !== 'string') return false;
  const normalized = normalizeCellText(value);
  if (!normalized) return true;
  const compact = normalized.replace(/\s/g, '');
  if (/^[-\u2013\u2014]+$/.test(compact)) return true;
  if (/^(n\/a|na|nil|none|null|--)$/i.test(compact)) return true;
  return false;
}

/** Trim cell text; missing placeholders become empty string. */
export function cellText(value: unknown): string {
  if (isMissingValuePlaceholder(value)) return '';
  return String(value).trim();
}

/**
 * True when any cell explicitly indicates the PO line is cancelled.
 * Matches "PO Cancelled" / "PO Canceled" with common punctuation/spacing variants.
 */
export function isExplicitCancelledValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = normalizeCellText(value)
    .toLowerCase()
    .replace(/[.\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    normalized === 'po cancelled' ||
    normalized === 'po canceled' ||
    normalized === 'cancelled po' ||
    normalized === 'canceled po'
  );
}

export function rowIsExplicitlyCancelled(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some(isExplicitCancelledValue);
}

/** Row is entirely blank / placeholder cells — safe to skip (not a PO record). */
export function isBlankDataRow(obj: Record<string, unknown>): boolean {
  const values = Object.values(obj);
  if (values.length === 0) return true;
  return values.every((v) => isMissingValuePlaceholder(v));
}

/** Track columns whose source cell was an explicit missing marker (for "-" display). */
export function missingMarkerFields(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([, value]) => isMissingValuePlaceholder(value) && value !== null && value !== undefined)
    .map(([key]) => key);
}
