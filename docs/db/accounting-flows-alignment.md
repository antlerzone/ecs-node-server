# Accounting 流程对齐（业务规则 ↔ 代码）

本文档把 **Operator 侧账务约定** 与 **Node 实现位置** 逐项对齐；实现以 **Bukku** 为主，其它 provider 为同类映射。

---

## 1. Topup Aircond（电表充值）

| 业务 | 约定 |
|------|------|
| 单据 | **Cash invoice**（款已收） |
| 行 | **Product ID**（form line）+ **Platform Collection** 作为行上 clearing / sale 侧科目（与 Account 设置里映射一致） |
| 收款 | **Stripe** 清算科目 → `deposit_items` 指向 Stripe |

| 代码 | 说明 |
|------|------|
| `stripe.service.js` / `payex.service.js` | `checkout.session.completed` / 回调后 `handleTenantMeterPaymentSuccess` |
| `rentalcollection-invoice.service.js` | `handleTenantMeterPaymentSuccess` → `createCashInvoice`，需传 `paymentAccountId` = Stripe 映射 |
| `account` 表 | 模板 **Topup Aircond**（id `a1b2c3d4-1001-4000-8000-000000000101`） |

---

## 2. Rental income / 其它「产品类」收入（rentalcollection）

| 业务 | 约定 |
|------|------|
| 单据 | **Credit invoice**（应收） |
| 行 | **Product ID** + **Platform Collection**（行科目，与映射一致） |
| 收款 | 租客付款后 **Receipt** → 资金进 **Stripe**（与 `source === 'stripe'` 一致） |

| 代码 | 说明 |
|------|------|
| `createInvoicesForRentalRecords` | 按 `type_id` → `getAccountMapping` → `createCreditInvoice` |
| `createReceiptForPaidRentalCollection` | Stripe 付款时 `getPaymentDestinationAccountId(..., 'stripe')` → Bukku `deposit_items` |

---

## 3. Forfeit deposit（没收押金）

| 业务 | 约定 |
|------|------|
| 逻辑 | **Product** + **Platform Collection** + **Deposit** 科目参与（从押金负债转出等，以你们 Bukku 科目为准） |
| 收款侧 | 与 forfeit 流程相关的 receipt：可用 **Deposit** 作为付款来源（`payFromDeposit`） |

| 代码 | 说明 |
|------|------|
| `createReceiptForPaidRentalCollection` | `opts.payFromDeposit === true` 时 `destKey = 'deposit'` |
| `createReceiptForForfeitDepositRentalCollection` | 先标已付再 `createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` |

---

## 4. Deposit（押金类 rentalcollection）

| 业务 | 约定 |
|------|------|
| 单据 | Credit invoice 行：**Deposit 相关 product** + **Deposit 科目** |
| 收款 | **Stripe**（与现网 receipt 一致） |

| 代码 | 说明 |
|------|------|
| `type_id` → `account` title **Deposit** | `getAccountMapping` |
| 付款入账 | `createReceiptForPaidRentalCollection` 非 forfeit 且 `source=stripe` → Stripe |

---

## 5. Settlement（Stripe 结算到银行）

| 业务 | 约定 |
|------|------|
| 分录 | **CR Stripe**，**DR Processing fees**，**DR Bank**（费与 markup 可合并一行 Processing） |

| 代码 | 说明 |
|------|------|
| `stripe/settlement-journal.service.js` | `createSettlementJournal`：三行 journal（bank DR、processing DR、stripe CR） |
| 映射 | `getPaymentDestinationAccountId`：`bank` / `processing_fee` / `stripe` |

---

## 6. Owner payout（业主付款）

| 业务 | 约定 |
|------|------|
| 分录 | **DR Platform Collection**，**CR Bank** |

| 代码 | 说明 |
|------|------|
| `generatereport-accounting.service.js` | `createCashPurchaseOne`：`expenseAccountId` = Platform Collection，`paymentAccountId` = Bank/Cash |

---

## 7. Referral（推荐费支出）

| 业务 | 约定 |
|------|------|
| 组合 | **Product ID** + **Bank** + **Referral（COS）科目** |

| 代码 | 说明 |
|------|------|
| 若存在 | `createBukkuMoneyOutForReferral`（或 banking expense）— 需在服务中提供并挂 admindashboard / commission 流程 |

> **说明**：当前仓库若缺少 `createBukkuMoneyOutForReferral`，需在 `rentalcollection-invoice.service.js` 或独立模块补全。

---

## 8. Commission collected（业主/租客佣金开票）

| 业务 | 约定 |
|------|------|
| 单据 | Credit invoice |
| 行 | **Commission income product** + **Owner Comission / Tenant Commission** 映射 + 收款 **Stripe** |

| 代码 | 说明 |
|------|------|
| `createInvoicesForRentalRecords` | `isOwnerCommissionType(type_id)` → 联系人业主，否则租客 |
| `createReceiptForPaidRentalCollection` | 付款进 Stripe（同第 2 节） |

---

## 维护说明

- **Platform Collection** 与各行的 **Product ID** 在 Account 设置中维护；若采用「仅 Product + 自动带 PC 的 accountid」保存策略，见 `account.service.js` `saveBukkuAccount`。
- 数据库种子与 UUID 见 `0154`/`0155` 等 migration。
