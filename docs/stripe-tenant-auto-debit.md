# Stripe 租客自动扣租（cron）

## 条件

- `.env`：`ENABLE_TENANT_STRIPE_AUTO_DEBIT=1`（与 Xendit 开关独立）。
- 运营商 `client_integration` 为 **Stripe**。
- `tenantdetail.profile`：`rent_auto_debit_enabled === true`（或兼容 `xendit_auto_debit`），绑卡成功后默认写入；可在 Portal **Payments** 页关闭。
- `stripe_customer_id` + `stripe_payment_method_id`：由 Checkout **mode=setup** 完成后 `persistStripeSetupFromSession` 写入；旧租户需重新绑卡或手工补 JSON。

## 流程

1. `tenant-stripe-auto-debit.service.js` 在 `POST /api/cron/daily` 中运行。
2. `chargeTenantInvoiceWithSavedPaymentMethod` → `payment_intent`（`off_session` + `confirm`），`metadata.type = TenantInvoice`。
3. 成功：`applyTenantInvoiceFromPaymentIntent`（与 Checkout 付租一致）+ `payment_intent.succeeded` webhook 可再兜底。

## 限制

- 部分卡会要求 **3DS**：`requires_action` 时当前 cron 记为失败，需租户手动付款或后续做邮件重试。
