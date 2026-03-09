# 门禁 Helper（Access Context）

每个需要「登录 + 有账号 + 有 credit / 权限」的页面，统一用同一个门禁 helper，**页面里不要**调用 `wixUsersBackend`、`wixSecretsBackend`，只调 helper 导出的方法。

---

## 1. Helper 是什么、放哪里

- **文件**：`backend/access/manage.jsw`（或你项目里对应的 backend 模块路径）
- **内容**：见 [velo-backend-manage.jsw.snippet.js](./velo-backend-manage.jsw.snippet.js)，里面包含：
  - `wixUsersBackend` / `wixSecretsBackend` 的引用（仅在此 backend 文件内）
  - `getEcsCreds()`、`fetchWithTimeout()`、`getAccessContextByEmail(email)`、`getAccessContext()`
- **导出给页面用的**：
  - **`getAccessContext()`**：用当前登录用户的 email 请求 ECS `/api/access/context`，返回 `{ ok, reason?, client?, credit?, ... }`
  - （可选）**`getAccessContextByEmail(email)`**：若某处需要指定 email 查 context，可调此方法

页面只从 helper 导入、不直接碰 Secret/User 后端 API。

---

## 2. 每个页面怎么用

1. **只从 helper 导入**（不要从 expenses.jsw 等业务 jsw 拿 access，业务 jsw 不负责门禁）：

```javascript
import { getAccessContext } from 'backend/access/manage';
```

2. **在 onReady / startInitAsync 里调一次**：

```javascript
let accessCtx = null;

async function startInitAsync() {
    accessCtx = await getAccessContext();

    if (!accessCtx.ok) {
        // 未登录 / 无邮箱 / 无账号 / 后端异常
        showAccessDenied(accessCtx.reason || "You don't have account yet");
        return;
    }

    // 可选：检查 credit，无余额时强制进 topup
    if (accessCtx.credit?.ok === false) {
        await enterForcedTopupMode();
        return;
    }

    // 可选：按 permission / client / plan 做页面级权限
    // if (!accessCtx.capability?.expenses) { ... }

    clientCurrency = accessCtx.client?.currency || 'MYR';
    // ... 正常初始化页面
}
```

3. **用到的字段**（由 ECS `/api/access/context` 返回）：

| 字段 | 含义 |
|------|------|
| `ok` | 是否通过门禁（有账号、可访问） |
| `reason` | 不通过时的原因：`NOT_LOGGED_IN`、`NO_EMAIL`、`BACKEND_ERROR`、`TIMEOUT` 等 |
| `client` | 当前 client 信息（如 `currency`） |
| `credit` | 余额/credit 信息，`credit.ok === false` 表示需充值 |
| `capability` / `plan` | 套餐与集成：`capability.accounting` = 主方案是否允许 Accounting；`capability.accountProvider` = 已接的会计系统 provider（有值=已 onboard）；**`capability.accountingReady`** = 已 onboard 且 Account Setting 页所有 item 已 sync（account 模板数与 account_client 已映射数一致）；`capability.accountingSyncedTotal` / `capability.accountingSyncedMapped` = 总模板数 / 已映射数（仅当有 accountProvider 时），可用于显示「3/5 synced」。 |

---

## 3. 和 expenses.jsw 的关系

- **expenses.jsw**：只负责业务接口（getExpenses、insertExpenses、getBankBulkTransferDownloadUrls 等），内部自己用 `getEmail()` + `getEcsCreds()` 请求 ECS，**不导出** `getAccessContext`。
- **门禁**：统一用 **backend/access/manage.jsw** 的 `getAccessContext()`，每个页面在 init 时调一次，判断 `ok` / `credit` / 权限后再跑业务逻辑。

这样「门禁」和「业务接口」分离：页面先过门禁 helper，再调 expenses 等 jsw。
