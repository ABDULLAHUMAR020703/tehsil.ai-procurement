import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { ApprovalStageRole } from '../auth/types';
import type { ProjectRow } from './projectGuards';

export async function resolvePmUserIdForDepartment(department: string, companyId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'pm')
    .eq('department', department)
    .eq('company_id', companyId)
    .limit(1);
  if (error) throw error;
  if (data && data.length > 0) return data[0].id;

  const { data: fallback, error: fbErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('role', 'pm')
    .eq('company_id', companyId)
    .limit(1);
  if (fbErr) throw fbErr;
  if (!fallback || fallback.length === 0) throw new AppError(`No PM found for department=${department}`, 500);
  return fallback[0].id;
}

/**
 * Ordered workflow stages for a purchase request on this project.
 * Skips team_lead when `project.team_lead_id` is null.
 * Admin is not a required stage; admins use override / force approve in the app.
 */
export async function buildApprovalStagesForProject(project: ProjectRow): Promise<
  { role: ApprovalStageRole; approver_id: string }[]
> {
  const out: { role: ApprovalStageRole; approver_id: string }[] = [];

  if (project.team_lead_id) {
    out.push({ role: 'team_lead', approver_id: project.team_lead_id });
  }

  const pmId = project.pm_id ?? (await resolvePmUserIdForDepartment(project.department_id, project.company_id));
  out.push({ role: 'pm', approver_id: pmId });

  return out;
}
