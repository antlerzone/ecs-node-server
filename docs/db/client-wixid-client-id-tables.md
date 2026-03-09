# 含 client_wixid & client_id 的表 / client 相关 FK 与 Junction

约定：**一律用 `client_id` 做关联**，`client_wixid` 仅用于导入/迁移/对历史数据。

---

## 一、同时有 client_wixid + client_id 且 FK → clientdetail 的表

| 表名 | client_wixid | client_id | FK 约束 |
|------|--------------|-----------|---------|
| tenantdetail | ✓ | ✓ | fk_tenantdetail_client → clientdetail(id) |
| client_integration | ✓ | ✓ | fk_client_integration_client → clientdetail(id) |
| client_profile | ✓ | ✓ | fk_client_profile_client → clientdetail(id) |
| client_pricingplan_detail | ✓ | ✓ | fk_client_pricingplan_detail_client → clientdetail(id) |
| client_credit | ✓ | ✓ | fk_client_credit_client → clientdetail(id) |
| agreementtemplate | ✓ | ✓ | fk_agreementtemplate_client → clientdetail(id) |
| gatewaydetail | ✓ | ✓ | fk_gatewaydetail_client → clientdetail(id) |
| lockdetail | ✓ | ✓ | fk_lockdetail_client → clientdetail(id) |
| ownerdetail | ✓ | ✓ | fk_ownerdetail_client → clientdetail(id) |
| meterdetail | ✓ | ✓ | fk_meterdetail_client → clientdetail(id) |
| propertydetail | ✓ | ✓ | fk_propertydetail_client → clientdetail(id) |
| roomdetail | ✓ | ✓ | fk_roomdetail_client → clientdetail(id) |
| ownerpayout | ✓ | ✓ | fk_ownerpayout_client → clientdetail(id) |
| rentalcollection | ✓ | ✓ | fk_rentalcollection_client → clientdetail(id) |
| staffdetail | ✓ | ✓ | fk_staffdetail_client → clientdetail(id) |
| agreement | ✓ | ✓ | fk_agreement_client → clientdetail(id) |
| cnyiottokens | ✓ | ✓ | fk_cnyiottokens_client → clientdetail(id) |
| parkinglot | ✓ | ✓ | fk_parkinglot_client → clientdetail(id) |
| pricingplanlogs | ✓ | ✓ | fk_pricingplanlogs_client → clientdetail(id) |
| ttlocktoken | ✓ | ✓ | fk_ttlocktoken_client → clientdetail(id) |
| supplierdetail | ✓ | ✓ | fk_supplierdetail_client（0027 加）→ clientdetail(id) |
| account | ✓ | ✓ | fk_account_client（0047 加）→ clientdetail(id) |

---

## 二、Junction / 多对多表（仅 client_id，无 client_wixid）

| 表名 | 主键/唯一 | client_id FK | 说明 |
|------|-----------|--------------|------|
| **account_client** | (account_id, client_id, system) | → clientdetail(id) | account ↔ client 多对多，按 client 查 account 用 |
| **owner_client** | (owner_id, client_id) 或 id | → clientdetail(id) | ownerdetail ↔ client 多对多，Profile Contact 用 |
| **tenant_client** | (tenant_id, client_id) | → clientdetail(id) | tenantdetail ↔ client 多对多，Profile Contact 用 |

---

## 三、仅有 client_id（无 client_wixid）且 FK → clientdetail 的表

| 表名 | client_id | 说明 |
|------|-----------|------|
| refunddeposit | ✓ | 0045 加 client_id |
| feedback | ✓ | 0038 建表 |
| ticket | ✓ | 0031 help/faq/ticket |
| creditlogs | ✓ | 0030 建表 |

---

**汇总**  
- **有 client_wixid + client_id 的业务表**：上表「一」共 22 张。  
- **纯 Junction（仅 client_id）**：account_client、owner_client、tenant_client。  
- **仅 client_id**：refunddeposit、feedback、ticket、creditlogs。

---

## 四、可以「多个 client 一起写在里面」的结构（多 client 共用）

项目里**没有**名为 `owner_account`、`tenant_account` 的表；多 client 共用是通过以下方式实现的。

### 4.1 联系人上的 account 列（一个 owner/tenant/supplier 对应多个 client 的 account id）

| 表 | 列 | 格式 | 是否多 client 写在一起 |
|----|-----|------|------------------------|
| **ownerdetail** | account | TEXT JSON | **是**。`[{ clientId, provider, id }]`，同一行里可有多条，每条一个 client + 该 client 的 Bukku/Xero contact id。 |
| **tenantdetail** | account | TEXT JSON | **是**。同上，一个租客在不同 client 下可有不同 account id。 |
| **supplierdetail** | account | TEXT JSON | **是**。同上（0044 加），一个供应商在不同 client 下可有不同 id。 |

- 读写时按「当前访客的 clientId + provider」合并：同 (clientId, provider) 只保留一条，其余 client 的条目保留，所以**多个 client 可以共存在同一个 account 数组里**。
- API：Owner 用 `POST /api/contact/owner/update-account`，Tenant 用 `POST /api/contact/tenant/update-account`。

### 4.2 会计科目 account 表 + account_client（一个科目模板对应多个 client）

| 表 | 说明 | 是否多 client 共用 |
|----|------|-------------------|
| **account** | 科目模板（如 "Rent Income"），一行一个模板。 | **是**。同一行可被多个 client 使用。 |
| **account.account_json** | JSON 数组，每项 `{ clientId, client_id, system, accountid, productId }`。 | **是**。多个 client 的映射写在同一数组。 |
| **account_client** | Junction：(account_id, client_id, system) + accountid, product_id。 | **是**。多行 = 同一 account 模板被多个 client 使用，每个 client 可有自己的 accountid/product_id。 |

- 见 `docs/db/account-account-json.md`：一个 account 行是「一个模板」，多个 client 可在同一模板下各有自己的 accountid/product_id（通过 account_json 或 account_client 表示）。

### 4.3 Junction 表：一个 owner/tenant 对应多个 client（多对多）

| 表 | 含义 | 是否多 client |
|----|------|----------------|
| **owner_client** | (owner_id, client_id) 唯一。一个 owner 可出现在多个 client 的 Contact 里。 | **是**。同一 owner 多行 = 多个 client_id。 |
| **tenant_client** | (tenant_id, client_id) 主键。一个 tenant 可被多个 client 批准。 | **是**。同一 tenant 多行 = 多个 client_id。 |

- 这里表示的是「该 owner/tenant 属于哪些 client」，不是「account 列里写多个 client」；account 列是上面 4.1 的 JSON。
