# Tenant Invoice 页（发票/租金页）迁移说明

## 架构

- **原**：Wix 前端 + Wix 后端 + Wix CMS（wixData 查 RentalCollection、PropertyDetail、bukkuid、Tenancy、creditplan、meterdetail）。
- **现**：Wix 前端 + Node 后端 + MySQL。数据全部通过 **backend/saas/tenantinvoice.jsw** 与 **backend/billing/billing.jsw** 请求 ECS Node，不读 Wix CMS。

说明：您提到的 **backend/saas/ownerportal.jsw** 是另一页 **Owner Portal**（业主门户：合同、报表 PDF 等）使用的。本**发票页**使用 **backend/saas/tenantinvoice.jsw**。

---

## 依赖

- **backend/access/manage**：`getAccessContext`
- **backend/billing/billing**：`getMyBillingInfo`、`startNormalTopup`、`getCreditPlans`
- **backend/saas/tenantinvoice**：`getProperties`、`getTypes`、`getRentalList`、`getTenancyList`、`getMeterGroups`、`insertRentalRecords`、`deleteRentalRecords`、`updateRentalRecord`、`calculateMeterInvoice`

---

## 部署步骤

1. **Node 端**：已挂载 `/api/tenantinvoice`（见 `src/modules/tenantinvoice/`），无需额外配置。
2. **Wix 后台**：新建 **backend/saas/tenantinvoice.jsw**，内容粘贴 [velo-backend-saas-tenantinvoice.jsw.snippet.js](../jsw/velo-backend-saas-tenantinvoice.jsw.snippet.js)。
3. **页面 Code**：使用 [tenant-invoice-page-full.js](./tenant-invoice-page-full.js)，按需调整元素 ID（如 `#repeaterinvoice`、`#dropdownproperty`、`#repeatertopup`、`#sectiongroup`、`#sectionmeterreport` 等）。

---

## CMS → MySQL 对照

| 原 Wix CMS / 用途 | MySQL 表 / 说明 |
|-------------------|-----------------|
| RentalCollection（发票列表） | rentalcollection，type_id → account(id) |
| PropertyDetail（筛选/显示） | propertydetail，owner_id → ownerdetail |
| bukkuid（类型下拉） | account（id, title） |
| Tenancy（创建发票下拉） | tenancy（status=1），含 room、tenant |
| creditplan（Topup 列表） | creditplan，接口走 /api/billing/credit-plans |
| meterdetail.metersharing（电表分组） | meterdetail.metersharing_json，Node 解析后返回分组 |

详细字段对照见 [docs/db/cms-field-to-mysql-column.md](../../db/cms-field-to-mysql-column.md) 第 5 节。

---

## API 一览（Node）

| 路径 | 说明 |
|------|------|
| POST /api/tenantinvoice/properties | 属性下拉（propertydetail by client_id） |
| POST /api/tenantinvoice/types | 类型下拉（account） |
| POST /api/tenantinvoice/rental-list | 租金列表（支持 property/type/from/to 筛选） |
| POST /api/tenantinvoice/tenancy-list | 有效租约列表（room + tenant） |
| POST /api/tenantinvoice/meter-groups | 电表分组（metersharing_json） |
| POST /api/tenantinvoice/rental-insert | 批量新增租金记录 |
| POST /api/tenantinvoice/rental-delete | 按 id 删除 |
| POST /api/tenantinvoice/rental-update | 单条更新（如标记已付） |
| POST /api/tenantinvoice/meter-calculation | 电表用量/分摊计算（usage + calculation） |

所有请求 body 需带当前用户 `email`（JSW 自动附加）；client 由 Node 通过 access context 解析。

**Meter 分摊（meter-calculation）：** `sharingType` 仅支持 `percentage`、`divide_equally`、`room` 三种，与 [docs/meter-billing-spec.md](../../meter-billing-spec.md) 及 Meter Setting 页一致，tenancy 已移除。
