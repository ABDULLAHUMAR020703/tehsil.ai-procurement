import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import { supabaseAdmin } from '../../config/supabase';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const cid = req.auth!.companyId;
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id, type, message, is_read, created_at')
      .eq('company_id', cid)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ notifications: data ?? [] });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/mark-read/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.auth!.userId;
    const cid = req.auth!.companyId;
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('company_id', cid)
      .eq('user_id', userId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

