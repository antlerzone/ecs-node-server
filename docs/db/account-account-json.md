# account 表与 account_json 说明

## 0) 查询性能：account_client 联结表

除 **account_json** 外，增加了 **account_client** 联结表（account_id, client_id, `system`, accountid, product_id），并建了 **INDEX(client_id)**。  
ECS 查询顺序：**先按 client_id 在 account_client 上做 JOIN**（走索引），再带出 account 行，避免全表扫描 account 再逐行解析 JSON，所以更快。  
写入时同时更新 **account_json** 与 **account_client**；若尚未跑 0052 迁移，仅更新 account_json 仍可工作。  
表 **account** 上已不再保留列 accountid、productid（见迁移 0051），仅 account_json / account_client 里存 per-client 的 accountid/product_id。

- 迁移：**0052_account_client_junction.sql**
- 回填：`node scripts/backfill-account-client.js`（从现有 account_json 填入 account_client）

---

## 1) 多个 client 可以一起写进去吗？

**可以。** 每一行 `account` 是**一个模板**（例如 "Rent Income"）；该行的 **`account_json`** 是一个数组，里面可以有多条「client + 系统 + 账户」的映射；**account_client** 表则用多行表示同一逻辑（相当于 junction：多个 client 对应同一模板）。

- 每个 client 在该模板下最多一条**同一 system** 的映射（同 client + 同 system 会先删后插，相当于 upsert）。
- 写入时会从 **client_wixid / clientId** 映射到 **clientdetail.id**，在 JSON 里存 **client_id**（以及 clientId 兼容）。

---

## 2) 支持多个系统 (xero / bukku / autocount / sql) 吗？

- **允许的系统**：`xero`、`bukku`、`autocount`、`sql`。访客的 client 在 **client_integration** 里配置了哪个 provider，**才允许把该 system 写进 account_json**；否则返回 `SYSTEM_MISMATCH`。
- **Sync（列表 + 按 title 映射 + 没有则创建）**：目前只有 **Bukku** 和 **Xero** 有实现：
  - **Bukku**：用 Bukku account/product wrapper list + create，accountid/productId 来自 API 返回。
  - **Xero**：用 Xero account wrapper list + create，accountid 来自 API 的 AccountID。
  - **AutoCount / SQL**：没有 account wrapper 与 API 对接，Sync 不可用；用户仍可在页面**手动输入** accountid 后保存，写入的 JSON 内容就是用户填的值。

---

## 3) account_json 示例 (sample value)

```json
[
  {
    "clientId": "mysql-client-id-uuid",
    "client_id": "mysql-client-id-uuid",
    "system": "xero",
    "accountid": "xero-account-id-abc",
    "productId": ""
  },
  {
    "clientId": "another-client-id",
    "client_id": "another-client-id",
    "system": "bukku",
    "accountid": "bukku-account-123",
    "productId": "bukku-product-456"
  }
]
```

- **clientId / client_id**：一律用 MySQL `clientdetail.id`；保存时由后端从当前访客 client 解析并写入。
- **system**：必须等于该 client 的 account integration provider（xero/bukku/autocount/sql）。
- **accountid**：该系统中对应的账户 ID。**来源**：Bukku/Xero 走 Sync 时 = 各自 **account wrapper** 的 API 返回值（Bukku 的 account.id，Xero 的 AccountID）；AutoCount/SQL 或手动保存 = 用户在表单里填写的值。
- **productId**：仅当 **type = product** 时使用（目前仅 Bukku Sync 会写）；见下文。

---

## 4) Default item 是哪个？title 列表

**Default items** = **当前 `account` 表里的行**（模板列表）。不再以 0046 种子为唯一来源——若你已用 bukkuid.csv 覆盖或手动改过表，以表为准。

在项目根目录执行：

```bash
node scripts/list-account-titles.js
```

输出即为当前 default items 的 id / title / type；把输出的 **Titles only** 复制到下文或你的文档即可。

示例（表里实际数据可能不同）：

| title |
|--------|
| (以 list-account-titles.js 输出为准) |

---

## 5) type = product 时有什么功能？

当 **account.type = product**（或前端筛选「Product」）时：

- 该模板对应 Bukku 的 **Product/Service**，需要同时绑定 **账户 (accountid)** 和 **产品 (productId)**。
- 前端会显示 **Product ID** 输入框（`#inputproductid`），保存时把 **productId** 一并写入 **account_json** 的对应项。
- Sync Bukku 时会为该模板创建/关联 Bukku product，并把 productId 写回 account_json。

非 product 类型的模板只需 accountid，productId 可为空。
