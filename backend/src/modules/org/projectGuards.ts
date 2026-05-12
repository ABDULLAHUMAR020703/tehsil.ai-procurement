import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { TenantAuth } from '../../tenant/tenantScope';
import { isPlatformAdminRole, bypassesDepartmentScope, isDeptManagerRole, type UserRole } from '../auth/types';

export type ProjectRow = {
  id: string;
  company_id: string;
  department_id: string;
  team_lead_id: string | null;
  /** Responsible PM for approval chain; may be null before DB migration backfill. */
  pm_id: string | null;
  created_by: string;
  status: string;
};

export function isTeamLeadOnProject(params: { projectTeamLeadId: string | null; userId: string }): boolean {
  return params.projectTeamLeadId != null && params.projectTeamLeadId === params.userId;
}

export async function fetchProjectOrThrow(projectId: string, auth?: TenantAuth): Promise<ProjectRow> {
  let q = supabaseAdmin
    .from('projects')
    .select('id, company_id, department_id, team_lead_id, pm_id, created_by, status')
    .eq('id', projectId);
  if (auth && !isPlatformAdminRole(auth.role)) {
    q = q.eq('company_id', auth.companyId);
  }
  const { data: project, error } = await q.single();
  if (error || !project) throw error ?? new AppError('Project not found', 404);
  return project as ProjectRow;
}

export async function assertActorMayManageProject(params: {
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
  project: ProjectRow;
}) {
  const { actorUserId, actorRole, actorDepartment, project } = params;
  if (bypassesDepartmentScope(actorRole)) return;
  if (isDeptManagerRole(actorRole)) {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('You can only manage projects in your own department', 403);
    }
    return;
  }
  throw new AppError('Forbidden', 403);
}

export async function assertUserEligibleTeamLead(params: {
  teamLeadUserId: string;
  projectDepartment: string;
  companyId: string;
}) {
  const { teamLeadUserId, projectDepartment, companyId } = params;
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, department, role, company_id')
    .eq('id', teamLeadUserId)
    .eq('company_id', companyId)
    .single();
  if (error || !user) throw error ?? new AppError('Team lead user not found', 404);
  if (user.department !== projectDepartment) {
    throw new AppError('Team lead must belong to the same department as the project', 400);
  }
  if (user.role === 'admin') {
    throw new AppError('Admin users cannot be assigned as project team lead', 400);
  }
}
