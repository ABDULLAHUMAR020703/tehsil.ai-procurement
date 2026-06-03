import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';
import { z } from 'zod';
import { AppError } from '../../utils/errors';
import { bypassesDepartmentScope } from '../auth/types';
import { assertDepartmentExists } from '../departments/service';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';
import { applyTenantEq, type TenantAuth } from '../../tenant/tenantScope';

export const usersRouter = Router();

usersRouter.use(requireAuth);

const DepartmentCodeSchema = z.string().min(1).max(64).regex(/^[a-z0-9_]+$/);
const RoleSchema = z.enum(['admin', 'pm', 'dept_head', 'employee', 'platform_admin']);

usersRouter.get('/', requireRole('admin', 'pm', 'dept_head', 'platform_admin'), async (req, res, next) => {
  try {
    const role = req.auth!.role;
    const companyId = companyScopeForRequest(req);
    const tenantAuth = req.auth as TenantAuth;

    let q = applyTenantEq(
      supabaseAdmin.from('users').select('id,name,email,role,department,job_title,created_at'),
      tenantAuth,
    ).order('created_at', {
      ascending: false,
    });

    const deptFilter =
      typeof req.query.department === 'string' && req.query.department
        ? req.query.department
        : null;

    const roleFilterRaw = typeof req.query.role === 'string' ? req.query.role.trim() : '';
    if (roleFilterRaw) {
      const parsedRole = RoleSchema.safeParse(roleFilterRaw);
      if (!parsedRole.success) throw new AppError('Invalid role filter', 400);
      q = q.eq('role', parsedRole.data);
    }

    if (role === 'pm' || role === 'dept_head') {
      const d = req.auth!.department;
      if (!d) throw new AppError('Profile must have a department', 400);
      q = q.eq('department', d);
    } else if (bypassesDepartmentScope(role) && deptFilter) {
      await assertDepartmentExists(deptFilter, companyId);
      q = q.eq('department', deptFilter);
    }

    const { data, error } = await q;
    if (error) throw error;
    if (process.env.DEBUG_TENANT === '1') {
      // eslint-disable-next-line no-console
      console.log('[DEBUG_TENANT] /api/users GET', {
        authUserId: req.auth!.userId,
        authRole: req.auth!.role,
        companyId,
        rowCount: (data ?? []).length,
      });
    }
    res.json({ users: data ?? [] });
  } catch (err) {
    next(err);
  }
});

const CreateUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(6).max(128),
  role: RoleSchema,
  department: DepartmentCodeSchema.optional(),
});

usersRouter.post('/', requireRole('admin', 'platform_admin'), async (req, res, next) => {
  try {
    const parsed = CreateUserSchema.parse(req.body ?? {});
    const companyId = companyScopeForRequest(req);

    if (parsed.role !== 'admin' && parsed.role !== 'platform_admin' && !parsed.department) {
      throw new AppError('Department is required for non-admin roles', 400);
    }

    const department =
      parsed.role === 'admin' || parsed.role === 'platform_admin'
        ? 'management'
        : parsed.department!;

    if (parsed.role !== 'admin' && parsed.role !== 'platform_admin') {
      await assertDepartmentExists(department, companyId);
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: parsed.email,
      password: parsed.password,
      email_confirm: true,
      user_metadata: { name: parsed.name },
    });
    if (authErr) throw new AppError(authErr.message, 400);
    const authUserId = authData.user.id;

    const { data: userRow, error: insertErr } = await supabaseAdmin
      .from('users')
      .insert({ id: authUserId, name: parsed.name, email: parsed.email, role: parsed.role, department, company_id: companyId })
      .select('id,name,email,role,department,created_at')
      .single();

    if (insertErr) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw new AppError(`Failed to create user record: ${insertErr.message}`, 500);
    }

    res.status(201).json({ user: userRow });
  } catch (err) {
    next(err);
  }
});

const PatchUserSchema = z.object({
  role: RoleSchema.optional(),
  department: DepartmentCodeSchema.optional(),
  name: z.string().min(1).max(200).optional(),
});

usersRouter.patch('/:id', requireRole('admin', 'platform_admin'), async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.id);
    const parsed = PatchUserSchema.parse(req.body ?? {});

    if (Object.keys(parsed).length === 0) {
      throw new AppError('No updates provided', 400);
    }

    const tenantAuth = req.auth as TenantAuth;
    const loadQ = applyTenantEq(
      supabaseAdmin.from('users').select('id, name, email, role, department, company_id').eq('id', userId),
      tenantAuth,
    );
    const { data: row, error: loadErr } = await loadQ.single();
    if (loadErr || !row) throw loadErr ?? new AppError('User not found', 404);

    if (parsed.department !== undefined) {
      await assertDepartmentExists(parsed.department, row.company_id as string);
    }

    const merged = {
      name: parsed.name ?? row.name,
      role: parsed.role ?? row.role,
      department: parsed.department ?? row.department,
    };

    if (merged.role === 'admin') {
      const { data: mgmtDept } = await supabaseAdmin
        .from('departments')
        .select('code')
        .eq('company_id', row.company_id as string)
        .eq('code', 'management')
        .maybeSingle();
      merged.department = mgmtDept ? 'management' : 'operations';
    }
    if (merged.role !== 'admin' && merged.department === 'management') {
      throw new AppError('Only admin users may belong to the management department', 400);
    }

    const updQ = applyTenantEq(
      supabaseAdmin
        .from('users')
        .update({
          name: merged.name,
          role: merged.role,
          department: merged.department,
        })
        .eq('id', userId),
      tenantAuth,
    );

    const { data, error } = await updQ.select('id,name,email,role,department,job_title,created_at').single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) {
    next(err);
  }
});

usersRouter.delete('/:id', requireRole('admin', 'platform_admin'), async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.id);
    const actorId = req.auth!.userId;

    if (userId === actorId) {
      throw new AppError('You cannot delete your own account', 400);
    }

    const tenantAuth = req.auth as TenantAuth;

    // Verify user belongs to the same company before doing anything
    const { data: row, error: loadErr } = await applyTenantEq(
      supabaseAdmin.from('users').select('id, company_id').eq('id', userId),
      tenantAuth,
    ).single();
    if (loadErr || !row) throw new AppError('User not found', 404);

    // Delete from public.users first (FK constraints); auth user deletion follows
    const { error: delErr } = await applyTenantEq(
      supabaseAdmin.from('users').delete().eq('id', userId),
      tenantAuth,
    );
    if (delErr) throw delErr;

    // Delete from Supabase Auth — best-effort, don't fail the request if this errors
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => null);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
