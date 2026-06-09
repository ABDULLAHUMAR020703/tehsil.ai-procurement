/**
 * PO upload header registry — maps many spreadsheet column labels to canonical fields.
 * Supports the original line-item template and Hadir-style exports in one parser.
 */

/** Normalize a spreadsheet header for alias lookup. */
export function normalizeLineHeader(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\+/g, '')
    .replace(/[/\\().:'"]+/g, '')
    .replace(/[\s_\-.]+/g, '');
}

/**
 * Canonical field → normalized header aliases (first match in the file wins).
 * Add new export layouts here instead of branching in the parser.
 */
export const PO_FIELD_ALIASES = {
  /** Required for line-item uploads */
  polinesn: ['polinesn', 'polinesno', 'polineid', 'polineidentifier'],
  unitprice: ['unitprice', 'unitrate', 'priceperunit', 'rate', 'price'],
  poamount: ['poamount', 'lineamount', 'linevalue', 'amount'],

  /** Original template — optional when polinesn present (derived if missing) */
  po: ['po', 'ponumber', 'pono', 'purchaseorder', 'purchaseorderno', 'purchaseordernumber'],
  itemcode: ['itemcode', 'item', 'materialcode', 'material', 'sku', 'partnumber', 'partno'],
  description: ['description', 'itemdescription', 'materialdescription', 'desc', 'itemdesc'],

  /** Shared optional fields */
  issuedate: ['issuedate', 'podate', 'orderdate'],
  month: ['month'],
  year: ['year'],
  customer: ['customer', 'vendor', 'client', 'supplier', 'vendorname'],
  projectname: ['projectname', 'project'],
  subcontractno: ['subcontractno', 'subcontractnumber'],
  projectcode: ['projectcode'],
  milestone: ['milestone'],
  sitecode: ['sitecode'],
  sitename: ['sitename'],
  siteid: ['siteid'],
  qcstatus: ['qcstatus'],
  approverlevel: ['approverlevel'],
  shipmentnumber: ['shipmentnumber', 'shipmentno', 'shipment'],
  lineno: ['lineno', 'linenumber', 'line'],
  department: ['department', 'dept'],
  departmentname: ['departmentname'],
  maindepartment: ['maindepartment', 'maindept'],
  subdepartment: ['subdepartment', 'subdept'],
  subdeptarment: ['subdeptarment'],
  uom: ['uom', 'unitofmeasure', 'unit'],
  poquantity: ['poquantity', 'quantity', 'qty', 'orderquantity'],
  startdate: ['startdate'],
  enddate: ['enddate'],
  poinvoiced: ['poinvoiced', 'invoicedamount', 'invoiced'],
  poacceptanceapproved: ['poacceptanceapproved', 'acceptanceapproved'],
  poacceptancepending: ['poacceptancepending', 'acceptancepending'],
  poacceptanceunderprocessofapprovals: [
    'poacceptanceunderprocessofapprovals',
    'acceptanceunderprocess',
    'acceptanceinprocess',
  ],
  acceptancerejectedamount: ['acceptancerejectedamount', 'rejectedamount'],
  poacceptancerejectedamount: ['poacceptancerejectedamount'],
  wnd: ['wnd'],
  pownd: ['pownd'],
  pendingtoapply: ['pendingtoapply'],
  popendingtoapplyamount: ['popendingtoapplyamount', 'pendingapplyamount'],
  remainingamount: ['remainingamount', 'remaining', 'balanceamount'],
  milestonestatus: ['milestonestatus'],
  postatus: ['postatus'],
  confirmationstatus: ['confirmationstatus'],
  pendingmilestone: ['pendingmilestone'],
  acceptancestatus: ['acceptancestatus'],
  rejectionremarks: ['rejectionremarks', 'rejectionreason', 'remarks'],
  poworkinprogress: ['poworkinprogress', 'workinprogress', 'wip'],
  advancepositeonhold: ['advancepositeonhold', 'advanceonhold', 'siteonhold'],
} as const satisfies Record<string, readonly string[]>;

export type PoCanonicalField = keyof typeof PO_FIELD_ALIASES;

/** Canonical optional fields → `purchase_orders` column names. */
export const PO_OPTIONAL_DB_COLUMN: Partial<Record<PoCanonicalField, string>> = {
  issuedate: 'issue_date',
  month: 'month',
  year: 'year',
  customer: 'customer',
  projectname: 'project_name',
  subcontractno: 'sub_contract_no',
  projectcode: 'project_code',
  milestone: 'milestone',
  sitecode: 'site_code',
  sitename: 'site_name',
  siteid: 'site_id',
  qcstatus: 'qc_status',
  approverlevel: 'approver_level',
  shipmentnumber: 'shipment_number',
  lineno: 'line_no',
  department: 'department',
  subdepartment: 'sub_department',
  subdeptarment: 'sub_department',
  uom: 'uom',
  poquantity: 'po_quantity',
  startdate: 'start_date',
  enddate: 'end_date',
  poinvoiced: 'po_invoiced',
  poacceptanceapproved: 'po_acceptance_approved',
  poacceptancepending: 'po_acceptance_pending',
  poacceptanceunderprocessofapprovals: 'po_acceptance_pending',
  acceptancerejectedamount: 'acceptance_rejected_amount',
  poacceptancerejectedamount: 'acceptance_rejected_amount',
  wnd: 'wnd',
  pownd: 'wnd',
  pendingtoapply: 'pending_to_apply',
  popendingtoapplyamount: 'pending_to_apply',
  remainingamount: 'remaining_amount',
  milestonestatus: 'milestone_status',
  postatus: 'po_status',
  confirmationstatus: 'confirmation_status',
  pendingmilestone: 'pending_milestone',
  acceptancestatus: 'acceptance_status',
  rejectionremarks: 'rejection_remarks',
};

/** @deprecated Used by uploadHandler column filter — derived from PO_OPTIONAL_DB_COLUMN. */
export const OPTIONAL_HEADER_TO_COLUMN: Record<string, string> = Object.fromEntries(
  Object.entries(PO_FIELD_ALIASES).flatMap(([canonical, aliases]) => {
    const col = PO_OPTIONAL_DB_COLUMN[canonical as PoCanonicalField];
    if (!col) return [];
    return aliases.map((alias) => [alias, col]);
  }),
);

const LINE_ITEM_CORE: PoCanonicalField[] = ['polinesn', 'unitprice', 'poamount'];
const LINE_ITEM_FULL: PoCanonicalField[] = ['po', 'itemcode', 'description', ...LINE_ITEM_CORE];

const LEGACY_TOTAL_ALIASES = ['totalvalue', 'totalamount', 'grandtotal'] as const;

export type PoHeaderMap = Map<PoCanonicalField, string>;

/** Map canonical fields → original column name in the uploaded file. */
export function buildPoHeaderMap(sample: Record<string, unknown>): PoHeaderMap {
  const fileNormToOrig = new Map<string, string>();
  for (const key of Object.keys(sample)) {
    fileNormToOrig.set(normalizeLineHeader(key), key);
  }

  const map = new Map<PoCanonicalField, string>();
  for (const [canonical, aliases] of Object.entries(PO_FIELD_ALIASES) as [PoCanonicalField, readonly string[]][]) {
    for (const alias of aliases) {
      const orig = fileNormToOrig.get(alias);
      if (orig) {
        map.set(canonical, orig);
        break;
      }
    }
  }
  return map;
}

function normalizedHeaderSet(sample: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(sample).map(normalizeLineHeader));
}

function hasAnyAlias(keys: Set<string>, field: PoCanonicalField): boolean {
  const aliases = PO_FIELD_ALIASES[field];
  return aliases.some((alias) => keys.has(alias));
}

function hasEveryAlias(keys: Set<string>, fields: readonly PoCanonicalField[]): boolean {
  return fields.every((field) => hasAnyAlias(keys, field));
}

function hasLegacyTotalColumn(keys: Set<string>): boolean {
  return LEGACY_TOTAL_ALIASES.some((alias) => keys.has(alias));
}

function hasLegacyVendorColumn(keys: Set<string>): boolean {
  return hasAnyAlias(keys, 'customer') || keys.has('vendor');
}

function hasLegacyPoColumn(keys: Set<string>): boolean {
  return keys.has('ponumber') || (keys.has('po') && !hasAnyAlias(keys, 'polinesn'));
}

/** Line-item export vs legacy vendor/total CSV. */
export function detectPoFileFormat(sample: Record<string, unknown> | null | undefined): 'line_items' | 'legacy_vendor' {
  if (!sample || Object.keys(sample).length === 0) return 'legacy_vendor';
  const keys = normalizedHeaderSet(sample);

  if (hasEveryAlias(keys, LINE_ITEM_CORE)) return 'line_items';
  if (hasEveryAlias(keys, LINE_ITEM_FULL)) return 'line_items';

  if (hasLegacyPoColumn(keys) && hasLegacyVendorColumn(keys) && hasLegacyTotalColumn(keys)) {
    return 'legacy_vendor';
  }

  if (hasAnyAlias(keys, 'polinesn')) return 'line_items';

  return 'legacy_vendor';
}

export function resolvePoField(
  obj: Record<string, unknown>,
  headerMap: PoHeaderMap,
  field: PoCanonicalField,
): unknown {
  const orig = headerMap.get(field);
  return orig != null ? obj[orig] : undefined;
}

export function resolvePoFieldFirst(
  obj: Record<string, unknown>,
  headerMap: PoHeaderMap,
  ...fields: PoCanonicalField[]
): unknown {
  for (const field of fields) {
    const value = resolvePoField(obj, headerMap, field);
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    return value;
  }
  return undefined;
}

/** Fields stored only in source_row (no purchase_orders column yet). */
export const SOURCE_ROW_ONLY_FIELDS = new Set<PoCanonicalField>(['poworkinprogress', 'advancepositeonhold']);
