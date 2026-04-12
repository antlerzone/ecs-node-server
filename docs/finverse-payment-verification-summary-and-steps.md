# Finverse + Payment Verification — 总结与待办步骤

---

## 1) Company Setting 有 Auth Finverse 吗？

**目前：没有。**

- Company Setting 里 **Bank tracking** 只做**状态展示**：
  - 若该 operator 已在 DB 里有 `finverse_login_identity_token`（在 `client_integration` bankData/finverse）→ 显示 **Connected**。
  - 否则显示 **「Connect via addon」**，按钮是 **Addon required**（disabled），没有跳转 Finverse 的流程。
- **没有**「Connect bank / Auth Finverse」按钮，也没有：
  - 后端提供 `link_url`
  - 前端跳转到 Finverse Link
  - 回调页 `/api/finverse/callback` 用 `code` 换 token 并写入 `client_integration`

**要做成「在 Company Setting 里 Auth Finverse」需要补：**

1. 后端：例如 `GET` 或 `POST /api/finverse/link-url`（或放在 companysetting 下），根据当前 client 生成 `link_url`（`finverse.auth.generateLinkToken`），并返回给前端。
2. 前端：Bank tracking 卡片在「有 Bank Reconcile addon」时显示 **Connect** 按钮，点击后调用上面接口，拿到 `link_url` 后 `window.location = link_url`。
3. 后端：实现 **Finverse callback** 路由（见下文「待办步骤」），用 `code` 换 token，把 `finverse_login_identity_token` 写入该 client 的 `client_integration`。
4. （可选）前端：一个「Finverse 连接成功」页（例如 `/operator/finverse-callback?code=...&state=...`），或直接由后端 callback 重定向回 Company Setting 并带 success 参数。

---

## 2) Summary（当前已做 + 未做）

### 已做

| 项目 | 说明 |
|------|------|
| **Finverse 后端 wrapper** | `src/modules/finverse`：customer token、link token、exchange code、list transactions 等。 |
| **DB** | Migration `0118`：`payment_invoice`、`payment_receipt`、`bank_transactions`、`payment_verification_event`。 |
| **Payment verification 流程** | 上传 receipt → AI OCR → PENDING_VERIFICATION → 同步银行交易 → 匹配引擎 → 自动 PAID 或 PENDING_REVIEW。 |
| **Company Setting** | **AI Agent**：下拉 DeepSeek / ChatGPT / Gemini + API key，保存到 `client_integration`（aiProvider）。**Bank tracking**：仅显示是否已连接（依据是否已有 `finverse_login_identity_token`），无 Connect 按钮。 |
| **Operator Approval 页** | `/operator/approval`：Payment verification 待审核列表（PENDING_REVIEW）+ Approve/Reject；Feedback 保留。侧栏菜单「Approval」+ 角标（feedback + payment 待处理数）。 |
| **规则** | 上传 receipt 不能直接 mark as paid；只有 reconcile 成功或人工 Approve 才 PAID。 |
| **Env 文档** | `.env` 示例 + `docs/env-finverse.md`（FINVERSE_REDIRECT_URI、Dashboard Redirect URI、Webhook 说明）。 |

### 未做（需要你或后续做）

| 项目 | 说明 |
|------|------|
| **Company Setting 里 Finverse Auth** | 没有「Connect bank」按钮和 OAuth 流程；需要 link-url 接口 + 前端跳转 + callback 路由（见上）。 |
| **Finverse callback 路由** | 没有 `GET/POST /api/finverse/callback` 用 `code` 换 token 并写入 DB。 |
| **Addon「Bank Reconcile」** | 在定价/ addon plan 里加一条 Bank Reconcile；前端可按 addon 显示/隐藏 Bank tracking 或开放 Connect。 |
| **Finverse Webhook** | 未实现 `POST /api/finverse/webhook`；若 Finverse 有 webhook，需自建并填 Dashboard Webhook URL。 |
| **AI OCR 真实调用** | `ai-router.service.js` 仍是 stub；要接 Gemini/OpenAI/DeepSeek vision API 才真有 receipt OCR。 |

---

## 3) 需要做的步骤（按顺序）

### 步骤 1：.env 与 Finverse Dashboard

- 在 `.env` 里写好（或已按 `docs/env-finverse.md` 写好）：
  - `FINVERSE_REDIRECT_URI=https://api.colivingjb.com/api/finverse/callback`（或你的实际 API 域名）
  - 若生产：`FINVERSE_PROD=1`
  - 单租户时可填 `FINVERSE_CLIENT_ID`、`FINVERSE_CLIENT_SECRET`；多租户时每个 operator 在 `client_integration`（bankData, finverse）里配 `finverse_client_id`、`finverse_client_secret`、`finverse_redirect_uri`
- 在 [Finverse Dashboard](https://dashboard.finverse.com) 里该应用的 **Redirect URI(s)** 添加与上面**完全一致**的 URL（例如 `https://api.colivingjb.com/api/finverse/callback`）。

### 步骤 2：实现 Finverse callback 路由

- 在后端增加 **Finverse OAuth callback** 接口，例如：
  - `GET` 或 `POST /api/finverse/callback`（与 `FINVERSE_REDIRECT_URI` 对应）
- 逻辑大致：
  - 从 query/body 取 `code`、`state`（state 可带 client_id 或 session 标识）
  - 解析当前 operator（client_id）
  - 调 `finverse.auth.exchangeCodeForLoginIdentity(clientId, { code, redirect_uri })`
  - 把返回的 `access_token` 存进该 client 的 `client_integration`（bankData, finverse）的 `values_json.finverse_login_identity_token`
  - 重定向回 Operator 的 Company Setting 或成功页（例如 `https://portal.colivingjb.com/operator/company?finverse=success`）

### 步骤 3：Company Setting 里加「Connect Finverse」

- 在 Bank tracking 卡片：
  - 若已配置 addon「Bank Reconcile」（或暂时不校验 addon），把「Addon required」改成可点的 **Connect**。
  - 点击后调用后端「生成 link URL」接口（需新增，例如 `POST /api/companysetting/finverse-link-url` 或 `GET /api/finverse/link-url`），传当前 `clientId`，后端用 `finverse.auth.generateLinkToken(clientId, { redirect_uri, state: clientId })` 拿到 `link_url` 返回。
  - 前端收到 `link_url` 后 `window.location.href = link_url`，用户去 Finverse Link 连银行，完成后 Finverse 重定向到步骤 2 的 callback，存 token 后重定向回 Company Setting。
- 这样 Company Setting 才有完整的 **Auth Finverse** 流程。

### 步骤 4：Addon「Bank Reconcile」

- 在你们的定价/ addon 表（例如 `pricingplanaddon` 或现有 plan 配置）里加一条 **Bank Reconcile** addon。
- 前端（或后端 capability）根据该 addon 是否属于当前 client 决定：
  - 是否显示 Bank tracking 卡片；
  - 或是否允许点「Connect」（步骤 3）。

### 步骤 5：同步银行交易与匹配

- Operator 连好 Finverse 后，要能触发「拉银行交易」：
  - 已有接口：`POST /api/payment-verification/sync-bank`（需 apiAuth + apiClientScope），或通过 companysetting 代理的接口由 Portal 调。
- 定时任务（可选）：定期对已连 Finverse 的 client 调 `syncBankTransactionsFromFinverse`，再对 PENDING_VERIFICATION 的 invoice 跑 `runMatchingForInvoice`。

### 步骤 6：AI OCR 真实接入（可选但推荐）

- 在 `src/modules/payment-verification/ai-router.service.js` 的 `extractReceiptWithAi` 里，根据 `getOperatorAiConfig(clientId)` 的 provider（gemini / openai / deepseek）调对应 vision API，把 receipt 图片 URL 或 base64 传给 AI，解析出 amount、reference_number、transaction_id、payer_name、transaction_date 等，返回结构化 JSON。

### 步骤 7：Webhook（可选）

- 若 Finverse 提供 Webhook（例如 LoginIdentity 状态、Payment 状态）：
  - 实现 `POST /api/finverse/webhook`，校验签名（若有 `FINVERSE_WEBHOOK_SECRET`），按事件类型更新 DB 或触发同步。
  - 在 Finverse Dashboard 的 Webhook 配置里填：`https://api.colivingjb.com/api/finverse/webhook`（或你的实际域名）。

---

## 快速对照

| 问题 | 答案 |
|------|------|
| Company Setting 有 Auth Finverse 吗？ | **没有**，只有 Bank tracking 状态展示；需要补 link-url 接口 + 前端跳转 + callback 路由 + 存 token。 |
| Summary | 见上面「2) Summary」。 |
| 需要做的步骤 | 见上面「3) 需要做的步骤」：env + Dashboard Redirect URI → callback 路由 → Company Setting Connect 按钮与 link-url → Addon Bank Reconcile → 同步与匹配 →（可选）AI OCR、Webhook。 |
