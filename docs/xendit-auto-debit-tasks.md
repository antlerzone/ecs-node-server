# Xendit 租客自动扣租 — 任务拆分

## 已完成（后端）

| # | 内容 | 位置 |
|---|------|------|
| 1 | 绑定卡/银行 SAVE + webhook 写 `profile` | `payex.service.js`（`createPaymentSessionSaveForTenant` / `tryHandlePaymentSessionOrTokenEvent`） |
| 2 | Token 扣款 `chargeWithXenditPaymentToken`（`bindType` 区分卡/银行） | `payex.service.js` |
| 3 | 扣款成功后写 `rentalcollection` + 收据 + 运营商 credit 费（非 platform-flow） | `finalizeRentalCollectionAfterTokenCharge` |
| 4 | 每日 cron：扫到期未付账单、Payex 网关、opt-in + token 存在则扣款 | `tenant-xendit-auto-debit.service.js` + `tenancy-cron.routes.js`（`tenantXenditAutoDebit`） |
| 5 | 环境变量总开关 + 单次上限 | `ENABLE_TENANT_XENDIT_AUTO_DEBIT`、`TENANT_XENDIT_AUTO_DEBIT_MAX_PER_RUN` |
| 6 | **Stripe** 同 cron：`stripe_customer_id` + `stripe_payment_method_id`（SAVE 后写）、`chargeTenantInvoiceWithSavedPaymentMethod`、`ENABLE_TENANT_STRIPE_AUTO_DEBIT` | `tenant-stripe-auto-debit.service.js`、`stripe.service.js`（`tenantStripeAutoDebit`） |

## 待你方 / 产品（未做）

| # | 内容 | 说明 |
|---|------|------|
| A | **租户 opt-in UI** | Portal **Payments** 页已提供 **Charge due rent automatically** 开关（写 `rent_auto_debit_enabled`；关时同时清 `xendit_auto_debit`）。 |
| B | **异步成功 / REQUIRES_ACTION** | 若 Xendit 返回 `PENDING` / `REQUIRES_ACTION`，当前**不会**标记已付；需接 `payment.capture` 等 webhook 补写 `rentalcollection`（与 Stripe 类似）。 |
| C | **Stripe 3DS / 异步** | `off_session` 可能 `requires_action`；当前未单独重试，依赖失败记录与人工。 |
| D | **合并多笔账单一次扣款** | 现实现为**一笔 rentalcollection 一次** `payment_requests`；多笔合并需改金额与 metadata。 |

## 做不到 / 边界

| 内容 | 说明 |
|------|------|
| MY/SG 银行 mandate 自动扣 | FPX/PayNow 无法用当前 Payment Session 银行 SAVE 同一路径；见 `XENDIT_BANK_DD_UNSUPPORTED_REGION`。 |
| 未设 `ENABLE_TENANT_XENDIT_AUTO_DEBIT` | cron **不扣款**，避免误开生产。 |
| `profile.xendit_auto_debit !== true` | **不扣款**（显式 opt-in）。 |

## 运维启用步骤（示例）

1. `.env`：`ENABLE_TENANT_XENDIT_AUTO_DEBIT=1`（可选 `TENANT_XENDIT_AUTO_DEBIT_MAX_PER_RUN=50`）。根目录参考 **`.env.example`**。
2. **Opt-in：** 新绑卡用户由后端自动写 `rent_auto_debit_enabled`；**旧租户**若绑卡早于该字段，可执行一次 SQL 补 `rent_auto_debit_enabled` / `xendit_auto_debit`，或让用户重新走绑卡流程。
3. 确认租户已 `payment_method_linked` + `xendit_payment_token_id`，且运营商为 Payex。
4. 观察 `POST /api/cron/daily` 响应中的 `tenantXenditAutoDebit`：`charged` / `errors` / `skipped`。
