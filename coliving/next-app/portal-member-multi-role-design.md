# Portal 会员与多身份对接设计

目标：**一个会员（同一登录账号）可以同时拥有多种身份**（员工 / 租客 / 业主 / 主管理员），登录后可选身份进入对应 Portal。

**约定：一个 email 一个会员；所有 email 比较一律不区分大小写**（后端使用 `LOWER(TRIM(email))`）。

---

## 1. 现有表与「身份」的对应关系

| 身份 | 表 | 说明 |
|------|-----|------|
| **员工 (Staff)** | `staffdetail` | 每行：一个员工在一个 client 下的记录。`email` + `client_id`；同一 email 可有多行（多个 client）。当前后端 `getAccessContextByEmail` 只取 **LIMIT 1**，即只认「第一个」client。 |
| **租客 (Tenant)** | `tenantdetail` + `tenant_client` | 一人一行 `tenantdetail`（用 `email` 区分）。`tenant_client(tenant_id, client_id)` 表示该租客被哪些 client 批准。 |
| **业主 (Owner)** | `ownerdetail` + `owner_client` | 一人一行 `ownerdetail`（用 `email` 区分）。`owner_client(owner_id, client_id)` 表示该业主与哪些 client 关联。 |
| **主管理员 (SaaS Admin)** | `clientdetail` | `clientdetail.email` = 该 client 主账号登录邮箱，可视为「该客户公司的主管理员」身份。 |

所以：**同一 email 可以同时出现在 staffdetail（多行）、tenantdetail（至多一行）、ownerdetail（至多一行）、以及多个 clientdetail.email 上**。不需要新表，用 **email 作为「会员」的统一键** 即可。

---

## 2. 「会员」= 同一 email 下的所有身份

- **不新增 `member` 表**：会员 = 用 email 在 staffdetail / tenantdetail / ownerdetail / clientdetail 里查到的所有身份集合。
- **登录流程**：
  1. 用户在 portal 登录（email + 密码或现有鉴权方式）。
  2. 后端用 email 查出该会员的**所有身份**，返回「身份列表」。
  3. 若只有一种身份，可直接进对应 Portal；若多种，前端展示「选择身份」页（如：员工 @ 公司A、员工 @ 公司B、租客、业主、主管理员 @ 公司C），用户选一个后再进对应 Portal。

---

## 3. 后端已提供的接口

### 3.1 拉取当前会员的所有身份（email 不区分大小写）

- **`POST /api/access/member-roles`**  
  - Body：`{ "email": "user@example.com" }`（任意大小写，后端统一按 `LOWER(TRIM(email))` 查）。  
  - 返回示例：

```json
{
  "ok": true,
  "email": "user@example.com",
  "roles": [
    { "type": "staff", "staffId": "uuid", "clientId": "uuid", "clientTitle": "Company A" },
    { "type": "staff", "staffId": "uuid2", "clientId": "uuid2", "clientTitle": "Company B" },
    { "type": "tenant", "tenantId": "uuid" },
    { "type": "owner", "ownerId": "uuid" },
    { "type": "saas_admin", "clientId": "uuid", "clientTitle": "Company A" }
  ]
}
```

已实现（`src/modules/access/access.service.js` 的 `getMemberRoles`）：staff 多行、tenant、owner、saas_admin 均按 `LOWER(TRIM(email))` 查询并汇总为 `roles` 数组。

### 3.2 选定身份后的访问上下文

- **`POST /api/access/context`**  
  Body：`{ "email": "..." }`。行为不变：按 email 取**第一个** staff 行对应的 context（兼容旧 Wix 单 client 用法）。

- **`POST /api/access/context/with-client`**  
  Body：`{ "email": "...", "clientId": "..." }`。按 **email + clientId** 取该会员在该 client 下的 staff context（用于「多身份」时选定「员工 @ 某公司」后进 Operator Portal）。

进入各 Portal 时：**Tenant** 用 tenantId、**Owner** 用 ownerId、**SaaS Admin** 用 clientId；现有 API 已支持。即：**登录 → 拉 member-roles → 选一个 role → 把 (roleType, roleId, clientId?) 写入 session/token → 后续请求都用该身份调现有 API**。

---

## 4. 前端 Portal 流程（对接上述后端）

1. 用户打开 **portal.colivingjb.com** → 重定向到 **/login**。
2. 登录成功（email 已认证）→ 请求 **member-roles**，得到 `roles` 数组。
3. 若 `roles.length === 0`：提示「无可用身份」。
4. 若 `roles.length === 1`：直接跳转到该身份对应入口（如 staff → /operator，tenant → /tenant，owner → /owner，saas_admin → /saas-admin）。
5. 若 `roles.length > 1`：展示「选择身份」页，列出每个 role 的展示名（如「员工 - Company A」「租客」「业主」），用户点击后写 session/token 并跳转到对应 Portal。
6. 进入各 Portal 后，所有请求都带当前身份（如 staffId+clientId 或 tenantId 或 ownerId），后端用现有 staff/tenant/owner 的 API 即可。

---

## 5. 后端已完成的改动（小结）

| 项 | 说明 |
|----|------|
| **email 统一** | 所有会员相关查询使用 `normalizeEmail(email)` = `LOWER(TRIM(email))`，大小写不影响。 |
| **getAccessContextByEmailAndClient** | 已实现；`POST /api/access/context/with-client` 按 email + clientId 取 staff context。 |
| **getMemberRoles** | 已实现；`POST /api/access/member-roles` 返回该 email 下所有 staff/tenant/owner/saas_admin 身份。 |
| **登录/session** | 前端登录后调用 member-roles，用户选定身份后，请求 Operator 相关 API 时传 `email` + `clientId`（或后续用 session/JWT 存 roleType、roleId、clientId）。 |

以上接口均挂在 `/api/access` 下，当前与其它 access 路由一样受 `apiAuth` 保护；若 portal 登录流程需在鉴权前调用 member-roles，可再单独放开或改用 session 校验。
