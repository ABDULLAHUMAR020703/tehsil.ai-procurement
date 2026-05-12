import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import type { TenantAuth } from '../../tenant/tenantScope';
import { tenantFilterCompanyId } from '../../tenant/tenantScope';
import { bypassesDepartmentScope, isDeptManagerRole, type UserRole } from '../auth/types';

export type ProjectAccessRow = {
  id: string;
  company_id: string;
  department_id: string;
  team_lead_id: string | null;
  pm_id: string;
  created_by: string;
  status: string;
  po_id: string | null;
};

export async function fetchProjectForAccess(projectId: string, auth?: TenantAuth): Promise<ProjectAccessRow> {
  let q = supabaseAdmin
    .from('projects')
    .select('id, company_id, department_id, team_lead_id, pm_id, created_by, status, po_id')
    .eq('id', projectId);
  if (auth) {
    const cid = tenantFilterCompanyId(auth);
    if (cid) q = q.eq('company_id', cid);
  }
  const { data: project, error } = await q.single();
  if (error || !project) throw error ?? new AppError('Project not found', 404);
  const pmId = project.pm_id as string | null;
  if (!pmId) throw new AppError('Project is missing an assigned PM', 500);
  return { ...(project as Omit<ProjectAccessRow, 'pm_id'>), pm_id: pmId };
}

/** Projects an employee may see: assignments, TL/PM role on project, or “open” dept projects with no assignment rows yet. */
export async function loadEmployeeVisibleProjectIds(params: {
  userId: string;
  department: string;
  companyId: string;
}): Promise<string[]> {
  const { userId, department, companyId } = params;
  const { data: fromAssign, error: aErr } = await supabaseAdmin
    .from('project_assignments')
    .select('project_id')
    .eq('company_id', companyId)
    .eq('employee_id', userId);
  if (aErr) throw aErr;
  const ids = new Set((fromAssign ?? []).map((r) => r.project_id as string));

  const { data: tlRows, error: tlErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('company_id', companyId)
    .eq('team_lead_id', userId)
    .neq('status', 'archived');
  if (tlErr) throw tlErr;
  for (const r of tlRows ?? []) ids.add(r.id as string);

  const { data: pmRows, error: pmErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('company_id', companyId)
    .eq('pm_id', userId)
    .neq('status', 'archived');
  if (pmErr) throw pmErr;
  for (const r of pmRows ?? []) ids.add(r.id as string);

  const { data: deptProjects, error: dErr } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('company_id', companyId)
    .eq('department_id', department)
    .neq('status', 'archived');
  if (dErr) throw dErr;
  const deptIds = (deptProjects ?? []).map((p) => p.id as string);
  if (deptIds.length === 0) return [...ids];

  const { data: assignRows, error: arErr } = await supabaseAdmin
    .from('project_assignments')
    .select('project_id')
    .eq('company_id', companyId)
    .in('project_id', deptIds);
  if (arErr) throw arErr;
  const projectsWithAnyAssignment = new Set((assignRows ?? []).map((r) => r.project_id as string));
  for (const pid of deptIds) {
    if (!projectsWithAnyAssignment.has(pid)) ids.add(pid);
  }

  return [...ids];
}

export async function assertActorMayViewProject(params: {
  project: ProjectAccessRow;
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { project, actorUserId, actorRole, actorDepartment } = params;
  if (bypassesDepartmentScope(actorRole)) return;
  if (isDeptManagerRole(actorRole)) {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('Forbidden', 403);
    }
    return;
  }
  if (actorRole === 'employee') {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('Forbidden', 403);
    }
    if (project.team_lead_id === actorUserId || project.pm_id === actorUserId) return;

    const { data: hit, error } = await supabaseAdmin
      .from('project_assignments')
      .select('project_id')
      .eq('company_id', project.company_id)
      .eq('project_id', project.id)
      .eq('employee_id', actorUserId)
      .maybeSingle();
    if (error) throw error;
    if (hit) return;

    const { count, error: cErr } = await supabaseAdmin
      .from('project_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', project.company_id)
      .eq('project_id', project.id);
    if (cErr) throw cErr;
    if ((count ?? 0) === 0) return;

    throw new AppError('You are not assigned to this project', 403);
  }
  throw new AppError('Forbidden', 403);
}

export async function assertActorMaySubmitPurchaseRequestForProject(params: {
  project: ProjectAccessRow;
  actorUserId: string;
  actorRole: UserRole;
  actorDepartment: string | null;
}) {
  const { project, actorUserId, actorRole, actorDepartment } = params;
  if (bypassesDepartmentScope(actorRole)) return;
  if (isDeptManagerRole(actorRole)) {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('Purchase requests can only be submitted for projects in your department', 403);
    }
    return;
  }
  if (actorRole === 'employee') {
    if (!actorDepartment || actorDepartment !== project.department_id) {
      throw new AppError('Purchase requests can only be submitted for projects in your department', 403);
    }
    if (project.team_lead_id === actorUserId || project.pm_id === actorUserId) return;

    const { data: hit, error } = await supabaseAdmin
      .from('project_assignments')
      .select('project_id')
      .eq('company_id', project.company_id)
      .eq('project_id', project.id)
      .eq('employee_id', actorUserId)
      .maybeSingle();
    if (error) throw error;
    if (hit) return;

    const { count, error: cErr } = await supabaseAdmin
      .from('project_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', project.company_id)
      .eq('project_id', project.id);
    if (cErr) throw cErr;
    if ((count ?? 0) === 0) return;

    throw new AppError('You are not assigned to this project', 403);
  }
  throw new AppError('Forbidden', 403);
}
