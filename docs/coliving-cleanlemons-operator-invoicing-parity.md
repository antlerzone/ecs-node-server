# Coliving operator invoice ↔ Cleanlemons operator invoices（流程对齐说明）

两产品**对接 Bukku / Xero 的流程一致**（开销售单、收款/收据、void payment、删/void 单、打开查看链接），但 **MySQL 表与 account / contact 来源完全分开**，禁止混读 Coliving 业务表与 `cln_*`。

## 1. 数据边界（必读）

| 数据 | Coliving | Cleanlemons |
|------|----------|---------------|
| 会计连接（provider、token、subdomain 等） | `client_integration` 等 Coliving 表 | `cln_operator_integration`（如 `key = 'addonAccount'`） |
| 科目 / 产品外部 id（`account_id`、`product_id` 映射） | Coliving `account` / mapping 链 | `cln_account` + `cln_account_client`（`operator_id` + `system` = bukku/xero） |
| 客户 / 租客在 Bukku 的 contact | Coliving 侧 contact 模型 | `cln_clientdetail.account` JSON 或 `cln_client_operator.crm_json` |
| 业务发票主表 | `rentalcollection` 等 | `cln_client_invoice`、`cln_client_payment` |

**共用**：仅 HTTP 层 — [`src/modules/bukku/wrappers/`](../src/modules/bukku/wrappers/)、[`src/modules/xero/wrappers/`](../src/modules/xero/wrappers/)（及 Joi 校验等）。谁开单谁查**自己**的表拼 payload。

## 2. 路由与编排对照

| 能力 | Coliving | Cleanlemons |
|------|----------|-------------|
| UI | [`coliving/next-app/app/operator/invoice/page.tsx`](../coliving/next-app/app/operator/invoice/page.tsx) | [`cleanlemon/next-app/app/portal/operator/invoices/page.tsx`](../cleanlemon/next-app/app/portal/operator/invoices/page.tsx) |
| API 前缀 | `/api/tenantinvoice/*` — [`tenantinvoice.routes.js`](../src/modules/tenantinvoice/tenantinvoice.routes.js) | `/api/cleanlemon/operator/invoices*` — [`cleanlemon.routes.js`](../src/modules/cleanlemon/cleanlemon.routes.js) |
| 会计编排 | [`rentalcollection-invoice.service.js`](../src/modules/rentalcollection-invoice/rentalcollection-invoice.service.js)（如 `createCreditInvoice`） | [`cleanlemon-operator-invoice-accounting.service.js`](../src/modules/cleanlemon/cleanlemon-operator-invoice-accounting.service.js)（`createAccountingInvoiceForOperator`、`markPaidAccountingForOperator`、`voidPaymentAccountingForOperator`、删单时 void 等） |

## 3. 操作矩阵（行为对齐）

| 操作 | Coliving 入口（示例） | Cleanlemons 入口 |
|------|------------------------|------------------|
| 创建本地行 + 会计开单 | `tenantinvoice/rental-insert` 等 → rentalcollection-invoice | `POST /api/cleanlemon/operator/invoices` → `createOperatorInvoice` → `createAccountingInvoiceForOperator` |
| Mark paid / 收款 + 收据 | 租约收款流、`createReceiptForPaidRentalCollection` 等 | `PUT .../invoices/:id/status`（paid）→ `markPaidAccountingForOperator` |
| Void payment | `tenantinvoice/rental-void-payment` | Operator 发票页 void → 对应 service 调 Bukku/Xero void payment |
| 删未付单 / void 会计单 | `rental-delete` 链上 void 销售发票 | `DELETE .../operator/invoices/:id` → void 销售发票（Bukku/Xero） |
| View invoice / receipt | 列表 `invoiceurl` / `receipturl`，Bukku 可 subdomain + id 兜底 | `pdf_url` / `receipt_url`；Portal 可用 `accounting_meta_json` + `accountingInvoiceId` 拼 Bukku 链接兜底（与 Coliving `resolveBukkuInvoiceHref` 同思路） |

## 4. 维护提示

- 新增会计能力时：**先**在共享 Bukku/Xero wrapper 满足 API 契约，**再**分别在 `rentalcollection-invoice` 与 `cleanlemon-operator-invoice-accounting` 拼各自库的 id。  
- 排查问题时：确认请求里的 `contact_id` / `account_id` 来自**哪张表**，避免把 Coliving 的 mapping 当成 Cleanlemons 的。
