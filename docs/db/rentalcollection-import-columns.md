# rentalcollection 表结构（供 Wix 导出后导入）

## 1) 先执行 migration（改表）

```bash
node scripts/run-migration.js src/db/migrations/0040_rentalcollection_import_columns.sql
```

效果：新增 `property_wixid`、`room_wixid`、`tenant_wixid`、`type_wixid`；`bukku_invoice_id` 改为 varchar(100)。

---

## 2) Wix 一行 → MySQL 列对照（import 脚本用）

| Wix 导出列 / 含义 | MySQL 列 | 说明 |
|-------------------|----------|------|
| **ID / _id** | **wix_id** | 脚本把 CSV 的 ID 写入 `wix_id`；主键 `id` 由脚本生成新 UUID |
| title | title | text |
| tenant (Wix ID) | tenant_wixid | 脚本按 tenantdetail.wix_id 解析并填 tenant_id |
| room (Wix ID) | room_wixid | 脚本按 roomdetail.wix_id 解析并填 room_id |
| property (Wix ID) | property_wixid | 脚本按 propertydetail.wix_id 解析并填 property_id |
| type (Wix ID) | type_wixid | 脚本按 account.wix_id 解析并填 type_id |
| client (Wix ID) | client_wixid | 脚本按 clientdetail.wix_id 解析并填 client_id |
| tenancy | tenancy_id | 0087：直接写入，tenancy = tenancy.id |
| Date | date | datetime |
| Created Date | created_at | datetime |
| Updated Date | updated_at | datetime |
| isPaid | ispaid | boolean → 1/0 |
| amount | amount | number |
| Paidat | paidat | datetime |
| receipturl | receipturl | url |
| invoiceid | invoiceid | text |
| invoiceurl | invoiceurl | url |
| referenceid | referenceid | text |
| description | description | text（0039 已加） |
| Bukku_invoice_id | bukku_invoice_id | varchar（0040） |

不用：Accountid、Productid、Owner（表里有可留空，不填即可）。

---

## 3) 导入流程（清空 → 导入，脚本内已做 _id 解析）

重导前清空表：

```bash
node scripts/truncate-rentalcollection.js
```

导入（CSV 的 ID→wix_id，id 用新 UUID；client_id / property_id / room_id / tenant_id / type_id / tenancy_id 由各表 wix_id 解析填入）：

```bash
node scripts/import-rentalcollection.js rentalcollection.csv
```

若部分行 _id 仍为 NULL（对应表无该 wix_id），可再跑 0041 补回 property_id / room_id / tenant_id / type_id。

---

## 4) 表列一览（当前）

- id, wix_id  
- client_id, client_wixid  
- property_id, **property_wixid**（0040）  
- room_id, **room_wixid**（0040）  
- tenant_id, **tenant_wixid**（0040）  
- tenancy_id  
- type_id, **type_wixid**（0040）  
- title, date, amount, ispaid, paidat  
- invoiceid, referenceid, description, receipturl, invoiceurl  
- bukku_invoice_id（0040 改为 varchar）, accountid, productid  
- created_at, updated_at  

所有 _id 均为 FK：clientdetail, propertydetail, roomdetail, tenantdetail, tenancy, account。  
若需确保 FK 约束存在（缺失则添加），可执行：`node scripts/run-migration.js src/db/migrations/0042_rentalcollection_ensure_fk.sql`
