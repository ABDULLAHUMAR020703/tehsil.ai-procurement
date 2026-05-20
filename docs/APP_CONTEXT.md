# Tehsil.ai — Full Application Context

## What This Application Is

This repository is the **Tehsil.ai** full-stack procurement workflow platform (repository folder name may still reflect an older label). The business domain is procurement approvals, exception handling, and budget/PO tracking.

At a high level:

- Frontend: Next.js (App Router) UI for role-based user operations.
- Backend: Express API implementing procurement workflow rules.
- Data/Auth/Storage: Supabase (Postgres + Auth + Storage).

## Repository Structure

- `frontend/` - Next.js application (React + TypeScript + Tailwind + React Query)
- `backend/` - Express TypeScript API with domain modules
- `backend/supabase/schema.sql` - authoritative database schema
- `backend/supabase/seed.sql` - seed data for local/initial setup

## Tech Stack

### Frontend

- Next.js `^16`
- React `^19`
- TypeScript `^5`
- Tailwind CSS `^4`
- `@tanstack/react-query` for async server-state
- `@supabase/supabase-js` for client auth/session interactions

Reference: `frontend/package.json`

### Backend

- Express `^5`
- TypeScript `^5`
- Zod for runtime validation
- `@supabase/supabase-js` for database/auth access via service role
- Multer + PapaParse + XLSX for file upload/import
- Pino + pino-http for logging

Reference: `backend/package.json`

## Runtime Architecture

## Frontend Runtime

- App Router pages under `frontend/app/*`.
- Global providers in `frontend/app/providers.tsx` wire:
  - auth context (`AuthProvider`)
  - React Query (`QueryClientProvider`)
- Session/profile and role context managed in `frontend/features/auth/AuthProvider.tsx`.
- Shared authenticated request helper in `frontend/lib/api.ts`.
- Role-aware layout/navigation in `frontend/components/AppLayout.tsx`.

Primary pages:

- `frontend/app/sign-in/page.tsx`
- `frontend/app/dashboard/page.tsx`
- `frontend/app/po/upload/page.tsx`
- `frontend/app/projects/page.tsx`
- `frontend/app/purchase-requests/page.tsx`
- `frontend/app/approvals/page.tsx`

## Backend Runtime

- App bootstrap in `backend/src/app.ts`:
  - Helmet
  - CORS
  - pino-http logger
  - JSON parser
  - `/health` endpoint
  - `/api` router mount
  - centralized error handler
- API server start in `backend/src/index.ts`.
- Router composition in `backend/src/routes/index.ts`.

Mounted module routes:

- `/api/auth`
- `/api/users`
- `/api/po`
- `/api/projects`
- `/api/purchase-requests`
- `/api/approvals`
- `/api/exceptions`
- `/api/notifications`
- `/api/audit-logs`
- `/api/dashboard`

Reference: `backend/src/routes/index.ts`

## Authentication and Authorization

## Authentication Flow

1. Frontend obtains a Supabase access token.
2. Frontend sends `Authorization: Bearer <token>` to backend.
3. Backend middleware validates token with Supabase auth and resolves user profile.
4. Resolved auth context is attached to `req.auth`.

Reference: `backend/src/middleware/auth.ts`

## RBAC / Roles

Supported roles:

- `admin`
- `pm`
- `team_lead`
- `finance`
- `dept_head`
- `gm`

Approval role order constant:

- `team_lead -> pm -> finance -> gm` (GM stage is conditional by threshold)

References:

- `backend/src/modules/auth/types.ts`
- `backend/src/middleware/rbac.ts`

## Data Model (Supabase Postgres)

Core entities:

- `users`
- `purchase_orders`
- `projects`
- `purchase_requests`
- `approvals`
- `exceptions`
- `notifications`
- `audit_logs`
- `email_outbox`

The application uses SQL files rather than an ORM migration framework.

References:

- `backend/supabase/schema.sql`
- `backend/supabase/seed.sql`

## Business Domain and Workflow

## 1) PO Upload (Admin)

- Admin uploads CSV/XLSX.
- Backend parses and upserts purchase orders into `purchase_orders`.

References:

- `backend/src/modules/po/routes.ts`
- `backend/src/modules/po/service.ts`

## 2) Project Creation

- Project can be created linked to a PO or standalone.
- Missing PO path creates a `no_po` exception and puts project into exception flow.

References:

- `backend/src/modules/projects/routes.ts`
- `backend/src/modules/projects/service.ts`

## 3) Purchase Request Submission

- User submits PR with document upload (stored in Supabase Storage bucket).
- Backend checks against PO remaining value or project budget.
- Over-limit submissions create `over_budget` exception and PR enters exception status.
- Valid submissions enter approval workflow (`pending`).

References:

- `backend/src/modules/purchaseRequests/routes.ts`
- `backend/src/modules/purchaseRequests/service.ts`

## 4) Approvals Engine

- Sequential staged approvals by role.
- GM stage is included only if `amount > HIGH_VALUE_THRESHOLD`.
- Reject at any stage rejects the PR and closes remaining pending approvals.
- Full approval decrements PO remaining value (or project budget) and marks PR approved.

Reference: `backend/src/modules/approvals/engine.ts`

## 5) Exceptions Engine

- `no_po` typically decided by `dept_head` (or privileged roles like `admin`/`gm`).
- `over_budget` typically decided by `finance` (or privileged roles).
- Approved exception can resume workflow; rejected exception terminates the flow path.

References:

- `backend/src/modules/exceptions/routes.ts`
- `backend/src/modules/exceptions/service.ts`

## 6) Notifications and Auditability

- In-app notifications persisted for user-facing events.
- Email currently queued as outbox placeholder (not full SMTP sender in-repo).
- Audit logs capture key lifecycle actions.

References:

- `backend/src/modules/notifications/service.ts`
- `backend/src/modules/auditLogs/service.ts`

## Environment Variables

## Frontend (`frontend/.env`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_BACKEND_BASE_URL`

Reference: `frontend/.env.example`

## Backend (`backend/.env`)

- `NODE_ENV`
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HIGH_VALUE_THRESHOLD`
- `SUPABASE_STORAGE_BUCKET_DOCUMENTS`
- Optional: `CORS_ORIGIN`

Reference: `backend/.env.example`

## Local Development Commands

## Frontend

From `frontend/`:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run typecheck`

## Backend

From `backend/`:

- `npm run dev`
- `npm run build`
- `npm start`
- `npm run typecheck`

## Observed Conventions and Patterns

- Module-oriented backend (`routes.ts` + `service.ts` / `engine.ts`).
- Validation at route boundaries (Zod).
- Uniform error handling via AppError + global error middleware.
- Consistent side effects in domain operations:
  - state mutation
  - audit log write
  - notification enqueue
- Frontend role-sensitive navigation and route-level pages.

## Current Scope Notes

- The active implemented domain is procurement lifecycle management.
- No first-class attendance module/workflow is present in app source.
- Testing setup appears minimal/no dedicated test framework committed; current workflow is mostly manual/runtime verification.

## Suggested Orientation Path For New Contributors

1. Read `backend/supabase/schema.sql` for the domain data model.
2. Read `backend/src/routes/index.ts` to map API modules.
3. Follow `backend/src/modules/purchaseRequests/service.ts` and `backend/src/modules/approvals/engine.ts` for core workflow logic.
4. Open `frontend/features/auth/AuthProvider.tsx` and `frontend/lib/api.ts` to understand auth and API requests.
5. Review role-visible UI via `frontend/components/AppLayout.tsx`.