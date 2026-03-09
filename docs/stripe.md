# Stripe 封装（SaaS 物业平台）

## 概述

- **全部使用 Stripe Checkout**（跳转 Stripe 页面支付；金额与描述服务端固定，付完或取消回到同一页）：
  1. **Client 充值 credit**：`create-checkout-credit-topup` 返回 url，跳转支付后 webhook 写入 `client_credit`。
  2. **Client tenant 付租金**：`create-checkout-rent` 跳转支付；款项入平台，再根据 client 的 credit 是否足够决定是否 **release** 到 client 的 Connect 账户。

- **平台规则：**
  - Stripe **processing fees 由 SaaS 吸收**（平台承担）。
  - 每笔 transaction 从 client 的 **credit 里扣**：**Stripe 实际手续费**（Balance Transaction 的 `fee`）+ **1% 平台 markup**。扣款以**整 credit 计算、无小数点**（如 350 cents → 4 credit，即 `Math.ceil(totalCents/100)`）。**1 credit = 1 RM/SGD**。每次扣款都会写入 **creditlogs** 表（type=`RentRelease`，amount 为负，remark 含 Stripe fee 金额与百分比），client 可在流水里看到扣了什么。
  - 若 client **credit 不足**上述金额，**不 release** tenant 已付的款项（不向 Connect 账户打款）；款项留在平台，后续可人工处理（退款或等 client 充值后再 release）。

## 环境变量

在 `.env` 中配置（**密钥请自行填入，勿提交代码库**）：

```bash
# Stripe Live（真实支付）
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx   # Dashboard → Webhooks → Live endpoint 的 signing secret
STRIPE_PUBLISHABLE_KEY=pk_live_xxx  # 可选，前端 Stripe.js 用

# Stripe Sandbox / Demo（MY 平台 demo）
STRIPE_SANDBOX_SECRET_KEY=sk_test_xxx
STRIPE_SANDBOX_WEBHOOK_SECRET=whsec_xxx
STRIPE_SANDBOX_PUBLISHABLE_KEY=pk_test_xxx

# Stripe SG 平台（SGD）。Sandbox 必配；Live 上线时再配 STRIPE_SG_SECRET_KEY / STRIPE_SG_PUBLISHABLE_KEY / STRIPE_SG_WEBHOOK_SECRET
STRIPE_SG_SANDBOX_SECRET_KEY=sk_test_xxx
STRIPE_SG_SANDBOX_PUBLISHABLE_KEY=pk_test_xxx
# STRIPE_SG_SANDBOX_WEBHOOK_SECRET=whsec_xxx  # SG Dashboard Webhook 的 signing secret（account.updated 等）

# Stripe Connect OAuth（Standard）client IDs。MY 用 OAuth（Stripe 未开放 MY Express）；SG 仍用 Express。
# Dashboard → Connect → Onboarding options → OAuth 复制 Live client ID / Test 用同一或另建。
STRIPE_MY_CONNECT_CLIENT_ID=ca_xxx
STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID=ca_xxx
# STRIPE_SG_CONNECT_CLIENT_ID=ca_xxx
# STRIPE_SG_SANDBOX_CONNECT_CLIENT_ID=ca_xxx
```

- **Live**：`client_profile.stripe_sandbox = 0` 的 client 使用 `STRIPE_SECRET_KEY`（MY）或 `STRIPE_SG_SECRET_KEY`（SG），Payment Intent / Connect 走真实 Stripe。
- **Sandbox**：`stripe_sandbox = 1` 的 client（如 demo account）使用 `STRIPE_SANDBOX_SECRET_KEY`（MY）或 `STRIPE_SG_SANDBOX_SECRET_KEY`（SG），**全部走 test mode**，包括 **Stripe Connect**（client 点「Connect Stripe」时建的 connected account 也是 sandbox）。
- **Webhook**：同一 URL。服务端依次用 **MY live**（`STRIPE_WEBHOOK_SECRET`）、**MY sandbox**（`STRIPE_SANDBOX_WEBHOOK_SECRET`）、**SG live**（`STRIPE_SG_WEBHOOK_SECRET`）、**SG sandbox**（`STRIPE_SG_SANDBOX_WEBHOOK_SECRET`）验签，任一成功即通过。每个平台需在对应 Stripe Dashboard 添加同一 endpoint URL 并拿到 signing secret。

**Stripe Connect + Sandbox / Live 说明**

- 平台用的是 **Stripe Connect**：平台 = master account，client 点 Company Setting 里「Connect Stripe」后平台可向该 client 的 Connect 账户做 Transfer（如租金 release）。
- **MY（马来西亚）**：Stripe 未在 Onboarding options → Countries 开放 Malaysia，Express 会报错。故 **MY 使用 Standard (OAuth)**：client 用已有或新注册的 Stripe 账号授权连接；需配置 `STRIPE_MY_CONNECT_CLIENT_ID` / `STRIPE_MY_SANDBOX_CONNECT_CLIENT_ID`。**Redirect URI**：若 `.env` 配置了 **`PUBLIC_APP_URL`**（如 `https://api.colivingjb.com`），则 redirect_uri 为 **ECS**（`{PUBLIC_APP_URL}/api/companysetting/stripe-connect-oauth-return`），Stripe 回调 ECS 后由 ECS 换 code 落库并 302 到 Wix，避免 Wix 页被刷新导致 code 丢失；需在 Stripe Dashboard → Connect → OAuth 添加该 ECS URL。未配置 `PUBLIC_APP_URL` 时仍用前端传的 Wix 地址（如 `https://www.colivingjb.com/company-setting`）。可选 **`WIX_COMPANY_SETTING_URL`** 指定 ECS 完成后的跳转页（默认 `https://www.colivingjb.com/company-setting`）。
- **SG（新加坡）**：仍用 **Express**（AccountLink），Countries 列表含 Singapore。
- **Client 可以用 sandbox Connect**：当 `client_profile.stripe_sandbox = 1` 时，`getStripeForClient(clientId)` 会用 sandbox key，因此 `createConnectAccountAndLink` 创建的 account 与 AccountLink 都是 **test mode**。即：client 在 sandbox 下可以正常 Connect Stripe，无需切到 live。
- **四种组合**：Malaysia sandbox、Malaysia live、Singapore sandbox、Singapore live（SG live 待配 key）。由 `stripe_sandbox` + `stripe_platform`（MY/SG）与对应 env 决定。
- **若出现「请在 Stripe Dashboard 完成平台设置」**：Stripe 要求平台在 Dashboard 里完成 Connect 的 **Platform profile**（含 responsibilities for connected accounts）。  
  - **Sandbox client**（`stripe_sandbox=1`）：在 Stripe Dashboard **切换到 Test mode**，在 **Connect → Settings → Platform profile / Platform setup** 下完成并确认。  
  - **Live client**（`stripe_sandbox=0`）：在 Stripe Dashboard **切换到 Live mode**，在 **Connect → Settings → Platform profile / Platform setup** 下**同样做一遍**（Live 与 Test 分开，两边都要单独完成）。

## 数据库

- **client_credit**：已有；用于 client 余额、top-up 入账、rent release 时扣款（Stripe 手续费 + 1% 平台；1 credit = 1 货币单位）。
- **client_profile.stripe_connected_account_id**：存 client 的 Stripe Connect 账户 id（`acct_xxx`）。**仅在 onboarding 完成后**由 webhook `account.updated`（charges_enabled）写入。
- **client_profile.stripe_connect_pending_id**：迁移 `0056` 增加该列，存「已创建但未完成 onboarding」的 account id，用于重复生成 AccountLink 不重复建 account；onboarding 完成或 disconnect 时清空。
- **client_profile.stripe_sandbox**（迁移 `0060`）：`1` = 该 client 使用 Stripe test/sandbox（demo account），`0` = 使用 live。创建 Payment Intent、Connect、Checkout 时按此选择密钥。
- **client_profile.stripe_platform**（迁移 `0061`）：`MY` = 马来西亚 Stripe 平台（收 MYR），`SG` = 新加坡 Stripe 平台（收 SGD）。Company Setting **#buttonstripeonboard** 点击时：若未设置则按 **clientdetail.currency** 推导（SGD → SG，否则 MY），然后在该平台下创建 Connect 账户（country=sg/my）；SG client 接 SG Stripe，MY client 接 MY Stripe。
- **stripepayout**（迁移 `0058` + `0059`）：每 client 每日一条（`client_id` + `payout_date` 唯一），记录该日转给该 client 的 Transfer 汇总（`total_amount_cents`、`transfer_ids` JSON）。**estimated_fund_receive_date**（迁移 0059）= payout_date + 2 天，供 accounting 用（payment date / 预计到账日）。供日后 sync 到 account system。

**creditlogs（RentRelease）**：每次扣 credit 写一条。  
- **Remark**：`Processing fees X% by local card` / `by foreigner card` / `by FPX` / `by Paylah`（卡类型按 client 币种：MY 用 MYR→local=MY 卡；SG 用 SGD→local=SG 卡；否则 foreigner card）。  
- **新增列**（迁移 0059）：**stripe_fee_amount**（Stripe 手续费金额）、**stripe_fee_percent**（Stripe 手续费百分比）、**platform_markup_amount**（1% 金额）、**tenant_name**、**charge_type**（rental / deposit / meter / other，租金 release 为 rental）。  
- payload 含 transaction_id、transfer_id、tenancy_id、tenant_id、amount_cents、stripe_fee_cents、platform_markup_cents、effective_fee_percent、deduct_credits、payment_method_label。

执行迁移：

```bash
node scripts/run-migration.js src/db/migrations/0029_client_profile_stripe_connected_account_id.sql
node scripts/run-migration.js src/db/migrations/0056_client_profile_stripe_connect_pending_id.sql
node scripts/run-migration.js src/db/migrations/0058_create_stripepayout.sql
node scripts/run-migration.js src/db/migrations/0059_stripepayout_creditlogs_columns.sql
node scripts/run-migration.js src/db/migrations/0060_client_profile_stripe_sandbox.sql
node scripts/run-migration.js src/db/migrations/0061_client_profile_stripe_platform.sql
```

## API（Node）

所有收款统一使用 **Stripe Checkout**（跳转 Stripe 页面支付）。金额与描述由服务端固定，支付页不可修改；支付完毕或取消后跳回 **同一页**（returnUrl 与 cancelUrl 设为同一 URL）。

- **POST /api/stripe/create-checkout-credit-topup**  
  Body: `{ email, amountCents, currency?, clientId?, returnUrl, cancelUrl }`  
  返回 `{ ok: true, url }`。前端 `window.location = url` 跳转 Stripe Checkout；描述为 `Credit topup - {currency} {amount}`。支付成功后 webhook `checkout.session.completed`（type=credit_topup）给该 client 加 client_credit。

- **POST /api/stripe/create-checkout-rent**  
  Body: `{ amountCents, currency?, clientId, tenantId?, returnUrl, cancelUrl }`  
  返回 `{ ok: true, url, markupNote?, estimatedDeductCredits? }`。描述为 `Rent - {tenantName} - {roomName}`。支付成功后 webhook 调用 release 逻辑（扣 credit、Transfer 到 Connect）。

- **POST /api/stripe/release-rent**  
  Body: `{ email?, paymentIntentId, clientId? }`  
  在 tenant 租金 PaymentIntent 已 succeeded 后调用：检查 client credit 是否 ≥（Stripe 实际手续费 + 1%）；若够则扣 credit 并 Stripe Transfer 到 client 的 Connect 账户；不够则 `released: false`，不打款。

- **GET /api/stripe/credit-balance?email=&clientId=**  
  查询 client 当前 credit 余额。

- **GET /api/stripe/connect-account?clientId=**  
  查询 client 的 `stripe_connected_account_id` 是否已配置。

- **GET /api/stripe/config?clientId=**  
  返回 `{ stripePublishableKey?, useSandbox }`，供前端按 demo/live 初始化 Stripe.js。

## Webhook

- **POST /api/stripe/webhook**  
  平台统一使用**一个** Webhook URL，**不需要** client 各自配置；Stripe 会把平台与 Connect 账户的事件都发到该 URL。  
  需在 Stripe Dashboard → Developers → Webhooks 配置该 URL，并勾选：
  - **checkout.session.completed**
  - **account.updated**（用于 Connect onboarding 完成时写入 `stripe_connected_account_id`；可选「Listen to events on connected accounts」以便收到 Connect account 事件）  
  （**payment_intent.succeeded** 仅用于历史 Payment Intent 完成，新流程一律走 Checkout。）

  服务端依次用 MY live / MY sandbox / SG live / SG sandbox 的 webhook secret 校验 `Stripe-Signature`，任一成功即通过。处理逻辑：
  - **checkout.session.completed**：按 `metadata.type` 处理。**credit_topup** → 加 client_credit；**rent** → 调 release 逻辑（扣 credit、Transfer）。**TenantInvoice**（rental 发票 Pay Now）→ 校验 paid + 金额一致后 UPDATE rentalcollection；**TenantMeter**（Meter 充值）→ 同上 UPDATE metertransaction。**Topup**（Billing 选 credit plan）→ creditlogs + clientdetail.credit。**pricingplan** → handlePricingPlanPaymentSuccess。Session 拉取按 `metadata.client_id` 选用对应平台 Stripe（MY/SG、sandbox/live）。
  - **account.updated**（**v1**）：当 `charges_enabled === true` 且 `metadata.client_id` 存在时，将 `account.id` 写入 `client_profile.stripe_connected_account_id` 并清空 `stripe_connect_pending_id`（Connect onboarding 完成）。**MY 使用 OAuth (Standard)** 时，Connect 账户是用户已有账号授权，Stripe 不会在 account 上带我们设置的 `metadata.client_id`，故 **MY 的 persist 依赖 OAuth 回调**（`/api/companysetting/stripe-connect-oauth-complete` 用 code 换 token 后写入 DB），不依赖此 webhook；SG Express 创建的 account 有 `metadata.client_id`，会由此 webhook 写入。

- **Account v2 webhook event change**（若迁到 Accounts v2）：  
  必须用 **event destination** 监听 **`v2.core.account[requirements].updated`**，**不能**再依赖 v1 的 `account.updated`。用于：识别 requirement 变更、处理 `currently_due` / `eventually_due`、在 deadline 到达时若仍 `currently_due` 会禁用对应能力（如收款）；需根据事件把用户导回 onboarding 或提示补全资料。当前我们仍为 v1（OAuth / Express + `account.updated`），迁 v2 时需在 Dashboard 添加 event destination 并处理 `v2.core.account[requirements].updated`。

Webhook 路由在 `server.js` 中在 `express.json()` 之前挂载，使用 `express.raw({ type: 'application/json' })`，以保证签名校验使用原始 body。

- **Webhook 响应**：所有 webhook 成功响应 JSON 均带 `backend: 'ecs: node'`，便于识别来自 ECS Node。
- **Checkout（所有支付）**：金额与描述由服务端创建 Session 时固定，支付页不可修改。支付完成或取消后 Stripe 跳转到 `success_url` / `cancel_url`；**必须设为同一页**（returnUrl = cancelUrl），这样访客付完或取消都会回到同一页面。Payment methods 由 Stripe Dashboard 设置，Checkout 会自动展示（卡、FPX 等）。
- **Stripe Connect**：Client 的 Connect 账户事件（如 account.updated）会发到**同一个** Webhook URL；平台据此更新 `stripe_connected_account_id`，client 无需自己配置 webhook。

- **Merchant vs Customer（Accounts v2 概念）**：我们只把 client 当作 **merchant** 连接——即「connected account 接受其客户（租客）的卡支付、并接收平台 Transfer」。**未使用**「customer」配置（即不会把 connected account 当作被平台扣款的客户）。见 [Connect Accounts v2 – configurations](https://docs.stripe.com/connect/accounts-v2#configurations)。当前实现用 **v1 API**（MY 用 OAuth Standard，SG 用 Express）；v1 的 Standard/Express 账户均为可收款账户（merchant 语义），无需显式传 configuration。

- **参考（v2 官方流程）**：  
  - [Onboard your connected account](https://docs.stripe.com/connect/saas/tasks/onboard)：v2 下用 **Account Link**（`POST /v2/core/account_links`）做 Stripe-hosted onboarding 时，在 `use_case.account_onboarding` 里可传 **`configurations: ["merchant"]`**，并设 `return_url` / `refresh_url`；return 后需自行 retrieve account 或监听 **`v2.core.account[requirements].updated`**（v2 不再用 `account.updated` v1）。  
  - [Charge SaaS fees to your connected accounts](https://docs.stripe.com/connect/integrate-billing-connect)：用 **Accounts v2** 建 account 时显式设 `configuration.merchant`（及可选 `customer` 用于向 connected account 收订阅费）。我们仅需 merchant（收租客款 + 收平台 Transfer），不向 client 收 SaaS 费故不需 customer 配置。

- **[Onboard your connected account](https://docs.stripe.com/connect/saas/tasks/onboard) 要点**（v2 Stripe-hosted onboarding）：  
  - **Account Link**：`POST /v2/core/account_links`，body 含 `account`、`use_case.type: "account_onboarding"`、`use_case.account_onboarding.collection_options.fields`（`eventually_due` = 一次性收齐 / `currently_due` = 渐进式）、**`use_case.account_onboarding.configurations: ["merchant"]`**、`return_url`、`refresh_url`。  
  - **refresh_url**：链接过期/已用过/被第三方预访问时 Stripe 会重定向到这里；应调服务端重新生成 Account Link 并重定向到新 URL。  
  - **return_url**：用户完成或点击「稍后保存」时 Stripe 重定向到此；**不传 state**，需在服务端 [Retrieve the account](https://docs.stripe.com/api/v2/core/accounts/retrieve.md) 查 `requirements`，或监听 **`v2.core.account[requirements].updated`** 判断是否完成。  
  - **v2 事件**：用 event destination 监听 `v2.core.account[requirements].updated`，不再依赖 v1 的 `account.updated`。  
  - 我们当前 MY 用 **OAuth Standard**（非 v2 Account Link），SG 用 **v1** `accountLinks.create`；若日后迁 v2 onboarding，按上述创建 Account Link 并传 `configurations: ["merchant"]`。

**Client 在 Stripe Dashboard 看到的**：Release 后，client 登录自己的 **Stripe Connect Dashboard** 可看到每笔 **Transfer**，描述为 `Rent from [租客姓名] - RM 800`（若有 tenant_id 则显示租客名，否则为 `Rent payment - RM 800`）；Connect 账户的 **Balance / Payouts** 会显示该笔入账及后续打款到银行（pending payout 等）。

## 配置检查清单（重新检查用）

| 场景 | 实现方式 | 平台/密钥 | 状态 |
|------|----------|-----------|------|
| **Invoice（rental）** | Tenant Dashboard Pay Now → Checkout Session | 按 client 的 `stripe_platform` + `stripe_sandbox`（`getStripeForClient`） | ✅ metadata 带 `client_id`，webhook 用其拉取 session 正确平台 |
| **Meter 充值** | Tenant Dashboard Meter → Checkout Session | 同上 | ✅ 同上 |
| **Stripe Connect** | Companysetting #buttonstripeonboard | **MY sandbox** / **MY live** / **SG sandbox** / **SG live**（pending 时用 SG sandbox key） | ✅ 按 currency 接 SG/MY；SG live 待补 `STRIPE_SG_SECRET_KEY` + `STRIPE_SG_WEBHOOK_SECRET` |
| **Topup（credit）** | Checkout（create-checkout-credit-topup） | 按 client 的 platform + sandbox | ✅ webhook type=credit_topup → 加 client_credit |
| **Tenant 租金** | Checkout（create-checkout-rent） | 同上 | ✅ webhook type=rent → release 到 Connect |
| **Webhook** | 同一 URL，4 组 secret 依次验签 | MY live、MY sandbox、SG live、SG sandbox | ✅ 需在 MY 与 SG 的 Dashboard 各配 endpoint，SG live 待补 secret |

- **已就绪**：全部使用 Checkout（credit topup、rent、invoice、meter、billing topup、pricing plan）；Connect（MY/SG sandbox + MY live）；Webhook 多平台验签 + `checkout.session.completed` 按 `client_id` 取正确 Stripe。
- **待补（SG live）**：`.env` 增加 `STRIPE_SG_SECRET_KEY`、`STRIPE_SG_PUBLISHABLE_KEY`、`STRIPE_SG_WEBHOOK_SECRET`（在 SG Stripe Live 的 Dashboard 添加同一 webhook URL 后取得）。

## Stripe Connect：如何确认 client 已连接成功

- **重要**：Stripe 只有在**平台成功调用 `oauth/token` 用 code 换 token** 后，才会把该账号列为 Connect 账户。若从未成功兑换 code，则 Connect 列表里不会出现该 merchant。  
  - 用 **ECS 作为 redirect_uri**（配置 `PUBLIC_APP_URL`）可保证 Stripe 回调到 ECS，由 ECS 兑换 code 并落库；ECS 日志出现 `Stripe OAuth token exchange success` 即表示 **Stripe 端已建立连接**。

- **在 Stripe 里哪里看 Connected accounts（平台 vs 被连接账号）**  
  - 必须登录 **平台（Platform）Stripe 账号**——即配置了 Connect、OAuth、Live client ID 和 Redirect URIs 的那个账号（和 `STRIPE_SECRET_KEY` / `STRIPE_MY_CONNECT_CLIENT_ID` 属于同一账号）。  
  - **不要**在 **被连接的那家 merchant 的 Stripe 账号**里找：merchant 登录的是自己的 Stripe（例如 Coliving Management / Antler.zone），那里的 Connect → Accounts 是「连到该账号的」列表，不是「平台下的所有 Connect 账户」。  
  - 在**平台账号**下：**Connect → Connected accounts**（或 **Connect → Accounts**），并确认顶部 **Test mode / Live mode** 与连接时一致（ECS 日志里 `livemode: true` 表示 Live，要在 Live 下看）。  
  - 若仍为空：确认当前登录的 Dashboard 账号就是持有 `STRIPE_SECRET_KEY` 和 OAuth client ID 的那一个（可对比 Dashboard 右上角账号或 Settings → API keys 所在账号）。

- **Stripe 端可见**  
  - **Connect → Connected accounts**（平台账号、对应 Test/Live）：已成功兑换 code 的 Standard/Express 会列在此。  
  - **Dashboard → Logs**：可看到 `oauth/token` 请求。  
  - **Developers → Webhooks**：可看到 `account.updated` 等事件。

- **ECS 端日志**  
  - 用户从 Stripe 返回并调用 OAuth 完成时：`[onboard] stripe-connect-oauth-complete OK email=... accountId=acct_xxx` 或 `OK by state accountId=...`（无 email 时用 state 当 clientId）、`[stripe connect] OAuth complete (MY)` 或 `inserted client_profile`。  
  - Webhook 收到 Connect 事件时：`[stripe webhook] account.updated received`、若处理则 `[stripe webhook] account.updated handled`。  
  - 若返回时未带 email 且带 code+state，后端会用 **state 当作 clientId** 换 code 并落库（防止 return 页 session 丢失导致 NO_EMAIL）；state 必须为有效 client_id。

## 代码位置

- `src/modules/stripe/stripe.service.js`：Stripe 封装（Checkout Session、Transfer、credit 读写、release 逻辑）。
- `src/modules/stripe/stripe.routes.js`：上述 API 与 webhook handler。
- `server.js`：挂载 `/api/stripe/webhook`（raw）与 `/api/stripe` 路由。

## 流程简述

1. **Client 充值**  
   前端调 `create-checkout-credit-topup`（传 returnUrl、cancelUrl 为同一页）→ 拿到 `url` 后跳转 Stripe Checkout → 支付页描述与金额固定 → 付完或取消回到同一页；Stripe 回调 webhook `checkout.session.completed`（type=credit_topup）→ 给 `client_credit` 加额。

2. **Tenant 付租金**  
   前端调 `create-checkout-rent`（returnUrl、cancelUrl 同一页）→ 跳转 Stripe Checkout → 付完回到同一页；webhook `checkout.session.completed`（type=rent）→ 取 session.payment_intent 调用 `releaseRentToClient`：  
   - 取 Stripe 实际 fee + 1% 平台，查 client credit；  
   - 若足够：扣 credit，Transfer 到 client 的 Connect 账户；  
   - 若不足：不 Transfer，返回 `released: false`。  
   也可在支付成功后由业务侧再调 `POST /api/stripe/release-rent` 做一次 release（例如重试或人工触发）。
