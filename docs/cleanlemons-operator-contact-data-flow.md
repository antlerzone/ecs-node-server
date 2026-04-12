# Cleanlemons Operator Contacts：表、Portal 与会计集成

说明 `/operator/contact` 创建联系人时数据如何写入 `cln_employeedetail` / `cln_clientdetail`、与 `portal_account` 的关系，以及已启用 Accounting 集成时的远端同步。

## 无 Portal 时 Operator 建档

- **客户（权限 `clients`）**：写入 `cln_clientdetail` + `cln_client_operator`。`INSERT` **不含** `portal_account_id`；顾客可以尚未注册 Portal。
- **员工类（staff / driver / dobi / supervisor）**：写入 `cln_employeedetail` + `cln_employee_operator`。**不会**写入 `cln_clientdetail`（客户与员工分表）。

实现：`src/modules/cleanlemon/cleanlemon-cln-domain-contacts.js` — `createClientContactDomain`、`createEmployeeContactDomain`。

## 先建档、后用同一邮箱开 Portal

若 `cln_clientdetail` 已有该邮箱一行，顾客在 `portal.cleanlemons.com` 注册/登录后，Provisioning 通常 **UPDATE** 该行并补上 `portal_account_id`，**不会**再 `INSERT` 第二条主档。

实现：`src/modules/portal-auth/portal-detail-ensure.service.js` — `ensureCleanlemonsClnClientdetail`（按 email 查：0 行则 INSERT；1 行则 UPDATE；多行则打日志且不自动合并）。

资料同步：`src/modules/portal-auth/portal-auth.service.js` — `updatePortalProfile` 对 `cln_clientdetail` 同样先按 email 查找再 UPDATE / INSERT。

## Accounting 集成（Bukku / Xero / AutoCount / SQL）

**前提**：`getClnAccountProviderForOperator`（`src/modules/cleanlemon/cleanlemon.service.js`）在 `cln_operator_integration` 中能找到 `key` 为 `Account` 或 `addonAccount` 且 `enabled = 1` 的 provider。

**创建联系人时**：在本地插入完成后，若未设置 `skipAccountingPush`，会调用 `pushEmployeeAccounting` / `pushClientAccounting`（`cleanlemon-cln-domain-contacts.js`），内部调用 `contact-sync.service.js` 的 `ensureContactInAccounting`：**按已有 id 或 email/姓名在会计系统 find-or-create**，将返回的远端 contact id 通过 `mergeAccountEntry` 写入：

- `cln_employeedetail.account`
- `cln_clientdetail.account`

JSON 数组元素形如：`{ clientId: <operator_id>, provider, id: <远端 id> }`。

**角色**：员工类 → 会计侧 `staff`（如 Bukku employee）；客户类 → `tenant`（如 Bukku customer）。

**失败**：外层 `try/catch` 仅记录日志，**不撤销**本地插入；可后续用 `syncClnContactsToAccounting` 等补推。

## 关键文件

| 主题 | 文件 |
|------|------|
| Operator 创建联系人 | `src/modules/cleanlemon/cleanlemon-cln-domain-contacts.js` |
| Portal 补链 `cln_clientdetail` | `src/modules/portal-auth/portal-detail-ensure.service.js` |
| 会计 find-or-create | `src/modules/contact/contact-sync.service.js` — `ensureContactInAccounting` |
| 运营商会计 provider 解析 | `src/modules/cleanlemon/cleanlemon.service.js` — `getClnAccountProviderForOperator` |
