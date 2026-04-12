# SaaS 支付相关 .env 清单

所有支付相关环境变量按「平台 + Live/Sandbox」整理，便于在 `.env` 里对照配置。

## 总览

| 分类 | Live | Sandbox（Test） | 说明 |
|------|------|------------------|------|
| **Stripe MY**（马来西亚 MYR） | ✅ | ✅ | 主平台；Webhook 需分别配 Live / Test 的 signing secret |
| **Stripe SG**（新加坡 SGD） | 可选 | ✅ | 支持 SGD 时配 |
| **Xendit**（Platform 模式） | ✅ | ✅ | 平台先收再分；Test 用 `XENDIT_PLATFORM_USE_TEST=1` |
| **Xendit SaaS**（Operator 方案 + Top-up） | ✅ | ✅ | 与 Platform 共用 `XENDIT_PLATFORM_*` + 独立 Callback Token（下表） |

---

## Stripe MY（马来西亚）

| 用途 | Live | Sandbox |
|------|------|---------|
| **API 密钥** | `STRIPE_SECRET_KEY` (sk_live_...) | `STRIPE_SANDBOX_SECRET_KEY` (sk_test_...) |
| **Webhook 验签** | `STRIPE_WEBHOOK_SECRET` (whsec_...) | `STRIPE_SANDBOX_WEBHOOK_SECRET` (whsec_...) |
| **前端 Publishable**（可选） | `STRIPE_PUBLISHABLE_KEY` (pk_live_...) | `STRIPE_SANDBOX_PUBLISHABLE_KEY` (pk_test_...) |
| **Connect OAuth Client ID** | `STRIPE_MY_CONNECT_CLIENT_ID` (ca_...) | `STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID` (ca_...) |

- Webhook：同一 URL；后端依次用上述 4 个 secret 验签，**Test 模式事件必须用 Sandbox 的 signing secret**，否则 400。
- 详见 [stripe.md](./stripe.md)。

---

## Stripe SG（新加坡）

| 用途 | Live | Sandbox |
|------|------|---------|
| **API 密钥** | `STRIPE_SG_SECRET_KEY` | `STRIPE_SG_SANDBOX_SECRET_KEY` |
| **Webhook 验签** | `STRIPE_SG_WEBHOOK_SECRET` | `STRIPE_SG_SANDBOX_WEBHOOK_SECRET` |
| **前端 Publishable**（可选） | `STRIPE_SG_PUBLISHABLE_KEY` | `STRIPE_SG_SANDBOX_PUBLISHABLE_KEY` |
| **Connect Client ID** | `STRIPE_SG_CONNECT_CLIENT_ID` | `STRIPE_SG_SANDBOX_CONNECT_CLIENT_ID` |

- 仅当 client 使用 SGD / 新加坡 Stripe 时需要。

---

## Xendit（Platform 模式）

| 用途 | Live | Sandbox（Test） |
|------|------|------------------|
| **平台 API 密钥** | `XENDIT_PLATFORM_SECRET_KEY` (xnd_production_...) | `XENDIT_PLATFORM_TEST_SECRET_KEY` (xnd_development_...) |
| **平台 Master Account ID** | `XENDIT_PLATFORM_ACCOUNT_ID` | 同左（Transfer 用） |
| **是否全站用 Test** | — | `XENDIT_PLATFORM_USE_TEST=1` |

- 不设 `XENDIT_PLATFORM_SECRET_KEY` 时仅为 Operator 模式（每个 operator 自己的 key）。
- 详见 [xendit-platform-flow.md](./xendit-platform-flow.md)。

### Coliving Operator Portal：SaaS 方案费（pricing plan）与 Credit Top-up（平台 Xendit Invoice）

与 **租客租金**（operator 自己的 Xendit / Stripe）分开：这些收款走 **平台 Master** 的 Invoice API，回调带 `metadata.saas_platform=1`，验签用 **主账号 Callback Token**（不是 `client_integration` 里各 operator 的 token）。

**另含 Portal `/enquiry` MYR 方案在线付**：与上同一套 env；新单不再依赖 `SAAS_COLIVING_BILLPLZ_*`。在途 Billplz enquiry 单仍走 `/api/billplz/saas-coliving-callback`。

| 变量 | 说明 |
|------|------|
| **XENDIT_PLATFORM_SECRET_KEY** / **XENDIT_PLATFORM_TEST_SECRET_KEY** | 与 xenPlatform 相同；SaaS Invoice 用此密钥创建。 |
| **XENDIT_PLATFORM_USE_TEST** | Sandbox 时 `1` / `true`。 |
| **XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN** | Xendit Dashboard（主账号）→ Invoice 回调 URL 对应的 **Verification Token**；须与 `POST /api/payex/callback` 收到的 `X-CALLBACK-TOKEN` 一致。未设置则 SaaS 回调返回 `XENDIT_SAAS_PLATFORM_CALLBACK_TOKEN_NOT_SET`。 |
| **SAAS_COLIVING_PUBLIC_API_BASE** 或 **API_BASE_URL** | 写入 Invoice 的 `callback_url`（如 `https://api.colivingjb.com`）。 |

- **支付方式（代码限制）**：`operatordetail.currency === MYR` 时 Invoice 请求体含 `CREDIT_CARD` + `FPX`；`SGD` 时仅 `CREDIT_CARD`。后台仍需在 Xendit 开通对应渠道（见 [Activate payment channels](https://docs.xendit.co/docs/activate-payment-channels)）。
- **马来西亚主体 + 顾客付新币（SGD）**：须在 Xendit **为主账号开通 SGD 开票/收单**（Invoice / cards）。若 API 返回 *currency SGD is not configured in your settings*，表示后台尚未启用该币种，需联系 Xendit 开通。**顾客扣账币种（SGD）与结算/提现币种（例如 MYR）** 可在 Xendit 产品与风控侧分别配置，不因「马币结算」而自动开通 SGD Invoice——两件事都需在后台/工单里确认。
- **API 文档**：以 [docs.xendit.co](https://docs.xendit.co/) 为准；`archive.developers.xendit.co` 为旧版参考。SaaS 托管跳转使用 **`POST /v2/invoices`**（hosted `invoice_url`）。**`POST /v3/payment_requests`** 的 CARDS 示例多在请求体中带 `card_details`，面向直连/令牌扣款；与当前「打开 Xendit 托管页」的 Invoice 流程不同。
- **Sandbox / SGD 核对清单**：在 Test 模式下对 **SGD** 客户创建一笔小额 Invoice，确认 Master 账号允许该币种开票、回调体含 `external_id` / `status` / `metadata` 且 `paid_amount` 与订单金额一致（分单位与后端 `creditlogs.payment` / `pricingplanlogs.amount` 一致）。

---

## 租客支付成功/取消跳转（Stripe / Payex）

| 变量 | 说明 |
|------|------|
| **PORTAL_APP_URL** | 租客 Portal 前端地址（Next.js）。Stripe/Payex 成功/取消时默认跳转至此，如 `https://portal.colivingjb.com`。不设则用 PUBLIC_APP_URL，再否则默认 `https://portal.colivingjb.com`。**若 PUBLIC_APP_URL 为 api 域名，务必设 PORTAL_APP_URL 为 portal 域名**，否则付完会 404。 |
| **API_BASE_URL** | Payex callback 等需打 API 时用；默认 PUBLIC_APP_URL 或 `https://api.colivingjb.com`。 |

---

## 租客 Xendit 保存卡/银行后「到期自动扣租」（cron）

| 变量 | 说明 |
|------|------|
| **ENABLE_TENANT_XENDIT_AUTO_DEBIT** | 设为 `1` 或 `true` 时，每日 `POST /api/cron/daily` 会对已绑 Xendit token 且同意自动扣租的租户尝试扣**到期未付**的 `rentalcollection`。默认不启用。 |
| **ENABLE_TENANT_STRIPE_AUTO_DEBIT** | 设为 `1` 或 `true` 时，对 **Stripe** 运营商且租户 profile 含 **`stripe_customer_id` + `stripe_payment_method_id`**（绑卡 SAVE 成功后写入）的到期未付账单发起 **off_session PaymentIntent**。 |
| **TENANT_XENDIT_AUTO_DEBIT_MAX_PER_RUN** | Xendit 单次 cron 最多成功扣款笔数（默认 `30`，上限 500）。 |
| **TENANT_STRIPE_AUTO_DEBIT_MAX_PER_RUN** | Stripe 同上（默认 `30`）。 |

- **Opt-in：** 绑卡成功时后端会写入 **`profile.rent_auto_debit_enabled === true`**（Stripe / Xendit 皆写）；Xendit 另写 **`xendit_auto_debit`**（兼容旧数据）。若要让某租户**不参与**自动扣租，可 SQL 将 `rent_auto_debit_enabled` 设为 `false`（或后续做 Portal 开关）。
- 详见 [xendit-tenant-bind.md](./xendit-tenant-bind.md)、[xendit-auto-debit-tasks.md](./xendit-auto-debit-tasks.md)。

---

## 最小可跑清单（仅 Stripe MY + 租客支付）

- **Sandbox（开发/测试）**：`STRIPE_SANDBOX_SECRET_KEY`、`STRIPE_SANDBOX_WEBHOOK_SECRET`（Dashboard **Test mode 打开** → Webhooks → 同一 URL → Reveal signing secret）。
- **Live（生产）**：`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`。
- 若用 Connect：再加上 `STRIPE_MY_CONNECT_CLIENT_ID` / `STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID`。
