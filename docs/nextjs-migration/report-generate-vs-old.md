# Generate Report 页面对比（新 Next  vs 旧 Wix）

## 1. 生成 report 后会不会开 cash bills / cash invoice / credit invoice / credit bills？

**不会。** 与旧代码一致。

- **Generate Report（生成报告）**：只做两件事  
  - 写入 `ownerpayout` 表  
  - 生成 PDF 并上传（Generate 按钮会写 URL 到 `monthlyreport`）  
- **不会**在生成时创建任何会计单据（不创建 cash/credit invoice 或 bills）。

**会计单据是在 Mark as Paid 时创建的**（见下）。

---

## 2. Mark as Paid 时会不会把 date 更新到会计系统？

**会。** 与旧代码一致，且按 operator 使用的系统（Bukku / Xero / MySQL / AutoCount）写入。

流程：

1. 前端：用户选 **Payment method**（Bank/Cash）和 **Payment date**，点「Mark as Paid」。
2. 后端：`updateOwnerReport` / `bulkUpdateOwnerReport` 收到 `paid: true`、`paymentDate`、`paymentMethod`。
3. 后端在 `generatereport.service.js` 里若 `paid === true` 且带 `paymentDate`、`paymentMethod`，会调用  
   `createAccountingForOwnerPayout(clientId, payoutId, { paymentDate, paymentMethod })`。
4. `generatereport-accounting.service.js` 中：
   - 用 `resolveClientAccounting(clientId)` 解析当前 client 的会计系统（**Bukku / Xero / AutoCount / SQL**）。
   - 用**同一个 payment date** 在会计系统里创建：
     - **Cash Invoice**：Management Fee（管理费，operator 向 owner 收），`date: paymentDate`。
     - **Cash Bill (Purchase)**：Owner Payout（出给屋主的钱），`date: paymentDate`。
   - 各 provider 的 wrapper（`createCashInvoice`、`createCashPurchaseOne`）都会把 `date` 传给 API，所以 **payment date 会写到会计系统**。

因此：**Mark as Paid 会按所选日期，在 operator 使用的会计系统里创建 cash invoice + cash bill，并带上该 date。**

创建成功后，会把 **Invoice URL**（management fee）和 **Bills URL**（payout）写回 `ownerpayout.bukkuinvoice`、`ownerpayout.bukkubills`（Bukku 会写两条；Xero 等目前只写 invoice URL，bill URL 视 provider 支持再扩展），这样 Report 页的「Invoice / Bills」链接在 Mark as Paid 后即可使用。

---

## 3. 当前实现里创建的是哪些单据？

| 单据类型 | 含义 | 是否创建 |
|----------|------|----------|
| **Cash Invoice** | Management fees（operator 向 owner 收的管理费） | ✅ Mark as Paid 时创建 |
| **Cash Bill (Purchase)** | Owner payout（出给屋主的钱） | ✅ Mark as Paid 时创建 |
| Credit Invoice | 本流程未使用 | ❌ 不创建 |
| Credit Bill | 本流程未使用 | ❌ 不创建 |

与旧 Wix 行为一致：只开 **cash invoice** 和 **cash bill**，不开 credit invoice / credit bills。

---

## 4. 相关代码位置

- 前端 Mark as Paid：`docs/nextjs-migration/app/operator/report/page.tsx`（`handleSubmitPay` → `updateOwnerReport` / `bulkUpdateOwnerReport`）。
- 后端更新 + 触发会计：`src/modules/generatereport/generatereport.service.js`（`updateOwnerReport` / `bulkUpdateOwnerReport` 内调 `createAccountingForOwnerPayout`）。
- 会计创建逻辑：`src/modules/generatereport/generatereport-accounting.service.js`（`createAccountingForOwnerPayout`：cash invoice + cash bill，使用 `paymentDate`）。
- 会计解析与按 provider 创建：`rentalcollection-invoice.service.js`（`createCashInvoice`、`resolveClientAccounting`）、`expenses-purchase.service.js`（`createCashPurchaseOne`）。
