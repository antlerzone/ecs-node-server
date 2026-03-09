# 前端显示 "You don't have account yet" 排查

当 Wix 前端在 `startInitAsync()` 里调用 `getAccessContext()` 后，若 `accessCtx.ok === false`，会显示 "You don't have account yet"。  
**真正原因在 `accessCtx.reason`**，需要根据 reason 排查。

---

## 1. 先看前端拿到的 reason（调试用）

在 `startInitAsync()` 里暂时改成**把 reason 显示或打日志**，方便确认是哪种情况：

```javascript
accessCtx = await getAccessContext();

if (!accessCtx.ok) {
    // 调试：把后端返回的 reason 显示出来（上线前可改回通用文案）
    const msg = accessCtx.reason
        ? `You don't have account yet (${accessCtx.reason})`
        : 'You don\'t have account yet';
    showAccessDenied(msg);
    return;
}
```

或在 `showAccessDenied(message)` 之前加一行：

```javascript
console.log('Access denied:', accessCtx.reason);
```

---

## 2. reason 含义与对应处理

| reason | 含义 | 处理方向 |
|--------|------|----------|
| **NOT_LOGGED_IN** | Wix 当前用户未登录 | 用户需在 Wix 站点登录 |
| **NO_EMAIL** | 已登录但取不到 email | 检查 Wix 用户是否绑定了邮箱 |
| **TIMEOUT** | 请求 ECS 超时（约 15s） | 查 ECS 是否可达、网络/防火墙 |
| **BACKEND_ERROR** | ECS 返回非 2xx / 响应解析失败 / 网络或 CORS 问题 | 见下方「BACKEND_ERROR 专项排查」 |
| **NO_STAFF** | MySQL 里**没有**该 email 的 staff | 见下方「starcity.shs@gmail.com 排查」 |
| **STAFF_INACTIVE** | staff 存在但 status ≠ 1 | 把该 staff 的 status 设为 1 |
| **NO_CLIENT** | staff 的 client_id 为空 | 给该 staff 填上 client_id |
| **CLIENT_NOT_FOUND** | client_id 在 clientdetail 里不存在 | 补全 client 数据或修正 client_id |
| **CLIENT_INACTIVE** | client 的 status ≠ 1 | 把对应 clientdetail.status 设为 1 |
| **NO_PERMISSION** | staff 的 permission_json 无任何权限 | 给该 staff 至少一个权限（或 admin） |

---

## 3. BACKEND_ERROR 专项排查

**BACKEND_ERROR** 表示 Wix 的 manage.jsw 请求 ECS 时：要么拿到的 HTTP 状态不是 2xx，要么 `res.json()` 解析失败，要么请求抛错（网络/超时会走 TIMEOUT）。按下面顺序查。

### 3.1 确认 ECS 用的是哪个入口（是否要带 token）

项目里有两个入口：

| 文件      | 端口 (默认) | `/api/access` 是否要认证 |
|-----------|-------------|---------------------------|
| **app.js**  | 3000        | **否**，只收 body `{ email }` |
| **server.js** | 5000     | **是**，需要 `Authorization: Bearer <token>` 和 `X-API-Username: <username>` |

- 若线上跑的是 **server.js**，Wix Secret Manager 里 **ecs_token**、**ecs_username** 必须和 MySQL `api_user` 表里某条记录的 `token`、`username` 一致，否则 ECS 返回 401，JSW 会得到 **BACKEND_ERROR**。
- **ecs_base_url** 必须指向当前实际提供 `/api/access` 的地址（含协议和端口，如 `https://api.example.com` 或 `http://your-ecs-ip:5000`），不要末尾斜杠。

### 3.2 用 curl 直接测 ECS

在 ECS 本机或能访问 ECS 的机器上执行（把 `BASE` 换成你的 ecs_base_url）：

**若用的是 app.js（不鉴权）：**

```bash
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE/api/access/context" \
  -H "Content-Type: application/json" \
  -d '{"email":"starcity.shs@gmail.com"}'
```

**若用的是 server.js（需鉴权）：**

```bash
# 先查一个 api_user 的 token、username（或用你已知的）
# 然后：
curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE/api/access/context" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的token" \
  -H "X-API-Username: 你的username" \
  -d '{"email":"starcity.shs@gmail.com"}'
```

看输出：若是 JSON 且含 `"ok":true` 或 `"ok":false`，且 HTTP_CODE 为 200，说明 ECS 正常；若 HTTP_CODE 为 401，说明 token/username 错误或未带；若 500，看 ECS 进程日志（Node 报错）。

### 3.3 CORS（若 Wix 站点域名和 app.js 里配的不一致）

**app.js** 里 CORS 写死了：

```javascript
origin: ['https://www.colivingjb.com']
```

若你的 Wix 站点不是 `https://www.colivingjb.com`（例如是预览域名或别的子域），浏览器会 CORS 拦掉，前端拿不到 2xx 响应，可能表现为 **BACKEND_ERROR**。解决：在 `app.js` 的 `cors({ origin: [...] })` 里加上你 Wix 站点的真实域名，或临时改成 `origin: true` 做验证。

### 3.4 检查 Wix Secret Manager

在 Wix 后台 → Secret Manager 确认：

- **ecs_token**：和 `api_user.token` 一致（若用 server.js）
- **ecs_username**：和 `api_user.username` 一致（若用 server.js）
- **ecs_base_url**：和实际 ECS 地址一致（如 `https://api.colivingjb.com`），**无末尾 `/`**

manage.jsw 会用这三个值发请求；任一项错都会导致 4xx 或连不上，从而 **BACKEND_ERROR**。

---

## 4. 针对具体 email（如 starcity.shs@gmail.com、democoliving@gmail.com）

若 reason 是 **NO_STAFF**，说明 **MySQL `staffdetail` 表里没有这条 email**（按「小写 + trim」匹配）。

**快速修復（推薦）：** 在 ECS 上執行腳本，為該 email 建立或修復 staff 並綁定 client：

```bash
node scripts/ensure-staff-for-email.js democoliving@gmail.com
```

不傳第二參數時：若 `clientdetail` 已有該 email 的 client（如從 enquiry 註冊），則綁到該 client 並將 client status 設為 1；否則綁到 demo client（需先執行過 `node scripts/seed-demo-account.js`）。也可手動指定 clientId：`node scripts/ensure-staff-for-email.js democoliving@gmail.com a0000001-0001-4000-8000-000000000001`。

**手動排查：** 在 ECS 上查：

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id, email, status, client_id, permission_json
FROM staffdetail
WHERE LOWER(TRIM(email)) = 'starcity.shs@gmail.com';
"
```

- **0 行**：需要新增一条 staff，或把现有某条 staff 的 `email` 改成該 email，并保证 `status = 1`、`client_id` 指向有效的 `clientdetail.id`，且 `permission_json` 里有至少一个权限（如 `["admin"]`）。
- **有行但 status = 0**：改为 `status = 1`。
- **有行但 client_id 为 NULL**：改为有效的 `clientdetail.id`。
- **CLIENT_INACTIVE**：若該 staff 的 client 是從 enquiry 建立的，client 預設 status=0；可 `UPDATE clientdetail SET status = 1 WHERE id = ?` 啟用，或執行上述腳本（會自動把該 email 對應的 client 設為 status=1）。

新增/修改后，前端再登录用該 email 调一次 `getAccessContext()`，应得到 `ok: true`（前提是 Wix 登录的邮箱与该 email 一致）。

---

## 5. 流程小结

1. 前端：`getAccessContext()` → Wix backend **manage.jsw** → `getAccessContextByEmail(email)` → **POST ECS `/api/access/context`**，body `{ email }`。
2. ECS：`getAccessContextByEmail(email)` 查 **staffdetail**（`LOWER(TRIM(email)) = ?`）→ 再查 client、权限、credit 等，返回 `{ ok, reason, staff?, client?, ... }`。
3. 前端：若 `!accessCtx.ok` 就显示 "You don't have account yet"；**真实原因在 `accessCtx.reason`**，按上表与 MySQL 数据排查即可。
