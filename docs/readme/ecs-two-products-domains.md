# ECS 双产品部署（Coliving / Cleanlemons）

同一台 ECS 上可并行跑 **两套** 公网站点：Coliving SaaS 与 Cleanlemons SaaS。代码在同一仓库；通过 **不同域名、不同 PM2 进程、不同端口、（可选）同一 MySQL 库或分库** 区分。

## 三种站点角色（每套产品各一条 api / portal / demo）

| 子域 | 角色 |
|------|------|
| **`api.*`** | **后端**：Node / Express + MySQL，无 Next 站。 |
| **`portal.*`** | **正式站（live）**：Next 前端，接真实后端（同域 `/api/` 反代或配置的公网 API）。 |
| **`demo.*`** | **Mockup / 演示**：与 portal **同套 Next**，**不接后端**（前端 mock；Coliving 见 `docs/nextjs-migration/lib/portal-api.ts`，Cleanlemons 见 `cleanlemon/next-app/lib/portal-auth-mock.ts`）。 |

## 对照表

| 项目 | Coliving | Cleanlemons |
|------|----------|-------------|
| **前端（Portal / Next.js）** | `https://portal.colivingjb.com` | `https://portal.cleanlemons.com` |
| **Demo（mockup，同套 Next，不接后端）** | `https://demo.colivingjb.com` | `https://demo.cleanlemons.com` |
| **后端（Node / Express API）** | `https://api.colivingjb.com` | `https://api.cleanlemons.com` |
| **公司主表（operator 行）** | `clientdetail` → **`operatordetail`**（迁移 0181） | `cln_client` → **`cln_operator`** → **`cln_operatordetail`**（0182、0198；与 Coliving `operatordetail` 命名对齐） |
| **典型本机端口（PM2）** | API `5000`，Next `next-coliving` → `3001` | API `5001`，Next `next-cleanlemons` → `3100`（以实际 `ecosystem`/PM2 为准） |
| **Portal 调 API** | `NEXT_PUBLIC_ECS_BASE_URL` / `PORTAL_FRONTEND_URL` 等，见 `docs/nextjs-migration` | `NEXT_PUBLIC_CLEANLEMON_API_URL`：默认与代码一致为 **`https://portal.cleanlemons.com`**（经 Nginx `location /api/` → Node）；若 `api.cleanlemons.com` 已配好 TLS 且希望直连，可显式设为 `https://api.cleanlemons.com`。 |
| **Google OAuth（Cleanlemons 专用 client）** | `PORTAL_AUTH_BASE_URL=https://api.colivingjb.com`，回调 `…/api/portal-auth/google/callback` | **`CLEANLEMON_PORTAL_AUTH_BASE_URL`** 默认 **`https://portal.cleanlemons.com`**（与 Nginx 将 portal 的 `/api/` 反代到 Node 一致，避免 api 子域证书未配导致 `ERR_CERT_COMMON_NAME_INVALID`）。须在 Google Cloud Console 登记 **`https://portal.cleanlemons.com/api/portal-auth/google/callback`**（若仍使用 api 子域回调则另登记并设环境变量覆盖）。 |

## 代码入口（便于排查）

- **Coliving operator 主表解析：** `src/config/operatorMasterTable.js`（`operatordetail` / `clientdetail`）。
- **Cleanlemons 公司主表解析：** `src/config/clnOperatordetailTable.js` → `resolveClnOperatordetailTable()`（`cln_operatordetail` / `cln_operator` / `cln_client`）；`getClnCompanyTable()` 同上。
- **线上表重命名（不丢数据）：** `npm run migrate:online-renames`（`scripts/run-online-renames.js`，0181–0183、0198）。
- **Portal 登录 / OAuth：** `src/modules/portal-auth/`。Coliving 用策略 `google`；`portal.cleanlemons.com` 且配置了 `CLEANLEMON_GOOGLE_*` 时用策略 **`google-cleanlemon`**（`passport-strategies.js`）。
- **Cleanlemons HTTP：** `server.js` 挂载 `/api/cleanlemon`（`CLEANLEMON_API_GATE_ENABLED` 控制是否套 `apiAuth`）。

## Nginx 要点

- **portal.\***：`location /` → 对应 Next 端口；**仅当**希望浏览器同域调 API 时，`location /api/` → 对应 Node 端口（见 `docs/nginx-portal-proxy.md`）。
- **demo.\***：与 **portal.\*** **同一 Next 端口**（同一 `next start` 进程）；**不需要**为 demo 单独接后端 vhost（mockup 不打真实 API）。
- **api.\***：`location /` → 对应 Node API 端口（Coliving `5000` / Cleanlemons `5001`）。
- OAuth 回调若使用 **api 子域名**，则 **api** 的 vhost 必须把 `/api/portal-auth/` 转到提供 `portal-auth` 的那支 Node 进程。

## 相关文档

- **Cursor 默认提示（双产品域名/端口）：** 仓库 `.cursor/rules/ecs-two-products-domains.mdc`（`alwaysApply`，改 Nginx/PM2/Portal 时 Agent 应读到）。
- Chunk / 构建：`docs/index.md`（近期更新里 Cleanlemons 端口记录）、`docs/readme/index.md`（Portal 部署）。
- Operator API 与 MySQL：`docs/operator-portal-api-mysql-mapping.md`。
