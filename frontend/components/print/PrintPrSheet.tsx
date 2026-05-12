'use client';

import { formatPkr } from '../../lib/api';
import { approvalStageLabel, sortApprovalStageIndex } from '../../lib/org';
import type { PrintPurchaseRequestDetailResponse } from '../../lib/printDocumentTypes';
import { APP_NAME } from '@/lib/appMeta';
import { formatPkrSafe, na, prStatusBadgeClasses } from './printUi';

function watermarkLabel(status: string) {
  const u = status.toLowerCase();
  if (u === 'pending' || u === 'pending_exception') return 'PENDING';
  if (u === 'rejected') return 'REJECTED';
  if (u === 'approved') return 'APPROVED';
  return '';
}

function budgetReference(
  project: PrintPurchaseRequestDetailResponse['project'],
  purchaseOrder: PrintPurchaseRequestDetailResponse['purchaseOrder'],
) {
  if (!project) return 'N/A';
  if (purchaseOrder) {
    const label =
      purchaseOrder.po?.trim() || purchaseOrder.po_number?.trim() || purchaseOrder.id.slice(0, 8);
    return `PO ${label}`;
  }
  return `Project budget ${formatPkr(Number(project.budget))}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

export function PrintPrSheet({
  data,
  showPrintHint = true,
}: {
  data: PrintPurchaseRequestDetailResponse;
  showPrintHint?: boolean;
}) {
  const pr = data.purchaseRequest;
  if (!pr) return null;

  const project = data.project;
  const po = data.purchaseOrder;
  const summary = pr.poLineSummary ?? null;
  const qty = summary?.requested_quantity ?? null;
  const unitPrice = summary?.unit_price;
  const itemLabel = summary?.item_code?.trim() || pr.itemCode?.trim() || 'Requested item';
  const desc = na(summary?.line_description?.trim() || summary?.pr_description || pr.description);
  const requestedBy = na(pr.createdBy?.name?.trim() || pr.createdBy?.email?.trim() || pr.createdBy?.id);
  const dept = na(project?.department_label || project?.department_id);
  const wm = watermarkLabel(pr.status);

  const sortedApprovals = [...data.approvals].sort(
    (a, b) => sortApprovalStageIndex(a.role) - sortApprovalStageIndex(b.role),
  );

  const qtyCell = qty != null && Number.isFinite(qty) ? String(qty) : 'N/A';
  const unitCell =
    unitPrice != null && Number.isFinite(unitPrice)
      ? formatPkr(unitPrice)
      : qty != null && qty > 0 && Number.isFinite(pr.amount / qty)
        ? formatPkr(pr.amount / qty)
        : 'N/A';

  const docDate = new Date(pr.createdAt).toLocaleString();

  return (
    <>
      {wm ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-gray-200/50 print:text-gray-300/40"
          aria-hidden
          style={{ transform: 'rotate(-18deg)' }}
        >
          {wm}
        </div>
      ) : null}

      <div className="print-container relative z-[1] mx-auto max-w-[800px] rounded-lg border border-gray-200 bg-white p-8 shadow-sm print:shadow-none">
        <header className="mb-8 flex flex-col gap-6 border-b border-gray-200 pb-6 sm:flex-row sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-gray-900">{APP_NAME}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Official Document</p>
          </div>
          <div className="space-y-2 text-right sm:max-w-[55%]">
            <p className="text-lg font-semibold text-gray-900">Purchase Request</p>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">ID:</span> {na(pr.id)}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">Date:</span> {docDate}
            </p>
            <div className="flex justify-end pt-1">
              <span className={prStatusBadgeClasses(pr.status)}>{pr.status.replaceAll('_', ' ')}</span>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          <Section title="Project info">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Project name</p>
                <p className="text-gray-900">{na(project?.name)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Department</p>
                <p className="text-gray-900">{dept}</p>
              </div>
            </div>
          </Section>

          <Section title="Requested by">
            <p className="text-sm text-gray-900">{requestedBy}</p>
            {pr.duplicateCount != null && pr.duplicateCount > 1 ? (
              <p className="text-xs text-gray-500">Duplicate submissions: {pr.duplicateCount}</p>
            ) : null}
          </Section>

          <Section title="Items">
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-gray-700">
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Item</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Description</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold tabular-nums">Qty</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold tabular-nums">Unit price</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold tabular-nums">Total</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  <tr className="break-inside-avoid">
                    <td className="border-b border-gray-200 px-3 py-2 align-top">{itemLabel}</td>
                    <td className="border-b border-gray-200 px-3 py-2 align-top">{desc}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-right align-top tabular-nums">{qtyCell}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-right align-top tabular-nums">{unitCell}</td>
                    <td className="border-b border-gray-200 px-3 py-2 text-right align-top font-medium tabular-nums">
                      {formatPkrSafe(pr.amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Financial summary">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-1">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-gray-600">Request total</dt>
                  <dd className="text-right font-semibold tabular-nums text-gray-900">{formatPkrSafe(pr.amount)}</dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-gray-600">Budget / PO reference</dt>
                  <dd className="text-right text-gray-900">{budgetReference(project, po)}</dd>
                </div>
                {po ? (
                  <>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                      <dt className="text-gray-600">PO total (system)</dt>
                      <dd className="text-right tabular-nums text-gray-900">{formatPkrSafe(po.total_value)}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                      <dt className="text-gray-600">PO remaining</dt>
                      <dd className="text-right font-semibold tabular-nums text-gray-900">
                        {formatPkrSafe(po.remaining_value)}
                      </dd>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                    <dt className="text-gray-600">PO remaining</dt>
                    <dd className="text-right text-gray-500">N/A</dd>
                  </div>
                )}
              </dl>
            </div>
          </Section>

          <Section title="Approval flow">
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-gray-700">
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Role</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Name</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Status</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Date</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Comments</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {sortedApprovals.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border-b border-gray-200 px-3 py-3 text-center text-gray-500">
                        No approval rows.
                      </td>
                    </tr>
                  ) : (
                    sortedApprovals.map((a) => {
                      const when = a.updated_at || a.created_at;
                      const name = a.approver?.name?.trim() || a.approver?.email?.trim() || na(a.approver_id.slice(0, 8));
                      return (
                        <tr key={a.id} className="break-inside-avoid">
                          <td className="border-b border-gray-200 px-3 py-2 align-top">
                            {approvalStageLabel(a.role, { legacyAdmin: true })}
                          </td>
                          <td className="border-b border-gray-200 px-3 py-2 align-top">{name}</td>
                          <td className="border-b border-gray-200 px-3 py-2 align-top">
                            <span className={prStatusBadgeClasses(a.status)}>{a.status}</span>
                          </td>
                          <td className="border-b border-gray-200 px-3 py-2 align-top text-gray-600">
                            {when ? new Date(when).toLocaleString() : 'N/A'}
                          </td>
                          <td className="max-w-[200px] border-b border-gray-200 px-3 py-2 align-top text-gray-700">
                            {na((a.comments ?? '').trim() || null)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <footer className="mt-10 border-t border-gray-100 pt-6 text-center text-xs text-gray-400">
          Generated by {APP_NAME}
          <br />
          {new Date().toLocaleString()}
        </footer>

        {showPrintHint ? (
          <p className="no-print mt-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-center text-xs text-gray-600">
            When the print dialog opens, choose <span className="font-semibold text-gray-800">Save as PDF</span>.
          </p>
        ) : null}
      </div>
    </>
  );
}
