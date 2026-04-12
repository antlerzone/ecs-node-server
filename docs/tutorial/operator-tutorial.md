# Operator Portal — Step-by-Step Manual

**English · For operators (staff / management)**

This manual explains how to use the **Operator** side of the platform: complete company profile, manage staff and integrations, handle properties and tenancies, issue invoices, manage expenses, process feedback and refunds, sign agreements, and manage billing. Follow the steps in order. Where you see **\[SCREENSHOT: …]**, insert a screenshot of that screen for your own documentation or training.

---

## What you need before you start

- **Staff access**: Your email must be registered as a **staff** member for your company (client) in the system.
- **Login** to the operator site (Wix subdomain or Portal `/operator`, as provided).
- **Permissions**: Your role (admin, profilesetting, usersetting, integration, billing, finance, tenantdetail, propertylisting, marketing, booking) determines which menu items you see. **Admin** has full access.
- A **browser** (Chrome, Safari, or Edge recommended).

---

## Overview: What the Operator can do

| Area | What you can do |
|------|------------------|
| **Company / Profile** | Set company name and details. **Do this first**; until it is done, Admin and Agreement list may be locked. |
| **User Setting** | Add and edit staff; set permissions. The **main account** (company email) cannot be edited. |
| **Integration** | Connect Accounting (Xero/Bukku/AutoCount/SQL), Meter (CNYIOT), Smart Door (TTLock). |
| **Property / Room / Tenancy** | Manage properties, rooms, and tenancies; extend, change room, terminate. |
| **Tenant Invoice** | Create and manage rental invoices; meter groups and usage; top-up. |
| **Expenses** | List expenses; add; mark paid; bulk upload; bank bulk (JomPay). |
| **Admin** | View feedback and refunds; sign operator agreements; process refunds (amount, journal). |
| **Billing / Top-up** | View plan and credit; top up credit; view statements; Stripe or manual for large amounts. |

**Important:**  
- Complete **Company Profile** (company name at least) first. Until then, **Admin** and **Agreement list** may stay disabled.  
- If company **credit** is zero or negative, you may be forced to the **Credit / Top-up** page until you top up.

---

## Part 1 — Log in and open the Operator area

### Step 1.1 — Open the operator login page

**What you do:** Go to your company’s operator URL (Wix subdomain or Portal `/operator`) and open the login or operator entry page.

**What you see:** A login screen (email + password, or SSO, depending on setup).

> ![Operator — Login](./screenshots/operator-01-login.png)
> *Place a screenshot here showing the operator login form.*

---

### Step 1.2 — Log in

**What you do:** Enter your **email** and **password**, then click **Log in**.

**What you see:** After login, you are taken to the operator home. You may land on **Billing** or **Company** (depending on setup). You see a **sidebar or tab menu** with: Profile / Company, User Setting, Integration, Billing, Contact, Property, Room, Booking, Admin, etc. Some items may be greyed out if profile is incomplete or credit is zero.

> ![Operator — Main](./screenshots/operator-02-main.png)
> *Place a screenshot here showing the main operator view with the menu (Company, User Setting, Integration, Billing, Admin, etc.).*

---

## Part 2 — Complete Company Profile (do this first)

### Step 2.1 — Open Company / Profile

**What you do:** Click **Company**, **Company Setting**, or **Profile** (the one that edits company details, not your personal profile).

**What you see:** The Company (or Profile) section. You see fields such as: **Company name** (title), address, contact details, and possibly logo or other settings.

> ![Operator — Company form](./screenshots/operator-03-company-form.png)
> *Place a screenshot here showing the company name field and main company form.*

---

### Step 2.2 — Enter company name and save

**What you do:**  
- Enter or correct the **company name** (required).  
- Fill in address and contact if needed.  
- Click **Save** or **Update**.

**What you see:** A success message. After the company name is saved, **Admin** and **Agreement list** (or equivalent) become available in the menu.

**Tip:** The main account (company email) is set at signup and cannot be changed in User Setting.

> ![Operator — Company saved](./screenshots/operator-04-company-success.png)
> *Place a screenshot here showing the success message or the menu with Admin/Agreement now enabled.*

---

## Part 3 — User Setting (staff)

### Step 3.1 — Open User Setting

**What you do:** Click **User Setting** or **Staff** (or **Team**) in the menu.

**What you see:** A list of **staff** (team members). Each row may show: name, email, role/permissions, and **Edit** or **Delete**. One row may be marked **Main account** or **Company Email** and **cannot be edited**.

> ![Operator — Staff list](./screenshots/operator-05-staff-list.png)
> *Place a screenshot here showing the staff list with at least one row and the main account indicated.*

---

### Step 3.2 — Add a new staff member

**What you do:** Click **New user** or **Add staff**. Fill in **email**, **name**, and **permissions** (e.g. billing, property, admin). Click **Save** or **Create**.

**What you see:** The new staff appears in the list. They can log in with that email (after they set a password or receive an invite, depending on your setup).

**Note:** There may be a **maximum number of users** depending on your plan; if you hit the limit, “New user” may be disabled.

> ![Operator — Add staff form](./screenshots/operator-06-staff-add-form.png)
> *Place a screenshot here showing the “Add staff” or “New user” form.*

---

### Step 3.3 — Edit or remove staff (not main account)

**What you do:** Click **Edit** on a staff row (except the main account). Change name or permissions, then save. Or click **Delete** to remove that staff (if allowed).

**What you see:** Updates are saved; the list refreshes. The **main account** row has no Edit or is disabled.

---

## Part 4 — Integration (Accounting, Meter, Smart Door)

### Step 4.1 — Open Integration

**What you do:** Click **Integration** or **System Integration** (or **Company Setting** → Integration tab).

**What you see:** One or more **integration blocks**: **Accounting** (Xero / Bukku / AutoCount / SQL), **Meter (CNYIOT)**, **Smart Door (TTLock)**. Each may show **Connect** or **Edit** / **Disconnect**.

> ![Operator — Integration](./screenshots/operator-07-integration.png)
> *Place a screenshot here showing the three integration areas and Connect/Edit buttons.*

---

### Step 4.2 — Connect Accounting

**What you do:** Click **Connect** for Accounting. Choose the system (e.g. **Bukku**, **Xero**, **AutoCount**, **SQL**). Enter the credentials (e.g. API key, subdomain, or OAuth) as shown on screen. Save or authorize.

**What you see:** After success, the Accounting block shows **Connected** or **Edit**. You can then use Account Setting to map accounts (if required).

> ![Operator — Accounting connect](./screenshots/operator-08-accounting-connect.png)
> *Place a screenshot here showing the accounting connection form or OAuth redirect.*

---

### Step 4.3 — Meter and Smart Door (optional)

**What you do:**  
- **Meter (CNYIOT):** Often uses a **platform** account; you may only need to ensure properties/rooms have meters linked. If there is a “Connect” or “Edit” for Meter, follow the on-screen steps.  
- **Smart Door (TTLock):** Click **Connect** and enter TTLock credentials (or “Connect to old account” if you already have one). Save.

**What you see:** Meter and Smart Door show as connected (or “Not required” if the platform manages them centrally). You can then manage meters and locks in **Meter Setting** and **Smart Door** pages.

> ![Operator — Meter & Smart Door](./screenshots/operator-09-meter-smartdoor-status.png)
> *Place a screenshot here showing Meter and Smart Door blocks with Connected or Connect button.*

---

## Part 5 — Property, Room, and Tenancy (short guide)

### Step 5.1 — Open Property / Room / Tenancy

**What you do:** From the menu, open **Property** (or **Property Setting**), **Room** (or **Room Setting**), and **Tenancy** (or **Tenancy Setting**) as needed.

**What you see:**  
- **Property:** List of properties; add/edit property; link owner; set address.  
- **Room:** List of rooms per property; add/edit room; set available, link meter/lock.  
- **Tenancy:** List of tenancies (tenant, room, period, rent); **Extend**, **Change room**, **Terminate**; create agreement.

> ![Operator — Tenancy list](./screenshots/operator-10-tenancy-list.png)
> *Place a screenshot here showing the tenancy list and action buttons.*

---

### Step 5.2 — Extend or terminate a tenancy

**What you do:** On the tenancy row, click **Extend** (choose new end date and confirm) or **Terminate** (confirm). For **Change room**, select the new room and follow the wizard.

**What you see:** The tenancy list updates. Extend may create new rental invoices; terminate may trigger refund-deposit flow (see Admin).

---

## Part 6 — Tenant Invoice (rental and meter)

### Step 6.1 — Open Tenant Invoice

**What you do:** Click **Tenant Invoice** or **Invoice** (the page where you manage **rental** invoices and meter billing).

**What you see:** A list or table of **rental collections** (invoices): property, room, tenant, type (e.g. rent, parking), date, amount, paid/unpaid. You may see filters (property, type) and buttons: **Create**, **Edit**, **Delete**, **Meter groups**, **Top-up**.

> ![Operator — Invoice list](./screenshots/operator-11-invoice-list.png)
> *Place a screenshot here showing the invoice list and the Create or Edit actions.*

---

### Step 6.2 — Create or edit an invoice

**What you do:** Click **Create** (or **New invoice**). Select **property**, **room**, **tenant**, **type**, **date**, **amount**. Save. Or click **Edit** on a row to change and save.

**What you see:** The new or updated invoice appears in the list. Unpaid invoices will appear in the tenant’s Payment section for them to pay.

> ![Operator — Invoice form](./screenshots/operator-12-invoice-form.png)
> *Place a screenshot here showing the create/edit invoice form.*

---

### Step 6.3 — Meter groups and top-up

**What you do:** Open **Meter** or **Meter groups** from the same page. View usage; if you support prepaid top-up for tenants, the tenant can top up from their dashboard. You can also run meter reports or adjust groups in **Meter Setting** (separate page).

**What you see:** Meter groups and usage per room/property; links to Meter Setting if available.

---

## Part 7 — Expenses

### Step 7.1 — Open Expenses

**What you do:** Click **Expenses** in the menu.

**What you see:** A list of **expenses** (bills): property, type, supplier, amount, date, paid/unpaid. Filters (property, type, supplier) and buttons: **Add**, **Bulk upload**, **Mark paid**, **Bank bulk** (if you have the add-on).

> ![Operator — Expenses list](./screenshots/operator-13-expenses-list.png)
> *Place a screenshot here showing the expenses list and main buttons.*

---

### Step 7.2 — Add an expense and mark paid

**What you do:** Click **Add** (or **New**). Fill in property, type, supplier, amount, date, description. Save. To mark as paid, select one or more rows and click **Mark paid** (or **Bulk paid**); choose date and payment method, then confirm.

**What you see:** The new expense appears; paid items show as “Paid” or get a checkmark.

> ![Operator — Expense form or Mark paid](./screenshots/operator-14-expense-form-or-mark-paid.png)
> *Place a screenshot here showing the add-expense form or the mark-paid dialog.*

---

### Step 7.3 — Bank bulk (JomPay / bulk transfer)

**What you do:** If **Bank bulk** is available, click it. Select **bank** and **type** (e.g. supplier or owner). Select the items to include. Click **Download** or **Generate**. You get a ZIP with payment files (e.g. JomPay format) and possibly an **errors.txt** for skipped items (e.g. missing reference).

**What you see:** A download starts. Open the ZIP and use the files in your bank’s bulk payment system.

**Tip:** If some rows are missing from the file, check **errors.txt** in the ZIP for reasons (e.g. missing biller code or property reference).

> ![Operator — Bank bulk](./screenshots/operator-15-bank-bulk.png)
> *Place a screenshot here showing the bank bulk options and download button.*

---

## Part 8 — Admin (feedback, refund, agreements)

### Step 8.1 — Open Admin

**What you do:** Click **Admin** or **Admin Dashboard** in the menu.

**What you see:** A combined list of: **Feedback** (from tenants), **Refund** (deposit refunds to process), and **Agreement** (agreements waiting for **operator signature**). A **filter** dropdown may let you show All / Feedback / Refund / Agreement. Each row has a **View** or **Sign** (for agreements) or **View detail** (for feedback/refund).

> ![Operator — Admin list](./screenshots/operator-16-admin-list.png)
> *Place a screenshot here showing the admin list and the filter dropdown.*

---

### Step 8.2 — Handle feedback

**What you do:** Click **View** or **View detail** on a feedback row. You see the tenant’s message, photos, or video. Add a **remark** or **resolution** if the field exists, and mark as **Done** (or similar).

**What you see:** The feedback is updated; you can hide it from the “pending” view or leave it for records.

> ![Operator — Feedback detail](./screenshots/operator-17-feedback-detail.png)
> *Place a screenshot here showing the feedback detail view and Done/Remark.*

---

### Step 8.3 — Process refund (deposit)

**What you do:** Click **View** or **Refund** on a refund row. You see: room, tenant, **refund amount**. You can **edit the amount** (e.g. reduce for deductions) as long as it is ≤ original. Click **Mark as refund** (or **Confirm refund**).

**What you see:** The system records the refund and may create an accounting entry (e.g. journal). The refund row is marked done. If you reduced the amount, the difference may be recorded as forfeit.

**Tip:** Only **Mark as refund** when you have actually paid the tenant; the button triggers the accounting write.

> ![Operator — Refund box](./screenshots/operator-18-refund-box.png)
> *Place a screenshot here showing the refund detail with amount and Mark as refund button.*

---

### Step 8.4 — Sign operator agreement

**What you do:** In the Admin list, set filter to **Agreement** (or find a row labeled “Sign Agreement”). Click **Sign Agreement** or **View detail**. The agreement document opens. Enter your **signature** and click **Sign** or **Agree**.

**What you see:** The agreement is signed by the operator. Status becomes “Signed” or “Completed”. The tenant or owner can then see it as fully executed.

> ![Operator — Agreement signing](./screenshots/operator-19-agreement-signing.png)
> *Place a screenshot here showing the agreement view and operator signature area.*

---

### Step 8.5 — Agreement list (tenancy view)

**What you do:** From the menu, open **Agreement list** or **Tenancy** (the view that shows **tenancies** for the current staff). Select **property** and **status** if there are filters. Click a tenancy row to open its **agreements**; click **Sign** on the agreement that needs your signature.

**What you see:** Same as Step 8.4: agreement document and signature. **Note:** The tenancy list may only show tenancies **you** created (booking) or extended; other staff see their own.

> ![Operator — Tenancy/Agreement list](./screenshots/operator-20-tenancy-agreement-list.png)
> *Place a screenshot here showing the tenancy list and the Sign or open agreement action.*

---

## Part 9 — Billing and Top-up

### Step 9.1 — Open Billing / Credit

**What you do:** Click **Billing** or **Credit** (or **Top-up**) in the menu.

**What you see:** Your **plan** (subscription), **credit balance**, and **statements** (credit in/out). Buttons: **Top-up** (buy more credit), **Export** (statements), and possibly **Pricing plan** (change plan). If balance is zero, you may be forced to this page until you top up.

> ![Operator — Billing/Credit](./screenshots/operator-21-billing-credit.png)
> *Place a screenshot here showing the credit balance and Top-up button.*

---

### Step 9.2 — Top up credit

**What you do:** Click **Top-up**. Choose an amount or package. Click **Pay** or **Checkout**. You are redirected to **Stripe** (or similar). Complete the payment. Return to the platform; balance updates.

**What you see:** After payment, the new credit appears in your balance. If the amount is **very large** (e.g. ≥ 1000), the system may ask you to submit a **manual** request instead of paying online; follow the on-screen message.

> ![Operator — Top-up selection](./screenshots/operator-22-topup-selection.png)
> *Place a screenshot here showing the top-up options and payment button.*

---

### Step 9.3 — View or export statements

**What you do:** On the Billing page, open **Statements** or **Event log**. Optionally set **filter** (e.g. Top-up / Spending) and **sort**. Click **Export** to download an Excel or CSV of the statement.

**What you see:** A list of credit transactions (top-up, spending, expiry). The export file downloads.

---

## Quick reference — Operator

| Step | Action | Where |
|------|--------|--------|
| 1 | Log in | Operator / Portal login |
| 2 | Complete company name (profile) | Company / Profile |
| 3 | Add/edit staff | User Setting |
| 4 | Connect Accounting, Meter, Smart Door | Integration |
| 5 | Manage tenancies (extend, terminate) | Tenancy / Property / Room |
| 6 | Create/edit rental invoices | Tenant Invoice |
| 7 | Add expenses; mark paid; bank bulk | Expenses |
| 8 | Handle feedback; process refund; sign agreements | Admin |
| 9 | Top up credit; view statements | Billing / Credit |

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Admin / Agreement list greyed out | Complete **Company Profile** (company name); refresh and log in again. |
| Forced to Credit page | Company credit is ≤ 0; top up to continue using other features. |
| Cannot edit main account | By design; the company email (main account) cannot be edited in User Setting. |
| New user disabled | Check plan limit for number of users (add-on “Extra User” may be required). |
| Accounting connect fails | Check credentials; ensure redirect URI (Xero) or API key (Bukku/AutoCount/SQL) is correct. |
| Refund “Mark as refund” does nothing | Ensure refund amount ≤ original; check for error message; ensure you have permission. |
| Bank bulk skips some rows | Open **errors.txt** in the downloaded ZIP; fix missing data (e.g. biller code, property reference). |
| Top-up shows “Contact support” | Amount may be above online limit; use the manual form or contact platform support. |

---

*Manual version: 1.0. For the Coliving SaaS Property Management platform. Replace each [SCREENSHOT: …] with a real screenshot of your Operator pages for training or handover.*
