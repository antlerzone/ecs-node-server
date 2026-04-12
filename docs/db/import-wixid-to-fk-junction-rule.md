# 导入规则：Wix _id 直接作为 id，FK 直接使用

## 规则（Migration 0087 之后）

**自 0087 起：** 所有表 `id` = Wix CMS 的 `_id`（UUID 同格式）。已删除 `wix_id`、`*_wixid` 列。

1. **Import：** CSV 的 `_id` 直接写入 `id`，**不生成新 UUID**。
2. **新 item insert（API/UI 创建）：** 才用 `randomUUID()` 生成新 id。
3. **CSV 中的 reference 列（如 `client`、`property`）→ 直接写入对应 `_id` 列。**  
   - 例：`client` = Wix ClientDetail._id → 写入 `client_id`（因 id 已 = Wix _id，无需查表）。
4. **若该 FK 参与 Junction 表，导入后必须把 Junction 一并写入。**  
   - 例：import **account** 时若写入了 `client_id`，必须同时向 **account_client** 插入 `(account_id, client_id, system)`。

约定：业务与 Node 一律用 `_id`。见 `.cursor/rules/mysql-fk-use-id-only.mdc` 与 `docs/db/fk-and-junction-tables.md`。

---

## 一、CSV 列 → FK 列（直接映射）

Wix 导出的 reference 值 = 被引用表的 `_id`，可直接写入 FK 列。

| 本表 CSV 列（Wix reference） | 本表 FK 列 | 说明 |
|------------------------------|------------|------|
| client                       | client_id  | clientdetail.id = Wix _id |
| property                     | property_id | propertydetail.id = Wix _id |
| room                         | room_id    | roomdetail.id = Wix _id |
| tenant                       | tenant_id  | tenantdetail.id = Wix _id |
| tenancy                      | tenancy_id | tenancy.id = Wix _id |
| type                         | type_id    | account.id = Wix _id |
| bankname / bankName          | bankname_id / bank_name_id | bankdetail.id = Wix _id |
| billtype                     | supplierdetail_id | supplierdetail.id = Wix _id（bills 用 supplierdetail） |
| meter                        | meter_id   | meterdetail.id = Wix _id |
| parentmeter                  | parentmeter_id | meterdetail.id = Wix _id |
| smartdoor                    | smartdoor_id | lockdetail.id = Wix _id |
| gateway                      | gateway_id | gatewaydetail.id = Wix _id |
| agreementtemplate            | agreementtemplate_id | agreementtemplate.id = Wix _id |
| management                   | management_id | supplierdetail.id = Wix _id |
| internettype                 | internettype_id | supplierdetail.id = Wix _id |
| owner                        | owner_id   | ownerdetail.id = Wix _id |
| staff / submitby             | staff_id / submitby_id | staffdetail.id = Wix _id |
| plan                         | plan_id    | pricingplan.id = Wix _id |
| creditplan                   | creditplan_id | creditplan.id = Wix _id |
| pricingplanlog               | pricingplanlog_id | pricingplanlogs.id = Wix _id |
| _id（本行主键）              | id         | 直接写入，不生成新 UUID |

说明：CSV 中 reference 列的值即为被引用表的 `id`，直接写入即可，无需查表解析。

---

## 二、写入 FK 后需要同步的 Junction 表

| 导入的表 | 写入的 FK | 需要同步的 Junction | Junction 列 |
|----------|-----------|----------------------|-------------|
| account  | client_id | account_client       | account_id, client_id, system（如 'bukku'） |
| ownerdetail | client_id | owner_client      | owner_id, client_id |
| ownerdetail | property_id | owner_property   | owner_id, property_id |

---

## 三、Import 脚本检查清单

1. [ ] CSV `_id` 是否直接写入 `id`（不生成新 UUID）？可用 `scripts/import-util.js` 的 `resolveId(row, usedIds)`。
2. [ ] CSV reference 列是否直接写入对应 `_id` 列（client→client_id、property→property_id 等）？
3. [ ] 若本表是 **account**：是否同步 **account_client**？
4. [ ] 若本表是 **ownerdetail**：是否同步 **owner_client** / **owner_property**？

完整 FK/Junction 列表见 `docs/db/fk-and-junction-tables.md`。
