# 🚀 Tehsil.ai — Procurement Walkthrough Guide

This guide explains how to use the Tehsil.ai procurement workflow step by step, including roles, actions, and flow of data.

---

# 🧑‍💻 USER ROLES

The system supports the following roles:

| Role                     | Description                              |
| ------------------------ | ---------------------------------------- |
| **super_admin**          | Full access (creates users, uploads POs) |
| **manager (PM)**         | Creates projects and manages budgets     |
| **employee (Team Lead)** | Creates purchase requests                |
| **finance**              | Approves financial requests              |

---

# 🔑 LOGIN CREDENTIALS (Demo)

Use these test users:

| Role        | Email                                                             | Password            |
| ----------- | ----------------------------------------------------------------- | ------------------- |
| Super Admin | [hammad.bakhtiar@hadir.ai](mailto:hammad.bakhtiar@hadir.ai)       | hammadbakhtiar123   |
| PM          | [abdullah.bin.ali@hadir.ai](mailto:abdullah.bin.ali@hadir.ai)     | abdullahbinali123   |
| Team Lead   | [hasnain.ibrar@hadir.ai](mailto:hasnain.ibrar@hadir.ai)           | hasnainibrar123     |
| Finance     | [balaj.nadeem.kiani@hadir.ai](mailto:balaj.nadeem.kiani@hadir.ai) | balajnadeemkiani123 |

---

# 🧭 COMPLETE APP FLOW

---

## 🟣 STEP 1: Super Admin Uploads PO

### Login as:

➡️ **Super Admin**

### Action:

1. Go to **PO Upload**
2. Upload CSV file with columns:

   * po_number
   * vendor
   * total_value

### Result:

* PO records are created
* Each PO has:

  * total_value
  * remaining_value (initially same)

---

## 🔵 STEP 2: PM Creates Project

### Login as:

➡️ **Manager (PM)**

### Action:

1. Go to **Create Project**
2. Enter:

   * Project Name
   * Select PO
   * Budget

### Rules:

* Budget must be ≤ PO remaining_value
* Budget reduces PO remaining_value

### Result:

* Project created
* Budget allocated from PO

---

## 🟢 STEP 3: Team Lead Creates Purchase Request

### Login as:

➡️ **Team Lead**

### Action:

1. Go to **Purchase Requests**
2. Create new request:

   * Select Project
   * Enter Amount
   * Upload Document (invoice/receipt)

### Rules:

* Amount ≤ Project budget → Normal flow
* Amount > Project budget → Exception triggered

---

## 🟡 STEP 4: Approval Workflow

### Flow:

1. Team Lead → PM → Finance

### Status:

* pending
* approved
* rejected

---

### If NORMAL request:

➡️ Goes through approval chain

### If OVER-BUDGET:

➡️ Goes to **Exception Flow**

---

## 🔴 STEP 5: Exception Handling

Triggered when:

* No PO
* Over budget

### Result:

* Status: `pending_exception`
* Requires higher-level approval

---

## 🟠 STEP 6: Finance Approval

### Login as:

➡️ **Finance**

### Action:

* Approve or reject requests

### Result:

* Final approval completes request

---

# 📊 DASHBOARD

Each user sees:

* Total Projects
* Pending Approvals
* Pending Exceptions
* PO Records

---

# 📁 DOCUMENT UPLOAD

Used for:

* Purchase Requests
* Proof (invoice, receipt, etc.)

---

# ⚙️ IMPORTANT LOGIC

### Budget Flow

PO → Project → Purchase Request

### Deduction:

* Project reduces PO remaining_value
* Approved PR reduces Project budget

---

# ❗ ERROR HANDLING

| Scenario      | Behavior            |
| ------------- | ------------------- |
| No token      | 401 Unauthorized    |
| Invalid route | 404                 |
| Over budget   | Exception triggered |
| Missing PO    | Exception triggered |

---

# 🧪 TESTING SCENARIO (Recommended Demo)

1. Login as Super Admin → Upload PO
2. Login as PM → Create Project
3. Login as Team Lead → Create PR
4. Login as Finance → Approve PR
5. View Dashboard updates

---

# 🎯 SUMMARY

This system simulates a real-world procurement pipeline:

* Budget control
* Approval hierarchy
* Exception handling
* Role-based access

---

# 🔥 YOU'RE DONE

If all steps work → your system is fully functional 🚀
