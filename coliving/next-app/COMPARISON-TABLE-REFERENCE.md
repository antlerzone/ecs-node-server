# 功能对比表参考（Wix 旧代码 vs Next 新代码）

## 已有对比文档

| 页面 | 文档路径 | 说明 |
|------|----------|------|
| Report（Generate Report） | [report-old-vs-new-comparison.md](./report-old-vs-new-comparison.md) | 生成报告、History、Mark as Paid、Bank 文件、PDF 下载等 |
| Accounting（Account Setting） | [accounting-old-vs-new-comparison.md](./accounting-old-vs-new-comparison.md) | 科目列表、Sync、编辑映射、保存 |
| Contact | [contact-old-vs-new-comparison.md](./contact-old-vs-new-comparison.md)、[contact-feature-comparison.csv](./contact-feature-comparison.csv) | Owner/Tenant/Supplier、Add/Edit/Delete、Edit Account ID、Bank 下拉、Pending |
| Expenses | [expenses-old-vs-new-comparison.md](./expenses-old-vs-new-comparison.md) | 费用列表、Mark as Paid、Download Bank File、Bulk Upload |
| Operator Invoice (Tenant Invoice) | [invoice-old-vs-new-comparison.md](./invoice-old-vs-new-comparison.md) | 发票列表、日期/筛选、Mark as Paid、Create Invoice、Meter Report、会计联动 |
| Booking | [booking-old-vs-new-comparison.md](./booking-old-vs-new-comparison.md) | 房间/租客/租期/费用、Admin Rules、Parking Lots、billing blueprint、createBooking、门禁/Top Up |
| Tenancy Setting | [tenancy-setting-old-vs-new-comparison.md](./tenancy-setting-old-vs-new-comparison.md) | 租户列表、延租/换房/终止、取消预约、协议上传/模板、换房预览、Topup、分页/Grid-List |
| Smart Door | [smart-door-feature-comparison.csv](./smart-door-feature-comparison.csv) | 列表/筛选/详情/更新/新增门锁网关、Parent-Child 锁、syncTTLockName、Top up、分页 |
| Meter Setting | [meter-setting-feature-comparison.csv](./meter-setting-feature-comparison.csv) | 列表/筛选/Sync/Client Topup/详情/新增电表/Meter Report/Group、Top up 刻意不做 |
| Room Setting | [room-feature-comparison.csv](./room-feature-comparison.csv) | 房间列表/筛选/详情/编辑/Add/批量/Price/Remark/Meter/Smart Door/Active/租客详情、Topup 刻意不做 |
| Property Setting | [property-feature-comparison.csv](./property-feature-comparison.csv) | 已有：占用+底色/Full occupied、Active 开关、Edit/Edit utility/Parking lot、缺字段在 Edit utility；仍缺 propertyId 筛选、分页；批量新增刻意不做 |
| Company Setting | [company-setting-feature-comparison.csv](./company-setting-feature-comparison.csv) | Profile(少货币/子域名/TIN/收款/logo/盖章)、Fees 一致、Staff(少分页/状态/薪资银行)、Integration(少 OAuth 回调/Create vs Connect)、无 Topup 区块 |

---

## 标准表格格式（复制用）

### 主表：功能逐项对比

```markdown
# [页面名] 页面：旧代码 (Wix) vs 新代码 (Next) 功能对比表

| 功能 | 旧代码 (Wix [页面/文件名]) | 新代码 (Next [路由/页面]) | 备注 |
|------|---------------------------|---------------------------|------|
| **页面结构** | 旧：Section/Tab、入口按钮、ID 等 | 新：单页/Tab、组件结构 | 一致/新少/可补 |
| **某功能 A** | 旧：API/UI 描述 | 新：API/UI 描述 | 一致 / ❌ 无 / ✅ 有 |
| **某功能 B** | … | … | … |
```

- **功能**：功能点名称（可加粗子项如 **列表**、**Mark as Paid**）。
- **旧代码**：Wix 侧实现（Section ID、JSW 方法、API 路径、行为）。
- **新代码**：Next 侧实现（路由、组件、operator-api 方法、行为）。
- **备注**：写「一致」「❌ 无」「新：可补」「✅ 有」等简短结论。

### 总结表：少了什么 / 差异

```markdown
## 总结：新代码少了什么 / 不一样的地方

| 项目 | 说明 |
|------|------|
| **Topup** | 刻意不做：在 Credit 页。 |
| **某能力** | 旧：…；新：…；可补。 |
```

### 结论段（可选）

```markdown
## 结论：有没有少功能？

**核心能力没有少：** 列表、筛选、某操作、某下载… ✅  
**差异：** 仅 Topup/分页/某细节，产品选择或可补。
```

---

## 书写约定

1. **旧代码列**：尽量写 Wix 的 **#id**、**backend/saas/xxx.jsw**、API 路径（如 `/api/expenses/list`），方便对代码。
2. **新代码列**：写 **Next 路由**（如 `operator/expenses`）、**组件/API 名**（如 `getExpensesList`、`bulkMarkPaid`）。
3. **备注**：用 ✅ / ❌、**有**/**无**、**可补**、**一致** 等，同一页风格统一。
4. 若某页无旧版文档，可只写「新代码 (Next)」一列，或把「旧代码」改为「需求/设计」。

新页面做对比时，可复制上面「标准表格格式」到新文件，把 `[页面名]`、`[页面/文件名]`、`[路由/页面]` 换成实际名称，再按行补功能与备注即可。
