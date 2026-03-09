database design (draft)
=======================

> **数据已在 MySQL，不再使用 Wix CMS。** 本文件为库表设计草稿，原 Wix 集合与字段对应关系仅作历史迁移参考。  
> **约定：** 若在 Wix 代码里看到 CMS 集合名或 fieldkey 但不确定对应哪张表/哪一列，**先与维护者确认**再写代码。  
> 要求：  
> - **所有 mysql 的表名和字段名一律小写**  
> - **所有表统一使用 uuid 作为主键（`id varchar(36)`）**  
> - **所有表统一包含 `created_at` / `updated_at` 字段，并自动写入时间**  
> - **保留 wix 原始 `_id` 到 `wix_id` 字段，方便迁移与追踪**  
> - **所有“客户”引用统一：`client_id` (fk → clientdetail.id) + `client_wixid`（原 Wix client _id，导入/同步用）**  
> 下面先从 `tenantdetail` 和 `clientdetail` 开始，如果后续有新需求再扩展。

## tenantdetail

来源：原 Wix TenantDetail 集合（现数据在 MySQL）。  
用途：存储每个租客（tenant）的基础资料和收款账户信息。

### 建议 mysql 表：`tenantdetail`

字段（初稿）：

- `id` (pk)  
  - 类型：`varchar(36)`（统一使用 uuidv4，新生成）
- `wix_id`  
  - 类型：`varchar(36)`（保存原 wix `_id`，用于迁移与追踪）
- `client_id` (fk)  
  - 类型：`varchar(36)`  
  - 说明：关联到 `clientdetail.id`（原 TenantDetail.client 引用）
- `fullname`  
  - 类型：`varchar(255)`
- `nric`  
  - 类型：`varchar(50)`
- `address`  
  - 类型：`text` 或 `varchar(500)`
- `phone`  
  - 类型：`varchar(50)`
- `email`  
  - 类型：`varchar(255)`
- `bank_name_id` (fk)  
  - 类型：`varchar(36)`  
  - 说明：对应原 TenantDetail.bankName 引用 bankdetail
- `bank_account`  
  - 类型：`varchar(100)`
- `accountholder`  
  - 类型：`varchar(255)`
- `nricfront`  
  - 类型：`varchar(255)`（通常是文件 url 或文件 id）
- `nricback`  
  - 类型：`varchar(255)`（同上）
- `contact_id`  
  - 类型：`varchar(100)`（如有外部系统 contact id）
- `created_at`  
  - 类型：`datetime`（映射 `_createdDate`，默认 `CURRENT_TIMESTAMP`）
- `updated_at`  
  - 类型：`datetime`（映射 `_updatedDate`，默认 `CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`）

> 备注：原 `_id` 映射到 `wix_id`，mysql 的 `id` 为新的 uuidv4。  
> `_createdDate` / `_updatedDate` 映射为标准的 `created_at` / `updated_at`，并由数据库默认值自动维护。

## clientdetail

来源：原 Wix clientdetail 集合（现数据在 MySQL）。  
用途：saas client（公司级账号）的主记录，包括邮箱、套餐、integration、credit 等。

### 建议 mysql 表：`clientdetail`

字段（初稿）：

- `id` (pk)  
  - 类型：`varchar(36)`（统一使用 uuidv4，新生成）
- `wix_id`  
  - 类型：`varchar(36)`（保存原 wix `_id`）
- `title`  
  - 类型：`varchar(255)`
- `email`  
  - 类型：`varchar(255)`
- `status`  
  - 类型：`tinyint(1)`（布尔，1=启用，0=停用）
- `subdomain`  
  - 类型：`varchar(100)`
- `expired`  
  - 类型：`datetime`（主套餐到期时间）
- `pricingplanid` (fk)  
  - 类型：`varchar(36)`（引用 `pricingplan.id`）
- `currency`  
  - 类型：`varchar(10)`（默认货币）
-- `created_at`  
  - 类型：`datetime`（默认 `CURRENT_TIMESTAMP`）
-- `updated_at`  
  - 类型：`datetime`（默认 `CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`）

> 原 clientdetail 的 status、expired、pricingplanid、currency 等统一小写处理。  
> 集合中的数组字段与复杂结构会拆到子表。

**可选（migration 0002）**：为 clientdetail 增加四列 `integration`、`profile`、`pricingplandetail`、`credit`（TEXT），用于在主表存 JSON；服务 `syncSubtablesFromClientdetail` 可据此从主表同步到 4 张子表。详见 [import-clientdetail.md](./import-clientdetail.md)。

### clientdetail 相关子表（拆分数组 / 对象）

#### 1) client_integration

来源：`clientdetail.integration` (array)。

示例：

```json
[
  {
    "enabled": true,
    "key": "paymentGateway",
    "version": 2,
    "values": {
      "provider": "payex",
      "payex_secretKey": "23",
      "payex_username": "33"
    },
    "slot": 0
  },
  {
    "enabled": true,
    "key": "meter",
    "version": 3,
    "values": {
      "provider": "cnyiot",
      "cnyiot_username": "0003654536",
      "cnyiot_password": "11223366"
    },
    "slot": 0
  },
  {
    "enabled": true,
    "key": "smartDoor",
    "version": 3,
    "values": {
      "provider": "ttlock",
      "ttlock_username": "Colivingmanagement@gmail.com",
      "ttlock_password": "Coliving12345*"
    },
    "slot": 0
  },
  {
    "enabled": true,
    "key": "addonAccount",
    "version": 1,
    "values": {
      "provider": "bukku",
      "bukku_secretKey": "xxx",
      "bukku_subdomain": "colivingmanagement"
    },
    "einvoice": true,
    "slot": 0
  }
]
```

建议 mysql 表：`client_integration`

- `id` (pk) `varchar(36)`
- `client_id` (fk) `varchar(36)` → `clientdetail.id`
- `key` `varchar(50)`（如 `paymentGateway` / `meter` / `smartDoor` / `addonAccount`）
- `version` `int`
- `slot` `int`
- `enabled` `tinyint(1)`
- `provider` `varchar(50)`（如 payex / cnyiot / ttlock / bukku）
- `values_json` `json`（保留原始 `values` 对象，方便以后扩展）
- `einvoice` `tinyint(1)` nullable
- `created_at` `datetime`
- `updated_at` `datetime`

> payex 后续废弃时，可以只禁用对应行或迁移到 stripe 的 provider 配置。

#### 2) client_profile

来源：`clientdetail.profile` (array，通常只有一个元素)。

示例：

```json
[
  {
    "tin": "1234",
    "contact": "60198579627",
    "subdomain": "colivingmanagement",
    "accountHolder": "coliving management sdn bhd",
    "ssm": "202401016012",
    "currency": "SGD",
    "address": "",
    "accountNumber": "3241919225",
    "bankId": "677a9538-f6db-4378-94ab-48adc854ae44"
  }
]
```

建议 mysql 表：`client_profile`

- `id` (pk) `varchar(36)`
- `client_id` (fk) `varchar(36)`
- `tin` `varchar(50)`
- `contact` `varchar(50)`
- `subdomain` `varchar(100)`
- `accountholder` `varchar(255)`
- `ssm` `varchar(50)`
- `currency` `varchar(10)`
- `address` `text`
- `accountnumber` `varchar(100)`
- `bank_id` `varchar(36)`（引用 `bankdetail.id`）
- `created_at` `datetime`
- `updated_at` `datetime`

> 未来如果一个 client 支持多个 profile（多个公司主体），此表天然可以扩展为一对多。

#### 3) client_pricingplan_detail

来源：`clientdetail.pricingplandetail` (array)。

示例：

```json
[
  {
    "type": "plan",
    "planId": "896357c8-1155-47de-9d3c-15055a4820aa",
    "title": "Enterprise Package",
    "expired": "2027-01-31T00:00:00.000Z"
  },
  {
    "type": "addon",
    "planId": "888eb197-ccec-4167-be91-c694fcb03e4b",
    "qty": 1
  }
]
```

建议 mysql 表：`client_pricingplan_detail`

- `id` (pk) `varchar(36)`
- `client_id` (fk) `varchar(36)`
- `type` `varchar(20)`（如 `plan` / `addon`）
- `plan_id` `varchar(36)`（引用 `pricingplan.id` 或 addon 计划 id）
- `title` `varchar(255)` nullable
- `expired` `datetime` nullable
- `qty` `int` nullable
- `created_at` `datetime`
- `updated_at` `datetime`

#### 4) client_credit

来源：`clientdetail.credit` (array)。

示例：

```json
[
  {
    "type": "flex",
    "amount": 4488,
    "updatedAt": "2026-01-22T13:28:24.831Z"
  }
]
```

建议 mysql 表：`client_credit`

- `id` (pk) `varchar(36)`
- `client_id` (fk) `varchar(36)`
- `type` `varchar(50)`（如 `flex` / 以后还有别的类型）
- `amount` `decimal(18,2)`
- `updated_at` `datetime`

> 后续如果需要流水明细，可以再增加 `client_credit_logs` 记录每一次加减。

## all-in-one apps credit 设计（草稿）

需求：  
- all-in-one apps 也有自己的 credit；  
- property management 有自己的 credit；  
- 访客可以使用 all-in-one credit 为 property management credit 充值（topup / 转账）。

建议思路：

1. **统一用户表（all-in-one）**
   - 表：`user`（或 `app_user`）
   - 字段：`id`, `email`, `password_hash`, `created_at`, `updated_at` 等
   - property management / renovation 等业务模块通过中间表与 `user` 绑定。

2. **all-in-one credit**
   - 表：`user_credit`
   - 字段：`id`, `user_id`, `type`, `amount`, `updated_at`
   - 可配合 `user_credit_logs` 记录充值 / 消费流水。

3. **property management credit**
   - 继续使用 `client_credit`（按 client 维度），或再增加 `tenant_credit`（按 tenant 维度）。

4. **跨 apps topup / 转账记录**
   - 新表：`credit_transfer`
   - 字段示例：
     - `id` `varchar(36)`
     - `from_user_id`（all-in-one user）
     - `to_client_id`（property management client）
     - `to_tenant_id` nullable（如果将来按 tenant 维度记账）
     - `amount` `decimal(18,2)`
     - `created_at` `datetime`
   - 业务流程：通过 stripe / bukku / 内部逻辑完成实际扣款后，在此表和双方 credit 表中记账。

> 以上是 credit 相关的结构草稿，后续可以根据实际业务（是否要对账、审计）进一步细化字段。

---

## agreement（放在代码/表结构下方说明）

- **用途**：存「签好的合同实例」等，与 tenancy / tenant 等关联由后续 services 决定。
- **当前表结构**：仅基础字段 `id`, `wix_id`, `client_id`(fk→clientdetail), `created_at`, `updated_at`。
- **约定**：后期按 services 需求再加 column，不在此文档预先列完整字段。

---

## meterdetail：mother（父表）与 child（子表）

- **mother（parent）**：整户总表。例如一间屋子一个总表，总表读数 = 整户总用量。
- **child**：房间分表。例如同一间屋子下 5 个房间各一个表，每个表记录该房间用量。
- **关系**：mother 的用量 = 所有对应 child 的用量之和（由业务/同步逻辑汇总）。
- **表设计**：
  - `meterdetail.meter_type`：`'parent'` | `'child'`。
  - `meterdetail.parentmeter_id`：当 `meter_type = 'child'` 时指向该房间所属的 parent 表（fk → meterdetail.id）；parent 行为此列为 null。
- **说明**：`childmeter`、`metersharing` 等复杂数组以 json 存于 `childmeter_json`、`metersharing_json`，后续如需可再拆成关系表。
