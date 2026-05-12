import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requireRole } from '../../middleware/rbac';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../utils/errors';
import { companyScopeForRequest } from '../../tenant/requestCompanyId';
import { onboardNewCompany } from './onboardCompany';

export const platformRouter = Router();
platformRouter.use(requireAuth);
platformRouter.use(requireRole('platform_admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

platformRouter.get('/companies', async (req, res, next) => {
  try {
    const cid = companyScopeForRequest(req);
    const { data: company, error } = await supabaseAdmin
      .from('companies')
      .select('id, name, logo_url, country, timezone, currency, is_active, created_at')
      .eq('id', cid)
      .maybeSingle();
    if (error) throw error;
    if (!company) {
      res.json({ companies: [] });
      return;
    }

    const id = company.id as string;
    const [{ count: userCount }, { count: prCount }, { count: projectCount }] = await Promise.all([
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('company_id', id),
      supabaseAdmin.from('purchase_requests').select('*', { count: 'exact', head: true }).eq('company_id', id),
      supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('company_id', id),
    ]);

    res.json({
      companies: [
        {
          ...company,
          stats: {
            users: userCount ?? 0,
            purchase_requests: prCount ?? 0,
            projects: projectCount ?? 0,
          },
        },
      ],
    });
  } catch (e) {
    next(e);
  }
});

platformRouter.patch('/companies/:id', async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const scoped = companyScopeForRequest(req);
    if (id !== scoped) {
      return next(new AppError('You can only change the company in your current tenant scope', 403));
    }
    const Body = z.object({ is_active: z.boolean() });
    const { is_active } = Body.parse(req.body ?? {});
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update({ is_active })
      .eq('id', id)
      .select('id, name, is_active')
      .single();
    if (error) throw error;
    if (!data) throw new AppError('Company not found', 404);
    res.json({ company: data });
  } catch (e) {
    next(e);
  }
});

platformRouter.post('/onboard-company', upload.single('logo'), async (req, res, next) => {
  try {
    const Body = z.object({
      companyName: z.string().min(1).max(200),
      country: z.string().max(120).optional().nullable(),
      timezone: z.string().max(120).optional().nullable(),
      currency: z.string().max(32).optional().nullable(),
      adminName: z.string().min(1).max(200),
      adminEmail: z.string().email(),
      adminPassword: z.string().min(8).max(128),
      adminPhone: z.string().max(64).optional().nullable(),
    });
    const parsed = Body.parse(req.body ?? {});

    const file = req.file;
    let logoExt: string | null = null;
    if (file?.originalname?.includes('.')) {
      logoExt = file.originalname.slice(file.originalname.lastIndexOf('.'));
    }

    const result = await onboardNewCompany({
      companyName: parsed.companyName,
      country: parsed.country,
      timezone: parsed.timezone,
      currency: parsed.currency,
      adminName: parsed.adminName,
      adminEmail: parsed.adminEmail,
      adminPassword: parsed.adminPassword,
      adminPhone: parsed.adminPhone,
      logoBuffer: file?.buffer ?? null,
      logoMime: file?.mimetype ?? null,
      logoExt,
    });

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});
