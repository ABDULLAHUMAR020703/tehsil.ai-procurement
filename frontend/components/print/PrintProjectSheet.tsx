'use client';

import { useMemo } from 'react';
import type { PrintProjectDetailResponse } from '../../lib/printDocumentTypes';
import { APP_NAME } from '@/lib/appMeta';
import { formatPkrSafe, na, prStatusBadgeClasses, projectStatusBadgeClasses } from './printUi';

function watermarkLabel(status: string) {
  const u = status.toLowerCase();
  if (u === 'active') return 'ACTIVE';
  if (u === 'archived') return 'ARCHIVED';
  return status.toUpperCase();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

export function PrintProjectSheet({
  data,
  showPrintHint = true,
}: {
  data: PrintProjectDetailResponse;
  showPrintHint?: boolean;
}) {
  const financial = useMemo(() => {
    if (!data?.project) return null;
    const po = data.purchaseOrder;
    const totalBudget = po ? Number(po.total_value) : Number(data.project.budget);
    const remaining = po ? Number(po.remaining_value) : Number(data.project.budget);
    const consumed = Math.max(0, totalBudget - remaining);
    return { totalBudget, remaining, consumed };
  }, [data]);

  const p = data.project;
  const po = data.purchaseOrder;
  const prs = data.relatedPurchaseRequests ?? [];
  const wm = watermarkLabel(p.status);
  const shortCode = p.id.slice(0, 8).toUpperCase();
  const reportDate = p.updated_at
    ? new Date(p.updated_at).toLocaleString()
    : new Date(p.created_at).toLocaleString();

  const employees =
    p.assigned_employees.length > 0
      ? p.assigned_employees.map((e) => e.name || e.email || e.id).join(', ')
      : 'N/A';

  const poLine = po
    ? `${na(po.po?.trim() || po.po_number?.trim() || po.id.slice(0, 8))}${po.vendor ? ` · ${po.vendor}` : ''}`
    : 'N/A';

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center text-7xl font-bold uppercase tracking-widest text-gray-200/50 print:text-gray-300/40"
        aria-hidden
        style={{ transform: 'rotate(-18deg)' }}
      >
        {wm}
      </div>

      <div className="print-container relative z-[1] mx-auto max-w-[800px] rounded-lg border border-gray-200 bg-white p-8 shadow-sm print:shadow-none">
        <header className="mb-8 flex flex-col gap-6 border-b border-gray-200 pb-6 sm:flex-row sm:justify-between sm:gap-4">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-gray-900">{APP_NAME}</p>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Official Document</p>
          </div>
          <div className="space-y-2 text-right sm:max-w-[55%]">
            <p className="text-lg font-semibold text-gray-900">Project Report</p>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">ID:</span> {na(p.id)}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">Reference:</span> {shortCode}
            </p>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-700">Date:</span> {reportDate}
            </p>
            <div className="flex justify-end pt-1">
              <span className={projectStatusBadgeClasses(p.status)}>{p.status}</span>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          <Section title="Project info">
            <div className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs font-medium text-gray-500">Project name</p>
                <p className="text-base font-medium text-gray-900">{na(p.name)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Department</p>
                <p className="text-gray-900">{na(p.department_label || p.department_id)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Linked PO / vendor</p>
                <p className="text-gray-900">{poLine}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Project manager</p>
                <p className="text-gray-900">{na(p.pm?.name?.trim() || p.pm?.email?.trim())}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-gray-500">Team lead</p>
                <p className="text-gray-900">{na(p.team_lead?.name?.trim() || p.team_lead?.email?.trim())}</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <p className="text-xs font-medium text-gray-500">Assigned employees</p>
                <p className="text-gray-900">{employees}</p>
              </div>
            </div>
          </Section>

          <Section title="Financial overview">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <dl className="grid gap-3 text-sm">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-gray-600">Total budget</dt>
                  <dd className="text-right font-semibold tabular-nums text-gray-900">
                    {financial ? formatPkrSafe(financial.totalBudget) : 'N/A'}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-gray-600">Consumed</dt>
                  <dd className="text-right tabular-nums text-gray-900">
                    {financial ? formatPkrSafe(financial.consumed) : 'N/A'}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
                  <dt className="text-gray-600">Remaining</dt>
                  <dd className="text-right font-semibold tabular-nums text-gray-900">
                    {financial ? formatPkrSafe(financial.remaining) : 'N/A'}
                  </dd>
                </div>
              </dl>
            </div>
          </Section>

          <Section title="Linked PRs">
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-gray-700">
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">PR ID</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Description</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold tabular-nums">Amount</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Status</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody className="text-gray-800">
                  {prs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="border-b border-gray-200 px-3 py-3 text-center text-gray-500">
                        No purchase requests for this project.
                      </td>
                    </tr>
                  ) : (
                    prs.map((r) => (
                      <tr key={r.id} className="break-inside-avoid">
                        <td className="border-b border-gray-200 px-3 py-2 align-top font-mono text-xs">{`${r.id.slice(0, 8)}…`}</td>
                        <td className="border-b border-gray-200 px-3 py-2 align-top">{na(r.description)}</td>
                        <td className="border-b border-gray-200 px-3 py-2 text-right align-top tabular-nums">
                          {formatPkrSafe(r.amount)}
                        </td>
                        <td className="border-b border-gray-200 px-3 py-2 align-top">
                          <span className={prStatusBadgeClasses(r.status)}>{r.status.replaceAll('_', ' ')}</span>
                        </td>
                        <td className="border-b border-gray-200 px-3 py-2 align-top text-gray-600">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : 'N/A'}
                        </td>
                      </tr>
                    ))
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
