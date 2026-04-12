# SaaS 平台母账号（Env 配置）

平台必须有**四个母账号**在 env（或 Secret Manager）中配置；client 在 Company Setting 的 onboard / create 都是从对应母账号开 **子账号** 或 **Connect 账户**。

| 整合 | 母账号用途 | Env 变量 | Client onboard 行为 |
|------|------------|----------|----------------------|
| **TTLock** (Smart Door) | TTLock Open Platform 应用 | `TTLOCK_CLIENT_ID`、`TTLOCK_CLIENT_SECRET` | **仅 Create 子账号**：从平台应用为 client 建子账号（register user），subdomain 作 username。Operator 不可连接自己的账号，只能使用平台子账号。 |
| **CNYIOT** (Meter) | 平台主账号，用于 addUser | `CNYIOT_LOGIN_NAME`、`CNYIOT_LOGIN_PSW`（另需 `CNYIOT_AES_KEY`、`CNYIOT_API_ID`） | **仅 Create 子账号**：用母账号调 addUser，client 的 subdomain 作 tenant group。Operator 不可连接自己的账号，只能使用平台子账号。 |
| **Stripe** | 平台 Stripe 账号（MY/SG） | `STRIPE_SECRET_KEY`、`STRIPE_SANDBOX_SECRET_KEY`、`STRIPE_SG_*` 等（见 [stripe.md](./stripe.md)） | **Stripe Connect**：为 client 建 Express connected account（Malaysia 或 Singapore），onboarding 完成后可向该 account Transfer（如租金 release） |
| **Bukku** | 平台 Bukku 开单 | `BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`、`BUKKU_SAAS_DEFAULT_CONTACT_ID` | Client **不是**从母账号开子账号；每个 client 在 Company Setting 填自己的 **Token + Subdomain** 存 `client_integration`（addonAccount/bukku）。平台 Bukku 仅用于 indoor billing 开单等 |

## 检查清单

- **TTLock**：未配置时 Connect Smart Door（Create）会报 `TTLOCK_APP_CREDENTIALS_MISSING`，前端提示「服务端未配置 TTLock 应用 (TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET)」。
- **CNYIOT**：未配置 `CNYIOT_LOGIN_NAME` / `CNYIOT_LOGIN_PSW` 时 Create 子账号会报 `CNYIOT_PLATFORM_ACCOUNT_MISSING`，前端提示「服务端未配置母账号 (CNYIOT_LOGIN_NAME / CNYIOT_LOGIN_PSW)」。若报 `CNYIOT_ADD_USER_FAILED_4127` 等，多为该 client 的 subdomain 已被占用或 CNYIOT 侧限制，前端会提示「Meter 创建子账号失败 (CNYIOT 4127)，可能 subdomain 已被使用或请稍后重试」。
- **Stripe**：见 [stripe.md](./stripe.md)；Connect 前需在 Stripe Dashboard（Test/Live 分别）完成 Platform profile。
- **Bukku**：Client 填自己的凭证；平台 env 用于 indoor billing 等，非 client 子账号。

## 代码位置

- TTLock 母账号：`src/modules/ttlock/lib/ttlockCreds.js`、`ttlockRegister.js`、`ttlockToken.service.js`
- CNYIOT 母账号：`src/modules/cnyiot/lib/cnyiotToken.service.js`（`getCnyIotPlatformAccount`）、`cnyiotSubuser.js`
- Stripe：`src/modules/stripe/stripe.service.js`（`getStripe`、`getStripeForClient`、`createConnectAccountAndLink`）
- Bukku 平台：`src/modules/billing/saas-bukku.service.js`
