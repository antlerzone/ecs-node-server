# backend/access/manage.jsw — Access Context（含 Wix Secret Manager）

把 **完整代码** 粘贴到 Wix 的 **backend/access/manage.jsw**，通过 HTTP 调 ECS Node 后端。  
**代码文件：** [velo-backend-manage.jsw.snippet.js](./velo-backend-manage.jsw.snippet.js)

**凭证与后端根地址从 Wix Secret Manager 读取**，在 Wix 后台配置三个 secret：

- **`ecs_token`**：填 `api_user` 表的 `token` 列（与 ECS 双重认证用）
- **`ecs_username`**：填 `api_user` 表的 `username` 列（如 `saas_wix`）
- **`ecs_base_url`**：填 Node 后端根地址（如 `https://api.colivingjb.com`，不要末尾斜杠）

请求 ECS 时需同时带 **Authorization: Bearer &lt;token&gt;** 与 **X-API-Username: &lt;username&gt;**。

---

## Wix 后台配置步骤

1. 打开 Wix 后台 → **Settings** → **Secret Manager**（或 Dev 模式下的 Secrets）。
2. 新增三个 secret：
   - **Name:** `ecs_token` → **Value:** 你的 `api_user.token`（如运行 `node scripts/insert-api-user.js saas_wix` 后输出的 token）。
   - **Name:** `ecs_username` → **Value:** 对应用户名（如 `saas_wix`）。
   - **Name:** `ecs_base_url` → **Value:** Node 后端根地址（如 `https://api.colivingjb.com`，不要末尾斜杠）。
3. 保存后，backend 的 manage.jsw 会通过 `getSecret('ecs_token')` / `getSecret('ecs_username')` / `getSecret('ecs_base_url')` 读取，无需在代码里写死。

**注意：** 此代码必须放在 **Backend** 的 .jsw 中（不能放在 Page Code / 前端），否则无法使用 `wixUsersBackend` 与 `wixSecretsBackend`。
