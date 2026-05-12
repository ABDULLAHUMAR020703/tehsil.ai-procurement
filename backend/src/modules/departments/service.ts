import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { slugifyDepartmentCode } from './slug';

/** Returns canonical code if the row exists for this tenant. */
export async function resolveDepartmentCode(
  value: string | null | undefined,
  companyId: string,
): Promise<string | null> {
  if (!value || !String(value).trim()) return null;
  const code = String(value).trim();
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('company_id', companyId)
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return (data?.code as string) ?? null;
}

export async function assertDepartmentExists(code: string, companyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('company_id', companyId)
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError('Invalid department', 400);
}

export type DepartmentRow = { code: string; display_name: string };

export type DepartmentWithCounts = DepartmentRow & {
  employee_count: number;
  project_count: number;
};

function normalizeDisplayName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) throw new AppError('Department name is required', 400);
  if (s.length > 200) throw new AppError('Department name is too long', 400);
  return s;
}

async function codesInUse(companyId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('departments').select('code').eq('company_id', companyId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.code as string));
}

export async function generateUniqueDepartmentCode(displayName: string, companyId: string): Promise<string> {
  const base = slugifyDepartmentCode(displayName);
  const used = await codesInUse(companyId);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new AppError('Could not allocate a unique department code', 500);
}

export async function listDepartmentsWithCounts(companyId: string): Promise<DepartmentWithCounts[]> {
  const { data: depts, error: dErr } = await supabaseAdmin
    .from('departments')
    .select('code, display_name')
    .eq('company_id', companyId)
    .order('display_name', { ascending: true });
  if (dErr) throw dErr;

  const { data: users, error: uErr } = await supabaseAdmin
    .from('users')
    .select('department')
    .eq('company_id', companyId);
  if (uErr) throw uErr;

  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('department_id')
    .eq('company_id', companyId);
  if (pErr) throw pErr;

  const empByDept = new Map<string, number>();
  for (const row of users ?? []) {
    const d = row.department as string;
    empByDept.set(d, (empByDept.get(d) ?? 0) + 1);
  }

  const projByDept = new Map<string, number>();
  for (const row of projects ?? []) {
    const d = row.department_id as string;
    projByDept.set(d, (projByDept.get(d) ?? 0) + 1);
  }

  return (depts ?? []).map((r) => ({
    code: r.code as string,
    display_name: r.display_name as string,
    employee_count: empByDept.get(r.code as string) ?? 0,
    project_count: projByDept.get(r.code as string) ?? 0,
  }));
}

async function displayNameTaken(name: string, companyId: string, exceptCode?: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('departments').select('code, display_name').eq('company_id', companyId);
  if (error) throw error;
  const lower = name.toLowerCase();
  return (data ?? []).some(
    (r) =>
      (r.display_name as string).toLowerCase() === lower && (exceptCode == null || (r.code as string) !== exceptCode),
  );
}

export async function createDepartment(displayName: string, companyId: string): Promise<DepartmentWithCounts> {
  const name = normalizeDisplayName(displayName);
  if (await displayNameTaken(name, companyId)) throw new AppError('A department with this name already exists', 409);
  const code = await generateUniqueDepartmentCode(name, companyId);

  const { data, error } = await supabaseAdmin
    .from('departments')
    .insert({ code, display_name: name, company_id: companyId })
    .select('code, display_name')
    .single();
  if (error) {
    if (error.code === '23505') throw new AppError('A department with this name already exists', 409);
    throw error;
  }
  return {
    code: data!.code as string,
    display_name: data!.display_name as string,
    employee_count: 0,
    project_count: 0,
  };
}

export async function updateDepartmentDisplayName(
  code: string,
  displayName: string,
  companyId: string,
): Promise<DepartmentRow> {
  const name = normalizeDisplayName(displayName);

  const { data: row, error: findErr } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('company_id', companyId)
    .eq('code', code)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) throw new AppError('Department not found', 404);

  if (await displayNameTaken(name, companyId, code)) throw new AppError('A department with this name already exists', 409);

  const { data, error } = await supabaseAdmin
    .from('departments')
    .update({ display_name: name })
    .eq('company_id', companyId)
    .eq('code', code)
    .select('code, display_name')
    .single();
  if (error) {
    if (error.code === '23505') throw new AppError('A department with this name already exists', 409);
    throw error;
  }
  return { code: data!.code as string, display_name: data!.display_name as string };
}

export async function deleteDepartmentIfEmpty(code: string, companyId: string): Promise<void> {
  const { data: row, error: findErr } = await supabaseAdmin
    .from('departments')
    .select('code')
    .eq('company_id', companyId)
    .eq('code', code)
    .maybeSingle();
  if (findErr) throw findErr;
  if (!row) throw new AppError('Department not found', 404);

  const { count: empCount, error: eErr } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('department', code);
  if (eErr) throw eErr;

  const nEmp = empCount ?? 0;
  if (nEmp > 0) {
    throw new AppError(`This department has ${nEmp} employee(s). Reassign them before deleting.`, 409, {
      employee_count: nEmp,
    });
  }

  const { count: projCount, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('department_id', code);
  if (pErr) throw pErr;

  const nProj = projCount ?? 0;
  if (nProj > 0) {
    throw new AppError(`This department has ${nProj} project(s). Remove or reassign projects first.`, 409, {
      project_count: nProj,
    });
  }

  const { error: delErr } = await supabaseAdmin.from('departments').delete().eq('company_id', companyId).eq('code', code);
  if (delErr) throw delErr;
}

/** Seed default departments for a new tenant (idempotent per company). */
export async function seedDefaultDepartmentsForCompany(companyId: string): Promise<void> {
  const defaults: { code: string; display_name: string }[] = [
    { code: 'finance', display_name: 'Finance' },
    { code: 'hr', display_name: 'HR' },
    { code: 'operations', display_name: 'Operations' },
    { code: 'procurement', display_name: 'Procurement' },
  ];
  for (const d of defaults) {
    const { error } = await supabaseAdmin.from('departments').insert({
      company_id: companyId,
      code: d.code,
      display_name: d.display_name,
    });
    if (error && error.code !== '23505') throw error;
  }
}
