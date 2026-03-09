# 无数据 / client_id 未回填 — 排查与修复

## client_wixid → client_id 回填（propertydetail、account 等全表）

若库里 **client_wixid 有值但 client_id 为空**，Node 按 client_id 查会拿不到数据。需用 **clientdetail.wix_id** 把各表的 **client_id** 填上。

**做法一（推荐）**：在 ECS 上执行脚本（自动跳过不存在的表）：

```bash
cd /home/ecs-user/app && node scripts/backfill-client-id-from-wixid.js
```

**做法二**：用 SQL 迁移一次性更新（某表不存在会整段报错，可先删掉不需要的 UPDATE 再跑）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs) && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0021_backfill_client_id_from_wixid.sql
```

涉及的表：tenantdetail, client_integration, client_profile, client_pricingplan_detail, client_credit, agreementtemplate, gatewaydetail, lockdetail, ownerdetail, meterdetail, **propertydetail**, roomdetail, ownerpayout, rentalcollection, **staffdetail**, agreement, cnyiottokens, parkinglot, pricingplanlogs, ttlocktoken, **account**, creditplan, **bills**, tenancy, **supplierdetail**。

---

# #repeaterexpenses / #dropdownproperty / #dropdowntype 无数据 — 排查步骤

前端和后端**对接是对的**（getExpensesFilters → POST /api/expenses/filters，getExpenses → POST /api/expenses/list）。无数据、无选项多半是下面某一环出问题。

---

## 1. 先确认：Node 能收到请求并返回 200

在 **ECS 上**看 Node 是否在跑、有没有报错：

```bash
# 看进程
ps aux | grep node

# 若用 pm2
pm2 logs
```

用浏览器开发者工具 **Network**：打开 Wix 站、登录、点进 Expenses，看是否有发到你家 Node 的请求（例如 `https://你的域名/api/expenses/filters`、`/api/expenses/list`）。  
若完全没有这类请求，说明是 **Wix 后端没调到 Node**（见下节）。

---

## 2. Wix 后端必须带「当前登录用户 email」调 Node

- `backend/saas/expenses.jsw` 里用 `wixUsersBackend.currentUser.getEmail()` 取邮箱，再在 body 里带 `email` 调 Node。
- 若用户**未登录**，getEmail() 为 null，postEcs 直接 return null → 前端拿到的是 `{ properties: [], types: [], suppliers: [] }` 和 `{ items: [] }`，所以下拉和列表都是空的。

**你要做的**：确认在 Wix 站里是**已登录**状态再进 Expenses 页。

---

## 3. Node 用「email → staff → client」鉴权，必须能查到 client

Node 里：

- `POST /api/expenses/filters` 和 `POST /api/expenses/list` 都会用 body 里的 `email` 调 `getAccessContextByEmail(email)`。
- 会查 **MySQL `staffdetail`**：`WHERE LOWER(TRIM(email)) = ?`，取 `client_id`。
- 若**没有这条 staff** → 返回 403（NO_STAFF），JSW 里 res.ok 为 false，postEcs 返回 null → 前端仍是空。
- 若有 staff 但 **client_id 为空** → 返回 403（NO_CLIENT），同样前端空。

所以：**当前登录用的这个邮箱，必须在 MySQL `staffdetail` 表里存在，且 `client_id` 指向有效客户。**

在 ECS 上查一下（把邮箱换成你登录用的）：

```bash
cd /home/ecs-user/app && export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT id, email, client_id FROM staffdetail WHERE LOWER(TRIM(email)) = LOWER(TRIM('你的登录邮箱'));
"
```

若有行且 `client_id` 非 NULL，Node 才能返回该 client 的 properties/types/expenses。

---

## 4. 下拉有「All」但没具体选项 / 列表一直空

说明 Node 已 200，但：

- **properties 空**：该 `client_id` 在 **`propertydetail`** 里没有数据。
- **types 空**：该 `client_id` 在 **`bills`** 里没有记录（types 是从 bills + account 查出来的）。
- **items 空**：该 `client_id` 在 **`bills`** 里没有数据。

在 ECS 上查（把 `你的client_id` 换成上面查到的 client_id）：

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e "
SELECT COUNT(*) AS property_count FROM propertydetail WHERE client_id = '你的client_id';
SELECT COUNT(*) AS bills_count FROM bills WHERE client_id = '你的client_id';
"
```

若都是 0，就需要给这个 client 导入/录入 propertydetail 和 bills 数据。

---

## 5. Wix 密钥与 Node 地址（最常见原因）

`backend/saas/expenses.jsw` 会读 Secret Manager 里的：

- **`ecs_base_url`**：必须是 **Wix 服务器能从公网访问到的地址**，例如 `https://你的域名.com` 或 `https://ECS公网IP:3000`。**不能**填 `http://localhost:3000`，因为 Wix 后端跑在 Wix 机房，访问不到你本机或 ECS 的 localhost。
- `ecs_token`、`ecs_username`：Node 要求的鉴权（与 access/billing 相同）。

若 baseUrl 错、未设、或 Node 未对公网开放，postEcs 会失败（return null），前端拿到带 `_error: 'NO_RESPONSE'` 的空数据。

**在 ECS 上自测 Node 是否正常**（用你在 Wix 里填的 ecs_token、ecs_username）：

```bash
curl -s -X POST http://localhost:3000/api/expenses/filters \
  -H "Content-Type: application/json" \
  -d '{"email":"starcity.shs@gmail.com"}' \
  -H "Authorization: Bearer 你的ecs_token" \
  -H "X-API-Username: 你的ecs_username"
```

若返回 200 且 JSON 里带 `properties` 数组，说明 Node 和数据库都正常，问题在 **Wix → 公网 Node**（ecs_base_url 必须是 Wix 能访问的地址，且 ECS 安全组/防火墙放行 3000 或你的端口）。

---

## 6. 前端：显示「无法连接后台」并打日志

JSW 在请求 Node 失败（超时、4xx、网络不可达）时会返回带 `_error: 'NO_RESPONSE'` 的空数据。前端可以据此提示用户。

在 **setupExpensesFilters** 里、`getExpensesFilters()` 之后加上：

```javascript
async function setupExpensesFilters() {
    const res = await getExpensesFilters();
    if (res._error === 'NO_RESPONSE') {
        console.warn('Backend returned no data. Check Wix Secret ecs_base_url and that Node is reachable.');
        // 可选：在页面上显示（需有一个 Text 元素，例如 #textfiltererror）
        $w('#text19').text = 'Cannot load filters. Check ecs_base_url (Wix Secret) and that Node is reachable from the internet.';
        $w('#text19').show();
    }
    const properties = res.properties || [];
    const types = res.types || [];
    // ... 后面不变（设置 dropdown 等）
}
```

在 **loadExpensesPage** 里、`getExpenses()` 之后若也要提示列表失败，可加：

```javascript
const res = await getExpenses({ ... });
if (res._error === 'NO_RESPONSE') {
    console.warn('getExpenses: backend no response');
}
currentFilteredExpenses = res.items || [];
```

**Console 里看返回**：

- `getExpensesFilters result: { properties: [], types: [], suppliers: [], _error: 'NO_RESPONSE' }` → **Wix 调 Node 失败**：ecs_base_url 不可达、或 Node 未对公网开放、或 token/username 错。
- `getExpensesFilters result: { properties: [], types: [], suppliers: [] }`（无 _error）→ 未登录、或 Node 403、或该 client 确实没有 property/type。
- `getExpenses result: { items: [], ..., _error: 'NO_RESPONSE' }` → 同上，列表接口也连不上 Node。

---

## 小结

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 下拉、列表都空 | 未登录 / JSW 未带 email | 确认已登录；看 Network 是否请求到 Node |
| 下拉、列表都空 | Node 403 | 查 staffdetail 是否有该 email 且 client_id 有值 |
| 下拉只有 All、列表空 | Node 200 但数据空 | 查 propertydetail、bills 是否有该 client_id 的数据 |
| 完全没请求到 Node | ecs_base_url 错/未设、或 Node 未跑 | 检查 Wix Secret、ECS 上 Node 进程 |

按上面顺序查一遍，再配合前端那两行 `console.log`，就能确定是「没请求」「403」还是「200 但没数据」。
