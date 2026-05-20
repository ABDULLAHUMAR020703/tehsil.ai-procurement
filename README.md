# Tehsil.ai — Application Flow

This document describes **how people move through the app**: who signs in, how purchase orders (POs) get into the system, how projects and purchase requests work, and how approvals run.

---

## Stack (short)

- **Frontend**: Next.js (e.g. on Vercel). Users sign in with **Supabase Auth** (email/password).
- **Backend**: Express API (e.g. on Render). Validates each request with the **Supabase JWT** and loads the user’s **role** from the `public.users` table.
- **Data**: Supabase (Postgres) for `users`, `purchase_orders`, `projects`, `purchase_requests`, `approvals`, `exceptions`, etc.

A user must exist in **both** Supabase Auth **and** `public.users` with a matching `id` and a defined **role** so the backend can authorize actions.

---

## 1. Signing in

1. User opens the app and goes to **`/login`**.
2. They enter email and password; the client calls **Supabase** (`signInWithPassword`).
3. The app then calls **`GET /api/auth/me`** with `Authorization: Bearer <access_token>` so the **backend** can attach **role**, **department**, and profile fields from `users`.
4. After a successful session, the user is sent to **`/dashboard`** (or can use the sidebar to open other pages).

**If there is no session**, protected API calls are not made (or the app can redirect back to login).

---

## 2. Roles and what they usually do

Roles drive **who sees which menu items** and **who can call which APIs**. Typical responsibilities:

| Role (concept) | Common responsibilities |
|----------------|-------------------------|
| **Admin** | Loads POs into the system (CSV/XLSX upload), full visibility for some lists. |
| **PM / Team lead** | Creates projects (within rules), submits **purchase requests (PRs)** with documents. |
| **Finance** | One of the stages in the **PR approval chain**. |
| **Department head** | Handles **exceptions** (e.g. project created **without** a PO). |
| **GM** | Extra approval stage for **high-value** PRs (above a configured threshold). |

The UI sidebar hides links if the user’s role is not allowed for that area (e.g. **PO Upload** is limited to admin-type roles).

---

## 3. End-to-end “happy path” (PO → project → PR → approvals)

### Step A — Put POs in the system (Admin)

1. An **admin** user opens **`/po/upload`**.
2. They upload a file (**CSV or Excel**) whose rows include PO data (e.g. **po_number**, **vendor**, **total_value** — as expected by the parser).
3. The backend **upserts** rows into **`public.purchase_orders`**. Each PO has **total_value** and **remaining_value** (initially aligned with total; later, spend reduces **remaining_value**).

Until POs exist (or a special “no PO” path is used), projects that depend on a PO cannot draw budget from a real PO record.

### Step B — Create a project (Admin / PM / Team lead)

1. User opens **`/projects`**.
2. They create a project in one of two ways:
   - **With a PO**: choose a PO. Budget for the project is tied to that PO’s **remaining** value.
   - **Without a PO**: enter a budget; the project goes into an **exception** state and must be cleared by **department head** workflow (see section 5) before normal PR submission works as intended.

### Step C — Submit a purchase request (Admin / PM / Team lead)

1. User opens **`/purchase-requests`**.
2. They pick an **active** project, enter **description** and **amount**, attach a **document** (required).
3. The backend validates **budget** (e.g. against PO remaining or project budget), stores the file (e.g. Supabase Storage), and creates a row in **`purchase_requests`**.
4. The system starts an **approval workflow**: approval rows are created in **`approvals`** for the right **sequence** of roles.

### Step D — Approve or reject (Approvers)

1. Users who are **approvers** open **`/approvals`**.
2. They see items assigned to them (by role / rules in the backend).
3. For each PR, they **approve** or **reject** (optional comments). The engine moves the workflow forward or stops it; notifications/audit hooks can run as implemented.

**Approval order (conceptual):**  
**Team lead → PM → Finance**; if the PR **amount** is above the configured **high-value threshold**, a **GM** stage is included. Exact assignment uses users in the **same department** when possible, with fallbacks.

### Step E — Outcome

- If all required stages **approve**, the PR reaches an **approved** state (and related budget/PO logic is updated as coded in the services).
- A **rejection** stops that PR’s happy path; details follow the rules in the approval engine.

---

## 4. Dashboard

**`GET /api/dashboard`** (authenticated) returns **counts** such as:

- Projects  
- Pending approvals  
- Pending exceptions  
- PO records  

The **Dashboard** page shows these totals so users get a quick snapshot of workload.

---

## 5. “No PO” exception flow

If someone creates a project **without** linking a PO:

1. The project is created in an **exception-related** status and a **`no_po`** row is created in **`exceptions`** (pending).
2. A **department head** (per department resolution rules) is notified to **approve or reject** the exception.
3. Until that exception is handled appropriately, the project is **not** a normal “active” spend path for PRs in the same way as PO-backed projects.

This protects the business rule: spending should either be tied to a **loaded PO** or explicitly **exception-approved**.

---

## 6. Where to look in the code

| Topic | Location |
|-------|-----------|
| Login / session | `frontend/app/login`, `frontend/features/auth/AuthProvider.tsx` |
| API calls with JWT | `frontend/lib/api.ts` |
| Nav by role | `frontend/components/AppLayout.tsx` |
| PO upload | `backend/src/modules/po/routes.ts`, `frontend/app/po/upload` |
| Projects | `backend/src/modules/projects/` |
| Purchase requests | `backend/src/modules/purchaseRequests/` |
| Approval sequence & decisions | `backend/src/modules/approvals/engine.ts` |
| Dashboard counts | `backend/src/modules/dashboard/routes.ts` |
| Supabase migration | `backend/supabase/migrations/20260520_consolidated_production_hardening.sql` |
| Sample PO upload files | `docs/samples/` |
| Product / workflow docs | `docs/` |

---

## 7. Configuration note (high-value approvals)

The **GM** approval stage appears when a PR **amount** is greater than **`HIGH_VALUE_THRESHOLD`** in backend environment config (see `backend/src/config/env.ts` and `backend/src/modules/approvals/engine.ts`).

---

This README is a **flow-oriented** guide. For deploy URLs, env vars, and developer setup, add a separate “Development & deployment” section as needed.
