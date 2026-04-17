# Portal: Singpass & MyDigital ID (Gov ID) 集成说明

本文档对应产品计划：**多登录方式**、`portal_account` 绑定官方 OIDC、**demologin** / **demoprofile** 演示路由、以及运维在 ECS 填写环境变量。实现代码见 `src/modules/portal-auth/gov-id.service.js`、`portal-auth.routes.js`（`/api/portal-auth/gov-id/*`）、Next `coliving/next-app/app/demologin`、`app/demoprofile`。

---

## 1. 向 Singpass SDP / MyDigital 确认的事项（上线前 checklist）

| 项目 | 说明 |
|------|------|
| **Staging vs Production** | Singpass 在 [Developer Portal](https://developer.singpass.gov.sg/) 创建 Staging App，生产审批可能长达约 2 周（见官方 Quick Start）。 |
| **Redirect URI** | 必须与 Node 环境变量 **完全一致**：默认 `https://<API 公网>/api/portal-auth/gov-id/callback`（或通过 `GOV_ID_OIDC_REDIRECT_URI` 覆盖）。在 IdP 控制台登记该 URL。 |
| **Singpass（FAPI）** | 实现为 **PAR** + **`private_key_jwt`** + **PKCE** + **DPoP**（见 [Authorization Request](https://docs.developer.singpass.gov.sg/docs/technical-specifications/integration-guide/1.-authorization-request)、[Token exchange](https://docs.developer.singpass.gov.sg/docs/technical-specifications/integration-guide/3.-token-exchange)）。**不设 `client_secret`。** `SINGPASS_OIDC_ISSUER` 须为 **FAPI discovery 根**，Staging 示例：`https://stg-id.singpass.gov.sg/fapi`（不要用已弃用的 `stg-login` 主机作 issuer）。当前实现用于**账号注册/绑定的 Myinfo 取数**，不作为独立登录入口。 |
| **Claims** | MyDigital：`openid` + 所需 scope 下 **userinfo** 的 `nric`/`nama` 等。Singpass：**`SINGPASS_OIDC_SCOPE`** 须与开发门户勾选一致；按审核要求移除 `user.identity`，改用 `nric` 范围，代码读取 `nric` / `name`（见 `gov-id.service.js`）。 |
| **服务协议与品牌** | Singpass 对用户旅程、品牌展示有要求；MyDigital 与 `sso@myid.my` 确认 client 类型与条款。 |

---

## 2. 一证一号与合并规则（定稿）

- **`singpass_sub`、`mydigital_sub`** 在 `portal_account` 上 **UNIQUE**；同一 `sub` 不能绑定第二个邮箱。若 IdP 返回的 `sub` 已被他人占用，接口报错 `SUB_ALREADY_LINKED`（回调会重定向 `gov=error`）。
- **马来西亚**：MyDigital 回调后写入 **`nric`、`fullname`、`id_type=NRIC`、`entity_type=MALAYSIAN_INDIVIDUAL`**（以 IdP 返回为准）。
- **新加坡**：Singpass 回调后写入 **`singpass_sub`**，展示用证件号写入 `nric` 列（常为 uin/sub）、**`entity_type=FOREIGN_INDIVIDUAL`**、**`id_type=PASSPORT`**（与计划「sg_sub_only」一致）。
- **`gov_identity_locked=1`** 时：**PUT `/api/portal-auth/profile`** 若尝试改 `fullname`/`entity_type`/`id_type`/`nric` 返回 **`IDENTITY_LOCKED`**。

---

## 3. 忘记邮箱 / 账户恢复（产品定稿，未全自动实现）

- **方向**：高置信通道用 **已绑定的 Singpass/MyDigital** 查找 `portal_account`（按 `sub`），再 **脱敏展示邮箱** 或 **仅允许重设密码**；须 **限流**、**防枚举**、审计日志。
- **当前代码**：本迭代实现 **Connect / Disconnect** 与 **profile 锁定**；**专用「忘邮箱」页** 与邮件通知策略可在后续迭代接入同一 `gov-id` 服务。

---

## 4. Verify 徽章含义（隐私 / UI 文案）

- **「Verified」徽章**（`/demoprofile`、`UnifiedProfilePage` 在 `showGovVerification` 时）：表示 **已连接 Singpass 或 MyDigital ID 官方 OIDC**，身份字段以 IdP 为准并可能锁定。
- **不表示**：你们自研 **护照 eKYC 扫描** 或酒店前台复印；若需区分，可在 UI 增加副文案 *“Government sign-in verified”*。

---

## 5. 环境变量（键名由仓库维护，真值由 ECS 填写）

见根目录 **[.env.example](../.env.example)** 中 **Gov ID (Singpass / MyDigital OIDC)** 区块。最小集合：

| 变量 | 说明 |
|------|------|
| `PORTAL_AUTH_BASE_URL` | 对外 API 根（如 `https://api.colivingjb.com`），用于拼接回调（若未设 `GOV_ID_OIDC_REDIRECT_URI`）。 |
| `GOV_ID_OIDC_REDIRECT_URI` | 可选；完整回调 URL。 |
| `GOV_ID_OIDC_STATE_SECRET` | 可选；签名 OAuth `state`；默认回退 `PORTAL_JWT_SECRET`。 |
| `MYDIGITAL_OIDC_ISSUER` | Keycloak realm issuer，如 `https://<host>/realms/mydid`。 |
| `MYDIGITAL_OIDC_CLIENT_ID` / `MYDIGITAL_OIDC_CLIENT_SECRET` | MyDigital 控制台下发。 |
| `MYDIGITAL_OIDC_SCOPE` | 可选，默认 `openid profile email`。 |
| `SINGPASS_OIDC_ISSUER` | **FAPI** issuer，Staging：`https://stg-id.singpass.gov.sg/fapi`（由该地址 `/.well-known/openid-configuration` 取 PAR / token / userinfo）。 |
| `SINGPASS_OIDC_CLIENT_ID` | 开发门户 App ID。 |
| `SINGPASS_OIDC_PRIVATE_KEY_PATH` 或 `SINGPASS_OIDC_PRIVATE_KEY` | 与门户登记 **JWKS signing 公钥** 成对的 **ES256 私钥**（PEM）。 |
| `SINGPASS_OIDC_SIGNING_KID` | 可选；须与 JWKS 里 `kid` 一致，默认 `coliving-rp-staging-sig-1`。 |
| `SINGPASS_OIDC_SCOPE` | 空格分隔；默认 `openid nric name dob mobileno email`（不使用 `user.identity`），须与门户勾选一致。 |

Next 前端使用 **`NEXT_PUBLIC_ECS_BASE_URL`** 拼 **浏览器整页跳转** 到 `/api/portal-auth/gov-id/start`（不能使用仅 Next 内部的 proxy 路径）。

---

## 6. 路由与验证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/portal-auth/gov-id/start` | Query: `provider`, `frontend`, `portal_token`（Portal JWT）, `returnPath`。 |
| GET | `/api/portal-auth/gov-id/callback` | IdP 回调；重定向到 `frontend` + `returnPath?gov=success|error`。 |
| GET | `/api/portal-auth/gov-id/status` | Header: `Authorization: Bearer <portal JWT>`。 |
| POST | `/api/portal-auth/gov-id/disconnect` | Body: `{ "provider": "singpass" \| "mydigital" }`。 |

---

## 7. 数据库

迁移文件：`src/db/migrations/0261_portal_account_gov_id.sql`（`singpass_sub`, `mydigital_sub`, `gov_identity_locked`, `*_linked_at`, UNIQUE 索引）。

---

## 8. Signup 与邮箱绑定（规划，未改 start 鉴权）

- **前端**：`/enquiry`、`/register` 的注册侧与登录侧均已展示 Gov ID 按钮；`/register` 的 `returnPath` 使用 `/register?next=…`，便于回调后仍落在带 `next` 的注册/回访上下文。
- **当前行为**：`GET /api/portal-auth/gov-id/start` **仍要求** `portal_token`（已登录 Portal）。访客未登录时点按钮会提示先完成邮箱/密码登录或社交登录后再连接政府 ID。
- **后续产品**：支持「先 IdP 再绑邮箱」时，需在 `state` 中携带 `intent=signup`（或等价）、`gov-id/start` 在无 JWT 时走单独分支，回调后若需补邮箱则重定向到 `/register?gov=bind_email` 或同页一步绑定（与 IdP `sub` 对齐），再发验证邮件。
