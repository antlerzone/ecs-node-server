# Rental Collection → Credit Invoice

When rentalcollection rows are created (e.g. tenant approve → `generateFromTenancyByTenancyId`), if the client has **pricing plan + accounting integration**, we create a **credit invoice** per row (due date = `billing_json` item date) and write back **invoiceid** + **invoiceurl** to `rentalcollection` for payment tracking.

## Contact rules

- **Owner commission** (`type_id` = owner commission account): invoice **to owner** (property’s ownerdetail).
- **All other items** (rent, deposit, **forfeit deposit**, agreement fees, etc.): invoice **to tenant** (tenantdetail). Forfeit deposit is a credit invoice to tenant (tenancy setting → terminate).

Contact is ensured in the accounting system (find or create) and the contact id is written to `ownerdetail.account` / `tenantdetail.account`.

## Invoice ID + URL by platform

| Platform   | Invoice ID                         | Invoice URL |
|-----------|-------------------------------------|-------------|
| **Bukku** | ✅ Create response `id`             | ✅ Built: `https://{subdomain}.bukku.my/invoices/{id}` |
| **Xero**  | ✅ Create response `InvoiceID`      | ✅ From `GET /Invoices/{id}/OnlineInvoice` → `OnlineInvoiceUrl` |
| **AutoCount** | ✅ Create response `docNo`      | ❌ Not provided by API; we store `invoiceid` only |
| **SQL**   | ✅ Create response `id` / `DocNo`   | ❌ Depends on API; we store `invoiceid` only |

All four return an **invoice id** (for payment tracking and e-invoice). **URL** is returned or built for Bukku and Xero; AutoCount and SQL may not expose a shareable URL in the same way.

## Where rentalcollection is written

1. **Booking:** `tenancy.billing_json` → `generateFromTenancy` / `generateFromTenancyByTenancyId` (booking.service.js) → **credit invoice**.
2. **Tenancy setting:** extend, change room, terminate (forfeit deposit) (tenancysetting.service.js) → **credit invoice**.
3. **Tenant invoice (manual):** `insertRentalRecords` (tenantinvoice.service.js) → **credit invoice**.
4. **Tenant dashboard – meter topup (#buttontopupmeter):** 写入 **metertransaction**（不是 rentalcollection）。create-payment 时先 INSERT metertransaction（status='pending', ispaid=0），metadata 带 `meter_transaction_id`；Stripe webhook `checkout.session.completed`、`metadata.type === 'TenantMeter'` → 更新该笔 metertransaction（ispaid=1, status='success'），若 client 有 plan+集成则开 **cash invoice** 并写回 metertransaction 的 `invoiceid` / `invoiceurl`。

**Rule:** (1)(2)(3) 若有 **pricing plan + 会计集成**，插入后调用 `createInvoicesForRentalRecords` 开 **credit** 并回写。(4) webhook 内调用 `handleTenantMeterPaymentSuccess` 更新 **metertransaction** 并开 **cash** 写回 metertransaction。

## Receipt when ispaid = true

当 Stripe webhook（TenantInvoice）将 rentalcollection 更新为 **ispaid = 1**（并写入 paidat、referenceid）后，对每条有 **invoiceid** 的记录在会计系统里 **开 receipt**（收款/冲账）：Xero = Payment 冲 Invoice；Bukku = Sales Payment（link_items 冲 invoice）；AutoCount/SQL = createReceipt。由 `createReceiptForPaidRentalCollection(ids)` 在 webhook 内调用，失败只打 log 不令 webhook 失败。

## Invoice line item description（一张单一个 item）

一个 rentalcollection 或一个 metertransaction = **一张 invoice、一个 line item**。该 item 的 **description** 统一为：

- **type title**、**room name**、**tenant name**、**date**（payment/due），四段用 **换行** 分隔（不拼成一行）。

四家会计系统都支持写入 line item description：Bukku `form_items[].description`，Xero `LineItems[].Description`，AutoCount `details[].description`，SQL `description`。

## Flow

1. One of the three sources above inserts `rentalcollection` rows.
2. After insert we call `createInvoicesForRentalRecords(clientId, records)`:
   - Resolve client accounting (plan + addonAccount).
   - For each record: get account mapping (`type_id` → accountid/productId), get contact (owner or tenant), create credit invoice with due date = `record.date`, then `UPDATE rentalcollection SET invoiceid = ?, invoiceurl = ?, bukku_invoice_id = ?`.

## Commission in accounting (debit / credit)

When we **create a credit invoice** for a rental collection item (including commission), the accounting system records:

| When | Debit | Credit |
|------|--------|--------|
| **Invoice created** | Accounts receivable (tenant or owner, by contact) | **Commission income** — account from Account Setting mapping for this `type_id` (Tenant Commission / Owner Commission) |
| **Payment received** | Cash/Bank | Accounts receivable |

- **Tenant commission**: Invoice **to tenant**. Dr Tenant receivable, Cr **Tenant Commission Income** (account mapped in Company → Account Setting for “Tenant Commission”).
- **Owner commission**: Invoice **to owner**. Dr Owner receivable, Cr **Owner Commission Income** (account mapped for “Owner Commission”).

The `accountId` we pass to `createCreditInvoice` (from `getAccountMapping(clientId, type_id, provider)`) is the **revenue account** = **Credit** side. The **Debit** (receivable) is implied by the contact in Bukku/Xero/AutoCount/SQL when the invoice is created.

## Dependencies

- `client_pricingplan_detail` (plan allows accounting)
- `client_integration` (addonAccount, provider = bukku|xero|autocount|sql)
- `account_client` or `account.account_json` (type_id → accountid, productId per provider)
- `propertydetail.owner_id` → ownerdetail (for owner-commission contact)
- `tenantdetail` (for tenant contact)
