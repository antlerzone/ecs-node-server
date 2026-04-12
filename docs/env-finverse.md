# Finverse 环境变量（Callback / Webhook URL）

Finverse 连银行流程需要 **Redirect URI（OAuth callback）**；若使用 Webhook 接收事件，还需在 Dashboard 填写 **Webhook URL**。下面是要写入 `.env` 的变量及在 Finverse Dashboard 里要填的地址。

## 平台一个 App、Operator 只点 Connect（无需 operator 填 Finverse）

与 Stripe Connect 的「每个 sub-account 单独 onboarding」不同，Finverse 是：**平台一个 Application（一套 Client ID/Secret）**，每个 operator 只在前台点 **Connect**，在 Finverse Link 里连自己的银行；后端按 `state=clientId` 把拿到的 **login_identity token 存到该 operator 的 client_integration**。  
因此 **不需要** 在 Company Setting 里加「Finverse 配置」让 operator 填 Client ID/Secret；只要在平台 `.env` 配好 `FINVERSE_CLIENT_ID` / `FINVERSE_CLIENT_SECRET`，operator 即可完成完整 auth（点 Connect → 连银行 → token 自动落库）。  
若将来要支持「每个 operator 用自己的 Finverse 应用」，再在 Company Setting 增加 Finverse 配置表单，把各家的 client_id/client_secret 存进 `client_integration` 即可。

---

## 一、.env 里要写的变量

在项目根目录 `.env` 增加一段（按实际域名和路径改）：

```bash
# ========== Finverse（Bank Data / 银行核销）==========
# 官方说明：测试与正式均请求同一环境 https://api.prod.finverse.net/
# 测试/正式由 Developer Portal 的应用类型区分（Test app / Live team），不是不同 URL。
# 可选：覆盖 API 根地址（一般不需要）
# FINVERSE_BASE_URL=https://api.prod.finverse.net

# 单租户时用的凭据（多租户时各 operator 在 client_integration 里配）
# FINVERSE_CLIENT_ID=your_client_id
# FINVERSE_CLIENT_SECRET=your_client_secret

# OAuth 回调地址（必须与 Finverse Dashboard 里填的 Redirect URI 完全一致）
FINVERSE_REDIRECT_URI=https://api.colivingjb.com/api/finverse/callback

# 可选：请求超时（毫秒）
# FINVERSE_FETCH_TIMEOUT_MS=25000

# 可选：覆盖 customer token 路径（默认已为官方路径 /auth/customer/token）
# FINVERSE_AUTH_TOKEN_PATH=/auth/customer/token

# 可选：若 Finverse 在 Developer Portal 提供长期 Bearer Token，可直接设此变量，则不再请求 /auth/token
# FINVERSE_ACCESS_TOKEN=your_long_lived_bearer_token
```

说明：

- **FINVERSE_REDIRECT_URI**：用户完成 Finverse Link 后浏览器会被重定向到这里，后端在这里用 `code` 换 `login_identity` token。  
  必须与 [Finverse Dashboard](https://dashboard.finverse.com) 里该应用配置的 **Redirect URI(s)** 完全一致（含协议、域名、路径、末尾斜杠一致）。
- 若每个 operator 用自己的 Finverse 应用，则 `redirect_uri` 通常存在 `client_integration.values_json.finverse_redirect_uri`，可不用 env；env 作为**单租户或默认**回退。

**认证说明：** 获取 customer_token 使用 **POST /auth/customer/token**（见官方文档 Auth (Customer App)），请求体为 JSON：`client_id`、`client_secret`、`grant_type: "client_credentials"`。用户从 Link 回调后，用 **POST /auth/token**（`grant_type=authorization_code`）换 login identity token 时，请求头需带 **`Authorization: Bearer <customer_token>`**（与调用 `/link/token` 相同）；否则 API 会返回 401「Bearer token required」。若仍 401，把日志中的 `request_id` 发给 support@finverse.com。若 Finverse 提供长期 Bearer，可设 `FINVERSE_ACCESS_TOKEN` 跳过 customer token 请求。

---

## 二、Finverse Dashboard 里要填的 Callback / Redirect URI

在 Finverse Dashboard → 你的应用 → **Redirect URI(s)** 里添加：

| 说明 | Redirect URI（示例） |
|------|----------------------|
| 测试/正式共用同一 API 环境，回调 URL 一致即可 | `https://api.colivingjb.com/api/finverse/callback` |

注意：

- 只能填 **HTTPS**。
- 必须与 `.env` 里 `FINVERSE_REDIRECT_URI`（或各 operator 的 `finverse_redirect_uri`）**完全一致**。

---

## 三、Webhook URL

Finverse 有两套：

- **Webhooks (v2)**（Svix）：在 **Svix** 里 **Endpoints** → **+ Add Endpoint**，URL 填 `https://api.colivingjb.com/api/finverse/webhook`；要订阅的事件在 **Event Catalog**（或 [Event Types](https://app.svix.com/app_3B2HNMOwZNzCIggbo3tf5Jw6rNj/event-types)）里勾选。v2 请求带 Svix 签名（如 `svix-signature`），校验需在 `.env` 配 `FINVERSE_WEBHOOK_SECRET` = 该 endpoint 的 **Signing Secret**（Svix 端点详情页可见）。
- **Webhooks (v1)：Data Webhook URIs**：在 Finverse 应用设置里逗号分隔填 URL，同上；后端同一个 `POST /api/finverse/webhook` 可同时接 v1 或 v2 的请求（v2 建议加签名校验）。
- **Webhooks (v1)：Payment Webhook URIs**：仅 Payments API，需联系 **sales@finverse.com**，不能自填。

当前后端 `POST /api/finverse/webhook` 已存在，收到 body 会打 log；若用 v2，在 Svix 里 Add Endpoint 填上述 URL 并到 Event Catalog 订阅需要的 events 即可。

**Svix 里要勾选哪些事件（支付核销 / 银行同步）：**

在 [Event Types](https://app.svix.com/app_3B2HNMOwZNzCIggbo3tf5Jw6rNj/event-types) 或 New Endpoint 页的「Subscribe to events」里，建议勾选：

| 建议勾选 | 说明 |
|----------|------|
| **ACCOUNTS_RETRIEVED** | 账户列表拉取成功，可用来知道该 login 的账户已就绪。 |
| **ACCOUNTS_RETRIEVAL_FAILED** | 账户拉取失败，便于记录或告警。 |
| 名字里带 **TRANSACTIONS** 的事件（如 TRANSACTIONS_RETRIEVED、TRANSACTIONS_*） | 有新区块/新交易时推送，可触发我们同步到 `bank_transactions` 或跑匹配。 |
| 名字里带 **LOGIN_IDENTITY** 或 **CONNECTION** 的事件 | 连银行状态变化（如需重新授权、断开），便于提示 operator 重新 Connect。 |

若列表里没有 TRANSACTIONS_*，可先勾选上述 ACCOUNTS_* 和 LOGIN_IDENTITY/CONNECTION 相关项；或先选「Receiving all events」观察一段时间，看 payload 里有哪些 `event_type`，再回来改成只订阅需要的。

---

## 四、Portal 与 Demo

- **portal.colivingjb.com**：正式 Operator Portal（Next.js），连 Node 后端 api.colivingjb.com，Finverse 回调会重定向回 `https://portal.colivingjb.com/operator/company?finverse=success`。
- **demo.colivingjb.com**：Demo 版本，不接后端，无需配置 Finverse。

回调使用的 portal 地址由 `.env` 的 `PORTAL_FRONTEND_URL` 或 `PORTAL_APP_URL` 决定，当前为 `https://portal.colivingjb.com`。

## 五、小结

| 用途           | 写在 .env 的变量           | 在 Finverse Dashboard 填的地址 |
|----------------|---------------------------|----------------------------------|
| OAuth 回调     | `FINVERSE_REDIRECT_URI`   | Callback URLs = 同上 URL         |
| Data Webhook   | 可选 `FINVERSE_WEBHOOK_*` | Webhooks (v1) Data Webhook URIs  |

Redirect URI：`https://api.colivingjb.com/api/finverse/callback`  
Data Webhook URL（可选）：`https://api.colivingjb.com/api/finverse/webhook`
