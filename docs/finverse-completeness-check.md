# Finverse 完整性检查

## 已具备（完整）

| 环节 | 说明 |
|------|------|
| **凭据与 Token** | `finverseCreds.js`：按 client 读 client_id/secret（client_integration 或 env）；`finverseToken.service.js`：customer access token 缓存；`saveLoginIdentityToken`：回调后写入/更新 `finverse_login_identity_token`。 |
| **Auth 流程** | `auth.wrapper.js`：`generateLinkToken`（拿 link_url）、`exchangeCodeForLoginIdentity`（code 换 login_identity token）。 |
| **Bank Data** | `bankData.wrapper.js`：`getLoginIdentity`、`listAccounts`、`listTransactions`（供 payment verification 用）。 |
| **Callback** | `finverse-callback.routes.js`：`GET/POST /api/finverse/callback`，读 code/state（state=clientId），换 token → `saveLoginIdentityToken` → 重定向到 `PORTAL_FRONTEND_URL/operator/company?finverse=success`。 |
| **Link URL** | Companysetting：`getFinverseLinkUrl` → `POST /api/companysetting/finverse-link-url`，用当前 client 生成 link_url 返回。 |
| **Onboard 状态** | `getOnboardStatus` 返回 `bankReconcileConnected`（是否有 token）、`finverseHasCreds`（是否有 creds：DB 或 env）。 |
| **前端 Connect** | Company 页 Bank tracking：有 creds 且未连时显示 **Connect**，点击调 `getFinverseLinkUrl()` 后 `window.location.href = link_url`；已连显示 **Connected**。 |
| **Webhook 占位** | `POST /api/finverse/webhook` 已挂载，收 body 打 log；Dashboard 可填 Data Webhook URI。 |
| **路由挂载** | `server.js`：`app.use('/api/finverse', finverseCallbackRoutes)`；payment-verification 用 apiAuth + apiClientScope。 |
| **Payment Verification** | 使用 `client_integration.values_json.finverse_login_identity_token` 调 `listTransactions`；`syncBankTransactionsFromFinverse` 写入 `bank_transactions`；匹配引擎 + Approve/Reject；Approval 页列表与操作已接好。 |
| **Env** | `.env` 已含 `FINVERSE_CLIENT_ID`、`FINVERSE_CLIENT_SECRET`、`FINVERSE_REDIRECT_URI`；`docs/env-finverse.md` 说明 Callback/Webhook/Portal。 |

## 可选增强（非必须）

| 项目 | 说明 |
|------|------|
| **Sync bank 触发** | `POST /api/payment-verification/sync-bank` 已存在，但 **未** 经 companysetting 代理给 Portal。若希望 Operator 在 Approval 或 Company 页主动「同步银行交易」，可：① 在 companysetting 增加 `payment-verification-sync-bank` 代理并前端加「Sync」按钮；或 ② 用 cron 定期对已连 Finverse 的 client 调 `syncBankTransactionsFromFinverse`。 |
| **Webhook 业务逻辑** | `/api/finverse/webhook` 目前只 200 + log，未按 event 类型写库或触发 sync；需要时可按 Finverse 文档解析 payload 并处理。 |
| **AI OCR** | Payment verification 的 AI 路由仍是 stub，接真实 DeepSeek/OpenAI/Gemini vision 后 receipt 解析才完整。 |

## 结论

**Finverse 端到端已完整**：平台 .env 配一套 Client ID/Secret → Operator 在 Company Setting 点 Connect → Finverse Link 连银行 → 回调存 token → Payment verification 用该 token 拉交易、匹配、人工 Approve/Reject。  
唯一可选的是「谁触发 sync 银行交易」：目前需有请求调用 `sync-bank`（或后续加 cron/按钮）才会往 `bank_transactions` 灌数；Approval 页展示的待审核依赖这些数据。
