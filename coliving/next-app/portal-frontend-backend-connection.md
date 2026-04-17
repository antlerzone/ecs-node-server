# Portal 前端与后端对接说明

Portal（portal.colivingjb.com）通过 **Next 同源代理** 调用 ECS 后端，API 密钥只存在服务端，前端只传 email / clientId 等业务参数。

---

## 1. 环境变量（Next 项目 .env.local）

| 变量 | 说明 | 示例 |
|------|------|------|
| `NEXT_PUBLIC_ECS_BASE_URL` | ECS 后端根地址（代理用） | `https://api.colivingjb.com` |
| `ECS_BASE_URL` | 同上，服务端代理读此或上面那个 | `https://api.colivingjb.com` |
| `ECS_API_TOKEN` | ECS API 认证 token（Bearer） | 与现有 Wix/API 用户一致 |
| `ECS_API_USERNAME` | ECS API 用户名（X-API-Username） | 与现有一致 |

代理路由会把这些 header 加到转发请求上；**不要**把 token/username 写进前端代码或 `NEXT_PUBLIC_*`。

---

## 2. 前端流程（已实现）

1. **登录页 `/login`**  
   用户输入 email + 密码 → 前端调 `getMemberRoles(email)`（经代理）→ **后端确认该 email 是否在表内**（staffdetail/tenantdetail/ownerdetail/clientdetail）；返回 `registered: true` 且 `roles.length > 0` 才写入 `portal_member` 并跳转 `/portal`，否则提示「未注册」。

2. **Portal 选择页 `/portal`**  
   从 `portal_member` 读 roles，展示「Operator – 公司A」「Tenant Portal」等；用户点击后写入 `portal_current_role`（type、clientId、tenantId 等）并跳转对应 Portal。

3. **各 Portal 内**  
   - 从 `getMember()` 取 email，从 `getCurrentRole()` 取当前身份（含 staff 的 clientId）。  
   - 调后端时用 `portalPost('path', { email, ... })`；Operator 相关接口在需要时传 `clientId`（多 client 时用 `getAccessContextWithClient(email, clientId)`）。

4. **全站必须登入**  
   `/portal`、`/operator/*`、`/tenant/*`、`/owner/*`、`/saas-admin/*` 均以 `getMember()` 为准：无 `portal_member` 则重定向到 `/login`，未登入无法继续。

5. **Demo 站**  
   `demo.colivingjb.com` 不请求后端（`portal-api` 内会判断 host 并跳过 fetch）。

---

## 3. 后端需提供的路由（ECS server.js）

当前 `server.js` 已挂载例如：`/api/access`、`/api/tenancysetting`、`/api/metersetting`、`/api/billing` 等。若 Portal 要完整用齐三端，请确认以下模块也已挂载（若你用的是 `app.js` 或其它入口，在对应文件里挂载即可）：

| 模块 | 挂载路径 | 用途 |
|------|----------|------|
| tenantdashboard | `/api/tenantdashboard` | 租客端 init、profile、agreement、rental、payment 等 |
| ownerportal | `/api/ownerportal` | 业主端 |
| booking | `/api/booking` | 预订（若 Operator 需要） |
| contact | `/api/contact` | 联系人（已有） |
| propertysetting / roomsetting 等 | 见现有 server.js | Operator 各设置页 |

若缺少某条路由，前端 `portalPost('tenantdashboard/init', { email })` 会 404，需在 ECS 上补挂对应路由。

---

## 4. Operator 多 client 时的 context

当同一 email 在多个 client 下为 staff 时，后端应支持「按 client 取 context」：

- 前端在选「Operator – 公司A」后，会把 `clientId` 写入 `portal_current_role`。
- Operator 相关请求应带 `email` + `clientId`（例如从 session 或 body 读）。
- 后端对应接口可调用 `getAccessContextByEmailAndClient(email, clientId)` 取得该 client 下的 permission/client 等，而不是仅用 `getAccessContextByEmail(email)`（只取第一个 client）。

若某接口目前只支持 email，可在该接口内增加对 body 中 `clientId` 的判断，有则用 `getAccessContextByEmailAndClient`，无则沿用 `getAccessContextByEmail`。

---

## 5. 登录与注册校验

- **是否注册**：后端 `getMemberRoles` 只会在 email 存在于 staffdetail/tenantdetail/ownerdetail/clientdetail 时返回 roles，并返回 `registered: roles.length > 0`。前端仅当 `registered && roles.length > 0` 时放行，否则提示「未注册」。
- **密码校验（可选）**：当前未在后端校验密码。若需要「先验证密码再返回 roles」：

- 后端需提供登录接口（例如 `POST /api/auth/login`，body: email + password），校验通过后返回 token 或 session，再在受保护接口中返回该用户的 roles。
- 前端登录流程改为：先调登录接口 → 成功后再调 member-roles（或由登录接口直接返回 roles），再写入 `portal_member` 并跳转 `/portal`。

---

## 6. 常见问题

- **登录后提示 "Sign in failed" 或 401**  
  检查 Next 的 `.env.local` 是否配置了 `ECS_API_TOKEN` 和 `ECS_API_USERNAME`（与 ECS 上 API 用户一致）。`/api/access/*` 受 apiAuth 保护，代理必须带这两个 header。

- **"Access Denied" + "API 502" 或 "PROXY_ERROR"**  
  Portal 代理无法请求 ECS。排查：1) ECS (api.colivingjb.com) 是否运行；2) Portal 部署机能否访问 ECS（防火墙/VPC/DNS）；3) `.env.local` 的 `ECS_BASE_URL` 是否正确；4) 在 Portal 机执行 `curl -X POST https://api.colivingjb.com/api/access/context -H "Content-Type: application/json" -d '{"email":"x"}'` 验证。

- **Demo 站登录**  
  demo.colivingjb.com 不请求后端，会提示 "Demo site: use portal.colivingjb.com to sign in with backend."。若要在 demo 上做 UI 演示，可暂时改登录页在 demo 时使用 mock roles 并写入 session。

- **Operator 进某公司后数据不对**  
  确认该接口是否支持按 client 区分。若后端仍只用 `getAccessContextByEmail(email)`，会取到「第一个」client；需在接口内支持传 `clientId` 并改用 `getAccessContextByEmailAndClient(email, clientId)`。

---

## 7. 小结

| 项目 | 说明 |
|------|------|
| 前端 API 调用 | 统一走 `lib/portal-api.ts` 的 `portalPost` / `getMemberRoles` / `getAccessContextWithClient`，经 Next 代理 `/api/portal/proxy/*`。 |
| 身份与多 client | `lib/portal-session.ts` 存 `portal_member`、`portal_current_role`；Operator 传 `clientId` 时后端用 `getAccessContextByEmailAndClient`。 |
| 环境变量 | Next 端配置 `NEXT_PUBLIC_ECS_BASE_URL`、`ECS_API_TOKEN`、`ECS_API_USERNAME`（及可选 `ECS_BASE_URL`）。 |
| 后端路由 | 确认 tenantdashboard、ownerportal 等已在 ECS 上挂载；缺则补挂。 |
