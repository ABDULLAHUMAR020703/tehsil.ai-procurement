/**
 * Project-scoped team lead (not a global role). Use with project rows from the API.
 */
export function isTeamLeadForProject(
  project: { team_lead_id?: string | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(userId && project?.team_lead_id && project.team_lead_id === userId);
}

/** Required chain: Team Lead -> PM (PM final). Admin is not in this list. */
export const REQUIRED_APPROVAL_STAGE_ORDER = ['team_lead', 'pm'] as const;

/** Sort order when listing rows that may still include legacy `admin` records. */
export const APPROVAL_STAGE_SORT_ORDER = ['team_lead', 'pm', 'admin'] as const;

export type RequiredApprovalStage = (typeof REQUIRED_APPROVAL_STAGE_ORDER)[number];
export type ApprovalStage = (typeof APPROVAL_STAGE_SORT_ORDER)[number];

export function approvalStageLabel(role: string, opts?: { legacyAdmin?: boolean }): string {
  switch (role) {
    case 'team_lead':
      return 'Team Lead';
    case 'pm':
      return 'PM';
    case 'admin':
      return opts?.legacyAdmin ? 'Admin (legacy record)' : 'Admin';
    default:
      return role;
  }
}

export function approvalPipelineStatus(
  role: string,
  status: string,
  opts?: { isAdminOverride?: boolean },
): string {
  if (status === 'approved') {
    if (opts?.isAdminOverride) return 'Approved (admin override)';
    if (role === 'admin') return 'Closed (legacy admin row)';
    return 'Approved';
  }
  if (status === 'rejected') {
    if (opts?.isAdminOverride) return 'Rejected (admin override)';
    return 'Rejected';
  }
  if (role === 'team_lead') return 'Pending Team Lead Approval';
  if (role === 'pm') return 'Pending PM Approval';
  if (role === 'admin') return 'Legacy admin row (not required)';
  return 'Pending';
}

export function sortApprovalStageIndex(role: string): number {
  const idx = APPROVAL_STAGE_SORT_ORDER.indexOf(role as ApprovalStage);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}
