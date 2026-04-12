# CSV 列映射检查（所有 import 脚本）

检查结果：以下 CSV 列**没有**映射到任何 DB 列（或表里无对应列），导入时**不会写入**。

---

## 1. tenantdetail.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列（Wix 导出用，可忽略） |

其余列均有映射或 fallback 写入。

---

## 2. Tenancy.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列 |
| **oldRental** | 表无 `oldrental` 列 |
| **oldEnd** | 表无 `oldend` 列 |

其余列均有映射。

---

## 3. utilitybills.csv (bills)

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列 |

其余列均有映射。

---

## 4. ownerpayout.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列 |

其余列均有映射。

---

## 5. rentalcollection.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列 |

其余列均有映射（含 Date、Paidat、Accountid、Productid、Bukku_invoice_id 等）。

---

## 6. ownerdetail.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列；关联用 client_id / property_id |

**contact_id**：不写入表列，用于生成 **account**（格式同 tenantdetail：`[{ "clientId": "<client_id>", "provider": "bukku", "id": <contact_id 数字> }]`）。其余列均有映射。

---

## 7. propertydetail.csv

无未映射列。**OwnerDetail_property** 已映射为 **owner_id**（FK → ownerdetail.id），与 Owner 同写一列，处理时 strip brackets 并校验 validOwnerIds。

其余列：有在 CSV_TO_DB 的已显式映射；Agreementstatus、percentage、checkbox、Signature、wifidetail、active、Remark、Tenancyenddate 等无显式映射但脚本用「表头名」当 key，且 INSERT 时用 `tableColumns.has(k.toLowerCase())` 过滤，表里列名为小写，故会按列名（大小写不敏感）写入。

---

## 8. meterdetail.csv

| CSV 列 | 说明 |
|--------|------|
| **Owner** | 表无 `owner` 列 |

其余列均有映射。

---

## 总结

- **所有表共有的未映射列**：**Owner**（各 CSV 都有，表里都没有 `owner` 列，属 Wix 导出字段，可不导入。）
- **仅部分表**：Tenancy 的 **oldRental / oldEnd**、ownerdetail 的 **contact_id**、propertydetail 的 **OwnerDetail_property**，表内无对应列，导入时会被过滤。

若需要把 **oldRental / oldEnd** 或 **contact_id** 存进库，需要先加表结构（新列或新表），再在对应 import 脚本里加上列映射。
