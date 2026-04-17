# Xendit tenant bind (card + bank) and auto-debit

## Portal flow

- **POST `/api/tenantdashboard/create-payment-method-setup`** with `tenancyId`, optional `cancelUrl`, optional `bindType`: `card` (default) | `bank_dd`.
- **Payex (Xendit)**: creates **Payment Session** `session_type: SAVE`, redirects to `payment_link_url`. Return URL includes `xendit_setup=1` so the tenant app refetches `init` and clears strict policy gate.
- **Webhook** (`tryHandlePaymentSessionOrTokenEvent` in `payex.service.js`): on `TenantPaymentMethodBind` metadata, stores `profile.payment_method_linked`, `xendit_payment_token_id`, `xendit_bind_type`.

## Card (auto-debit / MIT)

- Session uses `channel_properties.cards` with `card_on_file_type: RECURRING`.
- Subsequent charges: **`chargeWithXenditPaymentToken`** with `bindType` omitted or not `bank_dd` — uses `channel_properties.card_on_file_type: MERCHANT_UNSCHEDULED` on `/payment_requests`.

## Bank direct debit (saved token)

- **Malaysia / Singapore (MYR / SGD):** not supported for **saved bank mandate** in this integration — FPX / PayNow are not exposed as tokenized direct-debit for merchant-initiated recurring in the same way. Tenants should use **card** bind, or the operator must use a region where Xendit Direct Debit SAVE is available.
- **Indonesia (IDR):** `bindType: bank_dd` sets `channel_properties.allowed_payment_channels` to major **Direct Debit** channels (BRI, BCA, Mandiri, BNI, Permata). Operator `clientdetail.currency` must be **IDR** and Xendit must have those channels enabled.
- **Philippines (PHP):** `bank_dd` uses **BPI_DIRECT_DEBIT** (extend list in code if you add more banks). Client currency **PHP**.

## Cron / rent capture（自动扣租）

- **触发方式（已定）：** 仅 **`POST /api/cron/daily`** 批量处理；**绑卡成功不会立刻扣某张 invoice**。若账单 `date` 已到期且未付，在**下一次 daily cron 成功跑完**时才会尝试扣款（可把 cron 排成每天固定时间，例如凌晨）。
- **环境变量：** `ENABLE_TENANT_XENDIT_AUTO_DEBIT=1`（或 `true`）才启用；否则每日 cron 不跑扣款。
- **租户 opt-in：** 绑卡成功时写入 **`rent_auto_debit_enabled: true`**（及 Xendit 的 **`xendit_auto_debit: true`**，与旧逻辑兼容）。Cron 任一为真即参与。若要关闭，可 SQL 将 `rent_auto_debit_enabled` 设为 `false`。
- **实现（Xendit）：** `src/modules/billing/tenant-xendit-auto-debit.service.js`；**Stripe：** `tenant-stripe-auto-debit.service.js`（`chargeTenantInvoiceWithSavedPaymentMethod` + `persistStripeSetupFromSession` 写入 `stripe_customer_id` / `stripe_payment_method_id`）。`POST /api/cron/daily` 响应含 `tenantXenditAutoDebit`、`tenantStripeAutoDebit`。
- **条件：** 运营商 `getClientPaymentGateway` 为 **payex**；账单 `DATE(date) <=` 马来西亚今天、未付；租户 profile 含 `xendit_payment_token_id` + `payment_method_linked`。
- **扣款：** `chargeWithXenditPaymentToken` + `bindType` 与 `xendit_bind_type` 一致；成功且同步状态为 `SUCCEEDED` 时 `finalizeRentalCollectionAfterTokenCharge`（写 `rentalcollection`、收据、非 platform-flow 时 operator credit 费）。
- **限制：** 仅处理 **同步成功**；若返回 `REQUIRES_ACTION` / `PENDING`，当前不标记已付（待 webhook 补强，见 `docs/xendit-auto-debit-tasks.md`）。
- **单次上限：** `TENANT_XENDIT_AUTO_DEBIT_MAX_PER_RUN`（默认 30）。

## Demo / Next mock

- `coliving/next-app/lib/portal-api.ts` mocks `create-payment-method-setup` with a redirect to `?xendit_setup=1` so the payment page refetch runs without ECS.
