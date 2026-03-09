# 发票页迁移 – ECS 粘贴/部署清单

## 1) 数据库：先执行 migration（reference 与 description 分开列）

在 ECS 上执行一次（MySQL）：

```bash
# 方式一：用项目脚本
node scripts/run-migration.js src/db/migrations/0039_rentalcollection_description.sql

# 方式二：直接 MySQL
mysql -u你的用户 -p 你的库名 < src/db/migrations/0039_rentalcollection_description.sql
```

Migration 内容：为 `rentalcollection` 表新增 `description` 列（TEXT），与 `referenceid` 分开。

---

## 2) ECS 上需存在的文件（粘贴/部署用 array）

部署或粘贴到 ECS 时，请确保以下文件存在且为最新版本：

```
app.js
src/modules/tenantinvoice/tenantinvoice.service.js
src/modules/tenantinvoice/tenantinvoice.routes.js
src/db/migrations/0039_rentalcollection_description.sql
```

若用 rsync 同步项目，只需保证上述 4 个在 ECS 上；其余依赖（access、billing、cnyiot 等）若已在 ECS 则无需改。

---

## 3) 功能核对（确认不少功能）

| 功能 | 原（wixData + JSW） | 迁后（Node + tenantinvoice.jsw） | 状态 |
|------|---------------------|-----------------------------------|------|
| 登录 / 权限 | getAccessContext | getAccessContext（backend/access/manage） | ✅ |
| 发票列表 | wixData RentalCollection + include | getRentalList（property/type/from/to） | ✅ |
| 筛选 | PropertyDetail、bukkuid 下拉 + 日期 | getProperties、getTypes + 前端 datepicker | ✅ |
| 搜索 | 前端 filter（invoiceid/ property/owner/room/tenant） | 同上，getRentalList 后前端 filter | ✅ |
| 排序 | newest/az/za/amountasc/amountdesc/owner/tenant | 同上，前端 sort | ✅ |
| 分页 | 前端 slice PAGE_SIZE | 同上 | ✅ |
| 发票详情弹窗 | 展示 date/title/invoiceid/description/amount/paid/property/room/tenant | 同上，description 用独立列 | ✅ |
| 标记已付 | updateRentalRecord(isPaid, paidAt, referenceid) | 同上，referenceid 存付款备注 | ✅ |
| 删除发票 | deleteRentalRecords([id]) | 同上 | ✅ |
| Invoice/Receipt URL 按钮 | 有则展开并跳转 | 同上 | ✅ |
| Topup 余额 | getMyBillingInfo → credit | 同上 | ✅ |
| Topup 套餐列表 | wixData creditplan | getCreditPlans（billing） | ✅ |
| Topup 下单 | startNormalTopup | 同上（billing） | ✅ |
| 超过 1000 提示框 | setupTopupProblemBox + boxproblem2 | 同上 | ✅ |
| 创建发票 | Tenancy 下拉 + bukkuid 类型 + 多行 date/tenancy/type/amount/description | getTenancyList、getTypes + insertRentalRecords（referenceid、description 分传） | ✅ |
| 电表分组列表 | wixData meterdetail + metersharing | getMeterGroups | ✅ |
| 电表用量阶段 | calculateMeterInvoice(mode: 'usage') | 同上，走 Node /api/tenantinvoice/meter-calculation | ✅ |
| 电表分摊计算 | calculateMeterInvoice(mode: 'calculation') | 同上 | ✅ |
| 分摊方式 | percentage / divide_equally / room（仅此三种，与 [meter-billing-spec.md](../../meter-billing-spec.md) 一致，无 tenancy） | 同上 | ✅ |
| 关闭 Topup / 关闭详情 / 关闭 Meter Report | 各 close 按钮 | 同上 | ✅ |

结论：**功能全部保留**，仅数据来源改为 Node + MySQL；`referenceid` 与 `description` 已分为两列。
