# Product Documentation

## 1. Comprehensive Product Documentation

### Product overview

- **Product name:** Tehsil.ai (procurement workflow platform).
- **What it is:** A full-stack web application that manages purchase orders (POs), projects, purchase requests (PRs), approvals, exceptions, and audit history.
- **Problem it solves:** Replaces manual, email-based procurement approvals with a structured, role-based workflow that improves budget control, traceability, and decision speed.
- **Target users:**
  - **Admin:** user management, PO import, global oversight.
  - **PM / Department Head / Team Lead:** project and request operations.
  - **Finance / GM:** staged approvals and policy enforcement.
  - **System operators:** reporting, logs, and operational visibility.

### Key features (including latest updates)

- Secure sign-in using Supabase Auth with backend token validation and role-aware access.
- PO ingestion via CSV/XLSX, including PO-line data and remaining balance tracking.
- Project creation with PO-linked and no-PO (exception) paths.
- PR creation with required document upload and budget checks.
- Sequential approval engine with conditional high-value escalation.
- Exception workflows for no-PO and over-budget scenarios.
- Notifications and audit logs for lifecycle actions.
- **Latest updates:**
  - Reports page with date-range filtering for projects and PRs.
  - Bulk PDF download for project and PR print views.
  - Theme support (light/dark mode toggle).
  - Fine-grained user permissions matrix in admin settings.
  - Admin override and force-approve controls for special approval cases.
  - Improved PO-line search and effective remaining balance visibility.

### System architecture (high-level)

- **Frontend (Next.js App Router):**
  - Handles UI, route-level pages, role-based navigation, and authenticated API calls.
- **Backend (Express API):**
  - Exposes domain APIs (`/api/*`) for auth, PO, projects, PRs, approvals, exceptions, permissions, notifications, dashboard, and audit logs.
- **Data/Auth/Storage (Supabase):**
  - Postgres for core entities, Auth for identity/session, Storage for PR documents.
- **Flow summary:**
  - User authenticates -> frontend sends bearer token -> backend validates token and role -> business logic executes -> database updates + notifications + audit events.

### Technology stack (with reasons)

- **Next.js + React + TypeScript (frontend):** modern component model, server/client routing, and strong type safety.
- **Express + TypeScript (backend):** simple, modular API layer suitable for domain-driven route/service structure.
- **Supabase (Postgres + Auth + Storage):** unified managed platform for relational data, authentication, and document storage.
- **React Query:** efficient server-state fetching, caching, and mutation invalidation.
- **Zod:** runtime payload validation to reduce invalid API input risk.
- **Multer + PapaParse + XLSX:** reliable multi-format PO import pipeline.
- **Pino / pino-http:** fast structured logging for operations and debugging.

### Core modules (brief explanation)

- **Auth module:** validates JWTs, resolves user profile/role, and provides current user context.
- **Users & Permissions modules:** user administration and fine-grained capability control beyond base roles.
- **PO module:** PO upload/import, PO-line search, and transaction-aware balance support.
- **Projects module:** project lifecycle management, PO linkage, team lead assignment, and exception-aware status handling.
- **Purchase Requests module:** PR submission, file attachment handling, duplicate detection, and budget pre-checks.
- **Approvals module:** staged decision engine, escalation, admin override/force paths, and final budget application.
- **Exceptions module:** handles no-PO and over-budget rule deviations with governed decisioning.
- **Dashboard/Reports module:** operational snapshots, date-filtered views, and print/export actions.
- **Notifications module:** in-app alerts and email-outbox style event preparation.
- **Audit Logs module:** immutable trace of key actions for compliance and accountability.

### AI/logic (if applicable)

- The product does **not** use a machine-learning model in core flow.
- It uses **deterministic business logic**:
  - Role- and department-scoped authorization.
  - Ordered approval-stage rules with conditional escalation.
  - Budget and PO-line remaining validations.
  - Exception routing based on policy conditions.
  - Duplicate-request awareness to assist approvers.
- Outcome: predictable, auditable decisions aligned with procurement policy.

## 2. Detailed Use Cases

### Use Case 1: Upload purchase orders

- **Title:** PO Data Onboarding
- **Actor:** Admin
- **Description:** Admin imports latest procurement source data so teams can create PO-linked projects and requests.
- **Step-by-step flow:**
  1. Admin signs in.
  2. Opens PO upload page.
  3. Uploads CSV/XLSX file with PO details.
  4. Backend parses, validates, and upserts PO records.
  5. System stores total and remaining values for spending control.
- **Expected outcome:** POs become available for project linkage and budget-backed workflows.

### Use Case 2: Create a PO-linked project

- **Title:** Controlled Project Setup
- **Actor:** PM / Admin
- **Description:** A project is created against an existing PO to enable controlled procurement spending.
- **Step-by-step flow:**
  1. User opens Projects page.
  2. Creates a new project and selects a linked PO.
  3. Assigns team lead / ownership metadata as needed.
  4. Backend validates access and stores project.
  5. Project appears in active lists and can receive PRs.
- **Expected outcome:** Project is ready for PR creation with PO-governed budget tracking.

### Use Case 3: Submit a purchase request with document

- **Title:** PR Submission
- **Actor:** Team Lead / PM / Admin
- **Description:** A requester submits a PR with financial and item context for approval.
- **Step-by-step flow:**
  1. User opens Purchase Requests page.
  2. Selects project and (where applicable) PO line.
  3. Enters description, amount, and supporting document.
  4. Backend validates project status, budget, and request constraints.
  5. System creates PR and initializes approval flow (or exception path if needed).
- **Expected outcome:** PR enters a trackable state (`pending` or `pending_exception`) with full auditability.

### Use Case 4: Approve a standard request

- **Title:** Multi-Stage Approval Processing
- **Actor:** Team Lead -> PM -> Finance (and GM when threshold applies)
- **Description:** Approvers process PRs in sequence according to policy.
- **Step-by-step flow:**
  1. Approver opens Approvals page.
  2. Reviews assigned PR details and supporting document.
  3. Approves or rejects with optional comments.
  4. System moves to next stage or rejects/cascades closure.
  5. On final approval, backend finalizes budget deduction atomically.
- **Expected outcome:** PR ends as approved (with budget applied) or rejected with traceable reason.

### Use Case 5: Handle exceptions (no PO / over budget)

- **Title:** Policy Exception Governance
- **Actor:** Department Head / Finance / Admin (depending on exception type)
- **Description:** Exception requests are reviewed when normal policy conditions are not met.
- **Step-by-step flow:**
  1. System flags request/project as exception (`no_po` or `over_budget`).
  2. Assigned authority receives pending exception item.
  3. Authority reviews context and decides approve/reject.
  4. System updates workflow path and records audit entries.
  5. Notifications are sent to relevant users.
- **Expected outcome:** Exception is resolved with controlled continuation or termination of procurement flow.

### Use Case 6: Generate reports and bulk documents

- **Title:** Operational Reporting and Bulk Export
- **Actor:** Admin / PM
- **Description:** User filters operational data and exports project/PR PDFs for review, meetings, or records.
- **Step-by-step flow:**
  1. User opens Reports page.
  2. Applies date range filters.
  3. Selects all or specific projects/PRs.
  4. Triggers single or bulk PDF generation.
  5. Uses generated documents for approvals, archives, or communication.
- **Expected outcome:** Stakeholders receive concise, shareable procurement snapshots with current status and budget context.

### Use Case 7: Manage fine-grained user permissions

- **Title:** Access Governance Beyond Roles
- **Actor:** Admin
- **Description:** Admin adjusts user capabilities at permission level without changing base role definitions.
- **Step-by-step flow:**
  1. Admin opens Settings > User Permissions.
  2. Reviews permission matrix by user.
  3. Toggles required permissions.
  4. Saves changes.
  5. System persists effective permissions and refreshes access behavior.
- **Expected outcome:** Access controls match operational responsibilities while preserving security boundaries.

