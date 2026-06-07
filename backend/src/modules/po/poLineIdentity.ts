/** Normalize one segment of PO Number | Line Number | SN identity keys. */
export function normalizeKeyPart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Canonical DB identity: PO Number + Line Number + SN (date excluded).
 * Stored in `purchase_orders.po_line_sn` for uniqueness per company.
 */
export function buildPoLineKey(
  poNumber: string,
  lineNumber: string,
  sn: string,
  fallbackRowIndex?: number,
): string {
  const po = normalizeKeyPart(poNumber);
  const line = normalizeKeyPart(lineNumber);
  const serial = normalizeKeyPart(sn);
  if (po || line || serial) {
    return `${po}|${line}|${serial}`;
  }
  if (fallbackRowIndex != null) {
    return `IMPORT-ROW|${fallbackRowIndex}|`;
  }
  return 'IMPORT-ROW|0|';
}

/** Parse composite PO+LINE+SN spreadsheet cells into identity parts. */
export function parsePoLineSnComposite(raw: string): { po: string; line: string; sn: string } {
  const trimmed = normalizeKeyPart(raw);
  if (!trimmed) return { po: '', line: '', sn: '' };

  if (trimmed.includes('|')) {
    const parts = trimmed.split('|').map((p) => normalizeKeyPart(p));
    return {
      po: parts[0] ?? '',
      line: parts[1] ?? '',
      sn: parts.slice(2).join('-') || (parts[2] ?? ''),
    };
  }

  const parts = trimmed.split(/[-/\\|]+/).map((p) => normalizeKeyPart(p)).filter(Boolean);
  return {
    po: parts[0] ?? '',
    line: parts[1] ?? '',
    sn: parts.slice(2).join('-') || '',
  };
}

export function resolvePoLineIdentity(params: {
  poLineSnRaw: string;
  poFromColumn: string;
  lineNoFromColumn: string;
  snFromColumn: string;
  rowIndex: number;
}): {
  po_number: string;
  line_no: string;
  sn: string;
  po_line_key: string;
} {
  const parsed = params.poLineSnRaw ? parsePoLineSnComposite(params.poLineSnRaw) : { po: '', line: '', sn: '' };

  const po_number =
    normalizeKeyPart(params.poFromColumn) ||
    parsed.po ||
    (params.poLineSnRaw ? derivePoFromComposite(params.poLineSnRaw) : '');

  const line_no = normalizeKeyPart(params.lineNoFromColumn) || parsed.line;
  const sn = normalizeKeyPart(params.snFromColumn) || parsed.sn;

  const po_line_key = buildPoLineKey(po_number, line_no, sn, params.rowIndex);

  return { po_number, line_no, sn, po_line_key };
}

function derivePoFromComposite(raw: string): string {
  return parsePoLineSnComposite(raw).po;
}

/** Alternate `po_line_sn` values that may exist from older uploads. */
export function expandPoLineLookupKeys(canonicalKey: string): string[] {
  const keys = new Set<string>([canonicalKey]);
  const parts = canonicalKey.split('|');
  if (parts.length >= 3) {
    const [po, line, sn] = parts;
    const dashed = [po, line, sn].filter((p) => p && p.length > 0).join('-');
    if (dashed) keys.add(dashed);
  }
  const parsed = parsePoLineSnComposite(canonicalKey);
  if (parsed.po || parsed.line || parsed.sn) {
    keys.add(buildPoLineKey(parsed.po, parsed.line, parsed.sn));
    const dashed = [parsed.po, parsed.line, parsed.sn].filter(Boolean).join('-');
    if (dashed) keys.add(dashed);
  }
  return [...keys];
}

export function rowMatchesPoLineKey(
  row: { po_line_sn?: unknown; po?: unknown; line_no?: unknown; sn?: unknown },
  canonicalKey: string,
): boolean {
  const stored = String(row.po_line_sn ?? '').trim();
  if (stored) {
    if (expandPoLineLookupKeys(canonicalKey).includes(stored)) return true;
    const parsed = parsePoLineSnComposite(stored);
    const keyFromStored = buildPoLineKey(parsed.po, parsed.line, parsed.sn);
    if (keyFromStored === canonicalKey) return true;
  }
  const built = buildPoLineKey(
    String(row.po ?? ''),
    String(row.line_no ?? ''),
    String(row.sn ?? ''),
  );
  return built === canonicalKey;
}

/** Derive PO group number from identity (first segment of key). */
export function poNumberFromLineKey(poLineKey: string): string {
  const segment = poLineKey.split('|')[0]?.trim();
  return segment || poLineKey;
}
