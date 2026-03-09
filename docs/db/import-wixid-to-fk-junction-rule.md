# 导入规则：wix_id / *_wixid 必须解析为 FK，并同步 Junction

## 规则（每次 import 必须遵守）

1. **凡是 CSV/输入里出现 `wix_id` 或 `*_wixid` 的列，一律视为「旧 ID」（Wix ID）。**
2. **必须用该列去目标表按 `wix_id` 查得 MySQL `id`，写入对应的 `_id`（FK）列。**  
   - 例：`client_wixid` → 查 `clientdetail.wix_id` 得 `clientdetail.id` → 写入本行 `client_id`。
3. **若该 FK 参与 Junction 表，导入后必须把 Junction 一并写入/更新。**  
   - 例：import **account** 时若写入了 `client_id`，必须同时向 **account_client** 插入 `(account_id, client_id, system)`，否则按 client 查 account 会漏数据。

约定：业务与 Node 只用 `_id`；`_wixid` 仅导入/迁移时用。见 `.cursor/rules/mysql-fk-use-id-only.mdc` 与 `docs/db/fk-and-junction-tables.md`。

---

## 一、wixid 列 → FK 列 → 查表（解析用）

导入时用「查表」的 `wix_id` 解析出 `id`，写入本表「FK 列」。

| 本表 CSV/列（wixid） | 本表 FK 列（必须写入） | 查表（SELECT id, wix_id FROM 表 WHERE wix_id = ?） |
|----------------------|------------------------|-----------------------------------------------------|
| client_wixid         | client_id              | clientdetail |
| property_wixid       | property_id            | propertydetail |
| room_wixid           | room_id                | roomdetail |
| tenant_wixid         | tenant_id              | tenantdetail |
| tenancy_wix_id       | tenancy_id             | tenancy |
| type_wixid           | type_id                | account |
| bankname_wixid       | bankname_id            | bankdetail |
| bank_name_wixid      | bank_name_id           | bankdetail |
| billtype_wixid       | billtype_id 或 supplierdetail_id | account 或 supplierdetail（bills 当前用 supplierdetail_id） |
| meter_wixid          | meter_id               | meterdetail |
| parentmeter_wixid    | parentmeter_id         | meterdetail |
| smartdoor_wixid      | smartdoor_id           | lockdetail |
| gateway_wixid        | gateway_id             | gatewaydetail |
| agreementtemplate_wixid | agreementtemplate_id | agreementtemplate |
| management_wixid      | management_id          | supplierdetail |
| internettype_wixid   | internettype_id        | supplierdetail |
| owner_wixid          | owner_id               | ownerdetail |
| staff_wixid          | staff_id               | staffdetail |
| plan_wixid / planid  | plan_id                | pricingplan |
| creditplan_wixid     | creditplan_id          | creditplan |
| pricingplanlog_id / pricingplanlog_wixid | pricingplanlog_id | pricingplanlogs |
| submitby_wixid       | submitby_id            | staffdetail |
| wix_id（本行主键来源） | 主键用新 UUID；wix_id 列存原 Wix _id | 不解析，仅存为 wix_id |

说明：同一概念可能有多列名（如 plan_wixid / planid），映射到同一个 FK 列即可。

---

## 二、写入 FK 后需要同步的 Junction 表

导入「主表」并写入 FK 后，若该 FK 参与下面 Junction，**必须在同一次 import 里插入/更新对应 Junction 行**。

| 导入的表 | 写入的 FK | 需要同步的 Junction | Junction 列 |
|----------|-----------|----------------------|-------------|
| account  | client_id | account_client       | account_id, client_id, system（如 'bukku'） |
| ownerdetail | client_id | owner_client      | owner_id, client_id |
| ownerdetail | property_id | owner_property   | owner_id, property_id |

说明：

- **owner_client / owner_property**：若 CSV 中一个 owner 对应多个 client 或多个 property（如逗号分隔的 wixid），需解析出多个 id 并插入多条 junction 行。
- **tenant_client**：多为「租客 ↔ 批准其的 client」关系，若导入的是 tenant 且 CSV 带「批准方 client」，需同步 tenant_client；若导入的是 tenantdetail 本身，通常不需在 import 里写 tenant_client（除非业务要求一次导入就建好批准关系）。
- **account_client**：import account 时只要写入了 client_id，就必须插入 account_client，否则按 client 查 account 会漏。

---

## 三、Import 脚本检查清单

写或改 `scripts/import-*.js` 时：

1. [ ] CSV 中所有 `*_wixid` / `wix_id`（作为 reference 的）是否都映射到上表「本表 FK 列」？
2. [ ] 是否用对应「查表」建好 `wix_id → id` 的 Map，并在每行里 `row.xxx_id = map.get(row.xxx_wixid)`（或兼容 trim/去括号）？
3. [ ] 若本表是 **account**：写入行后是否 `INSERT INTO account_client (account_id, client_id, system)` 且不重复？
4. [ ] 若本表是 **ownerdetail**：若有 client_id / property_id，是否同步 **owner_client** / **owner_property**（多值时拆分为多行）？

完整 FK/Junction 列表见 `docs/db/fk-and-junction-tables.md`。
