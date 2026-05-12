import { Router } from 'express';
import { authRouter } from '../modules/auth/routes';
import { usersRouter } from '../modules/users/routes';
import { poRouter } from '../modules/po/routes';
import { departmentsRouter } from '../modules/departments/routes';
import { projectsRouter } from '../modules/projects/routes';
import { purchaseRequestsRouter } from '../modules/purchaseRequests/routes';
import { approvalsRouter } from '../modules/approvals/routes';
import { exceptionsRouter } from '../modules/exceptions/routes';
import { notificationsRouter } from '../modules/notifications/routes';
import { auditLogsRouter } from '../modules/auditLogs/routes';
import { dashboardRouter } from '../modules/dashboard/routes';
import { permissionsRouter } from '../modules/permissions/routes';
import { platformRouter } from '../modules/platform/routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/departments', departmentsRouter);
apiRouter.use('/po', poRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/purchase-requests', purchaseRequestsRouter);
apiRouter.use('/approvals', approvalsRouter);
apiRouter.use('/exceptions', exceptionsRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/audit-logs', auditLogsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/permissions', permissionsRouter);
apiRouter.use('/platform', platformRouter);

