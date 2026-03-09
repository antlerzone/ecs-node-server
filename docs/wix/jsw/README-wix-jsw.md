# 如何写 Wix JSW（调用 ECS 后端）

本文档记录「在 Wix 里写 .jsw 调用 ECS Node 后端」的约定与步骤，下次可直接读回沿用。

---

## 1. JSW 是什么、放哪里

- **JSW**：Wix 的 backend 代码文件（如 `backend/access/manage.jsw`），运行在服务端，**不能**放在 Page Code / 前端。
- **用途**：从 Wix 发 HTTP 请求到 ECS Node 接口（如 `/api/access/context`），或调用 Wix 的 `wixUsersBackend`、`wixSecretsBackend` 等仅后端可用的 API。
- **位置**：在 Wix 编辑器里，Backend 代码在 **Backend** 或 **Code** 下的 `.jsw` 文件（如 `manage.jsw`）。

---

## 2. 认证方式（ECS 双重认证）

ECS 要求 **token + username** 两个请求头，缺一不可：

| 请求头 | 含义 | 来源 |
|--------|------|------|
| `Authorization: Bearer <token>` | API 密钥 | `api_user.token`（或 Wix Secret Manager 的 `ecs_token`） |
| `X-API-Username: <username>` | API 用户名 | `api_user.username`（或 Wix Secret Manager 的 `ecs_username`） |

在 JSW 里每次请求 ECS 时都要带上这两个 header。

---

## 3. 凭证不要写死在代码里：用 Secret Manager

- 在 Wix 后台 **Secret Manager** 里配置：
  - **`ecs_token`**：填 ECS 的 `api_user.token`（API 密钥）
  - **`ecs_username`**：填 ECS 的 `api_user.username`（如 `saas_wix`）
  - **`ecs_base_url`**：填 Node 后端根地址（如 `https://api.colivingjb.com`，不要末尾斜杠）
- 在 JSW 里用 **wix-secrets-backend** 读取（仅后端可用）：

```javascript
import wixSecretsBackend from 'wix-secrets-backend';

async function getEcsCreds() {
    const token = await wixSecretsBackend.getSecret('ecs_token');
    const username = await wixSecretsBackend.getSecret('ecs_username');
    const baseUrl = await wixSecretsBackend.getSecret('ecs_base_url');
    return {
        token: token != null ? String(token).trim() : '',
        username: username != null ? String(username).trim() : '',
        baseUrl: baseUrl != null ? String(baseUrl).trim().replace(/\/$/, '') : ''
    };
}
```

- **注意**：`wix-secrets-backend` 标准 API 是 **`getSecret(key)`**，返回 `Promise<string>`。不要用 `getSecretValue`（若你用的包没有该方法会报错）。

---

## 4. 请求 ECS 的写法（fetch + 错误处理）

- 用标准 **`fetch`** 发 POST/GET，URL 从 Secret Manager 的 **`ecs_base_url`** 读取后拼接路径（如 `${baseUrl}/api/access/context`）。
- **Headers** 必须包含：
  - `Content-Type: application/json`（有 body 时）
  - `Authorization: Bearer <token>`
  - `X-API-Username: <username>`
- **错误处理**：建议统一捕获异常与 `!res.ok`，对外只返回 `{ ok: false, reason: 'BACKEND_ERROR' }`，不把 ECS 的报错信息或 stack 返回给前端。

示例（片段）：

```javascript
const res = await fetch(`${NODE_BASE}/api/access/context`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-API-Username': username
    },
    body: JSON.stringify({ email: email || '' })
});

if (!res.ok) {
    return { ok: false, reason: 'BACKEND_ERROR' };
}
const data = await res.json();
// 校验 data 含 ok、reason 后再 return，否则同样返回 BACKEND_ERROR
```

---

## 5. 当前登录用户（门禁入口）

- 若需要「当前登录用户」的 email 再调 ECS，用 **wix-users-backend**（仅后端）：

```javascript
import wixUsersBackend from 'wix-users-backend';

const user = wixUsersBackend.currentUser;
if (!user.loggedIn) return { ok: false, reason: 'NOT_LOGGED_IN' };
const email = await user.getEmail();
if (!email) return { ok: false, reason: 'NO_EMAIL' };
// 再用 email 调 getAccessContextByEmail(email) 等
```

---

## 6. 完整示例与文件索引

- **门禁 Helper（各页面统一用）**：页面只 `import { getAccessContext } from 'backend/access/manage'`，在 onReady/init 里调一次，检查 `ok` / `credit` / 权限；**不要**在页面里调用 wixUsersBackend / wixSecretsBackend。详见 [ACCESS-HELPER.md](./ACCESS-HELPER.md)。
- **完整 manage.jsw 示例**（含 Secret Manager、双重认证、错误处理、getAccessContext / getAccessContextByEmail）：见 [velo-backend-manage.jsw.snippet.js](./velo-backend-manage.jsw.snippet.js)，说明与配置见 [velo-backend-manage.jsw.snippet.md](./velo-backend-manage.jsw.snippet.md)。
- **ECS 侧**认证与 API 说明：见 [docs 总索引](../../index.md) 中「Wix 调用 ECS 与 manage.jsw」「API User / Token」小节。

---

## 7. 返回形状约定（避免前端 type error）

**问题**：若 JSW 的 export 直接 `return` 后端 `postJson()` 的 `data`，可能缺 `ok` / `items` 等字段，前端会报 `Property 'ok' is missing`、`Property 'items' does not exist` 等 type error。

**约定**：每个 export 的返回值**固定形状**，不直接 `return postJson(...)`：

- **失败**：一律 `{ ok: false, reason: string }`（可与后端一致）。
- **成功**：`{ ok: true, ... }` 且**必带**前端会用到的字段；若后端没返回则用兜底（如 `items: []`、`owner: null`）。

**做法**：在 JSW 里写小 helper，例如：

```javascript
function ensureOwnerShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || 'BACKEND_ERROR' };
    return { ok: true, owner: data && data.owner != null ? data.owner : null };
}
function ensureOkItemsShape(data) {
    if (data && data.ok === false) return { ok: false, reason: data.reason || 'BACKEND_ERROR', items: [] };
    return { ok: true, items: Array.isArray(data && data.items) ? data.items : [] };
}
```

每个 export 先 `const data = await postJson(...)`，再 `return ensureXxxShape(data)`。并在文件头注释写明「每个 export 都返回固定形状」。

**参考**：[velo-backend-saas-ownerportal.jsw.snippet.js](./velo-backend-saas-ownerportal.jsw.snippet.js) 已按此约定实现。

---

## 8. IDE 报 "Property 'ok' / 'items' / 'totalCount' does not exist on type 'object'"

**原因**：`postJson()` 返回类型被推断为泛型 `object`，IDE/TypeScript 不知道有 `ok`、`items`、`totalCount` 等字段。

**做法**：对 `await postJson(...)` 的结果做 JSDoc 类型断言，让 `data` 具有声明形状：

```javascript
// 可选：先定义形状
/** @typedef {{ ok?: boolean, reason?: string, items?: any[], totalCount?: number }} CostListResponse */

// 在 export 里对 data 断言
export async function getCostList(opts) {
    const data = /** @type {CostListResponse} */ (await postJson('/api/ownerportal/cost-list', opts || {}));
    if (data && data.ok === false) return { ok: false, reason: data.reason || 'BACKEND_ERROR', items: [], totalCount: 0 };
    return {
        ok: true,
        items: Array.isArray(data && data.items) ? data.items : [],
        totalCount: typeof (data && data.totalCount) === 'number' ? data.totalCount : 0
    };
}
```

凡是对 `data` 做 `data.ok`、`data.items`、`data.xxx` 访问且 IDE 报 "Property does not exist on type 'object'" 的，在该处加 `/** @type {YourShape} */ (await postJson(...))` 即可。

**本目录已审计**：所有 `velo-backend-*.jsw.snippet.js` 均已对 `postJson`/`postEcs` 返回值做 JSDoc `@type` 断言（含 contact、agreementsetting、ownersetting、propertysetting、metersetting、tenancysetting、admindashboard、smartdoorsetting、topup、expenses、tenantinvoice、ownerportal、companysetting 等）。粘贴到 Wix 后不应出现 "Property 'ok' does not exist on type 'unknown'" 等红线。新增或修改 JSW 时请继续遵守 `.cursor/rules/jsw-type-assertions.mdc`。

---

## 9. 小结（下次写 JSW 时对照）

| 项目 | 做法 |
|------|------|
| 放哪里 | Backend 的 .jsw，不要放前端 |
| 凭证 | Secret Manager：`ecs_token`、`ecs_username`、`ecs_base_url`，用 `wixSecretsBackend.getSecret('key')` 读取 |
| 请求 ECS | `fetch` + 两个 header：`Authorization: Bearer <token>`、`X-API-Username: <username>` |
| 错误 | 统一返回 `{ ok: false, reason: 'BACKEND_ERROR' }`，不暴露 ECS 详情 |
| 当前用户 | `wixUsersBackend.currentUser`、`getEmail()`（仅后端） |
| **返回形状** | 每个 export 用 ensureXxxShape(data) 兜底，保证必有 `ok` 及声明字段（如 `items`、`owner`），避免前端 type error |
| **IDE 类型报错** | 对 `const data = await postJson(...)` 加 JSDoc：`/** @type {ExpectedShape} */ (await postJson(...))`，消除 "Property 'xxx' does not exist on type 'object'" |

按以上约定写的 JSW 可直接复用到其他调用 ECS 的 backend 接口。
