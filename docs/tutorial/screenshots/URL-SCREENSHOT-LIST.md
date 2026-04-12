# URLs to Screenshot for Tutorial

Use **demo.colivingjb.com** (no backend; has sample data). After login, pick **Owner**, **Tenant**, or **Operator** and go to each URL below. Save each screenshot with the filename in the right column into **`docs/tutorial/screenshots/`**.

Base URL: **https://demo.colivingjb.com** (or your portal domain).

---

## Owner Portal

| # | URL (path) | Full URL | Save as |
|---|------------|----------|---------|
| 1 | Login (before choosing role) | `/` then select Owner | `login.png` or `owner.login.png` |
| 2 | Owner dashboard (after login) | `/owner` | `portal.png` or `owner.png` |
| 3 | Profile | `/owner/profile` | `owner.profile.png` |
| 4 | My Properties | `/owner/properties` | `owner.properties.png` |
| 5 | My Agreement | `/owner/agreement` | `owner.agreement.png` |
| 6 | My Report | `/owner/report` | `owner.report.png` |
| 7 | Cost | `/owner/cost` | `owner.cost.png` |
| 8 | Approvals | `/owner/approval` | `owner.approval.png` |
| 9 | Smart Door | `/owner/smart-door` | `owner.smart.door.png` |

---

## Tenant Dashboard

| # | URL (path) | Full URL | Save as |
|---|------------|----------|---------|
| 1 | Login | `/` then select Tenant | `tenant-01-login.png` |
| 2 | Main dashboard | `/tenant` or `/tenant/dashboard` | `tenant-02-main.png` |
| 3 | Profile form | `/tenant/profile` | `tenant-03-profile-form.png` |
| 4 | Profile (bank + NRIC) | `/tenant/profile` (scrolled) | `tenant-04-profile-bank-nric.png` |
| 5 | Profile save success | After Save on profile | `tenant-05-profile-success.png` |
| 6 | Approve operator | Main screen “Approve” card | `tenant-06-approve-operator.png` |
| 7 | Agreement list | `/tenant/agreement` | `tenant-07-agreement-list.png` |
| 8 | Agreement document | Agreement detail / sign view | `tenant-08-agreement-document.png` |
| 9 | Agreement signed | After signing | `tenant-09-agreement-signed.png` |
| 10 | Property dropdown | Main + Meter/Door/Payment | `tenant-10-property-dropdown.png` |
| 11 | Meter section | `/tenant/meter` or meter area | `tenant-11-meter-section.png` |
| 12 | Meter top-up | Top-up flow | `tenant-12-meter-topup.png` |
| 13 | Smart Door section | `/tenant/smart-door` or door area | `tenant-13-smartdoor-section.png` |
| 14 | Smart Door opening | “Opening…” / “Door open” | `tenant-14-smartdoor-opening.png` |
| 15 | Payment list | `/tenant/payment` or invoices | `tenant-15-payment-list.png` |
| 16 | Payment paid | After Pay now success | `tenant-16-payment-paid.png` |
| 17 | Feedback form | `/tenant/feedback` | `tenant-17-feedback-form.png` |
| 18 | Feedback success | After Submit | `tenant-18-feedback-success.png` |

---

## Operator (Staff) Portal

| # | URL (path) | Full URL | Save as |
|---|------------|----------|---------|
| 1 | Login | `/operator` or `/` then Operator | `operator-01-login.png` |
| 2 | Main / dashboard | `/operator` (after login) | `operator-02-main.png` |
| 3 | Company form | `/operator/company` or Company Setting | `operator-03-company-form.png` |
| 4 | Company save success | After Save company | `operator-04-company-success.png` |
| 5 | Staff list | `/operator/users` or User Setting | `operator-05-staff-list.png` |
| 6 | Add staff form | New user / Add staff | `operator-06-staff-add-form.png` |
| 7 | Integration | `/operator/integration` | `operator-07-integration.png` |
| 8 | Accounting connect | Accounting Connect form | `operator-08-accounting-connect.png` |
| 9 | Meter & Smart Door status | Integration (Meter/Door) | `operator-09-meter-smartdoor-status.png` |
| 10 | Tenancy list | `/operator/tenancy` or Tenancy | `operator-10-tenancy-list.png` |
| 11 | Invoice list | `/operator/invoice` or Tenant Invoice | `operator-11-invoice-list.png` |
| 12 | Invoice form | New / Edit invoice | `operator-12-invoice-form.png` |
| 13 | Expenses list | `/operator/expenses` | `operator-13-expenses-list.png` |
| 14 | Expense form / Mark paid | Add expense or Mark paid | `operator-14-expense-form-or-mark-paid.png` |
| 15 | Bank bulk | Bank bulk transfer | `operator-15-bank-bulk.png` |
| 16 | Admin list | `/operator/admin` (Feedback, Refund, Agreement) | `operator-16-admin-list.png` |
| 17 | Feedback detail | One feedback open | `operator-17-feedback-detail.png` |
| 18 | Refund | Refund section / box | `operator-18-refund-box.png` |
| 19 | Agreement signing | Contract + sign area | `operator-19-agreement-signing.png` |
| 20 | Tenancy/Agreement list | Agreement list with Sign | `operator-20-tenancy-agreement-list.png` |
| 21 | Billing / Credit | `/operator/billing` or Credit | `operator-21-billing-credit.png` |
| 22 | Top-up selection | Top-up amount + Pay | `operator-22-topup-selection.png` |

---

## After saving

1. Put all files in **`docs/tutorial/screenshots/`**.
2. Run **`npm run tutorial:copy-screenshots`** from project root to copy into the Next.js app (Owner: `owner.login.png`→`login.png`, `owner.png`→`portal.png`; Tenant/Operator: same filenames).
3. Open **portal.colivingjb.com/tutorial** to confirm images show.
