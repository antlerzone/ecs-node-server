# Operator Invoice（Tenant Invoice）页面：旧代码 (Wix) vs 新代码 (Next) 功能对比表

## 1) 功能逐项对比表（有没有少功能）

| 功能 | 旧代码 (Wix) | 新代码 (Next) | 备注 |
|------|----------------|----------------|------|
| **入口 / 结构** | `#sectiontab` 内 `#buttoninvoice`、`#buttonmeterinvoices`、`#buttontopup`；Section 切换 (invoice / createinvoice / group / meterreport / topup) | 单页 `operator/invoice`：Tab 式列表 + Create + Meter 弹窗；无 Top-up 入口 | 新无 Top-up（可放 Credit 页） |
| **Access / Credit** | `getAccessContext()`；无 credit 时强制 topup、disable 入口按钮 | 未在此页做 access/credit 校验（可能由 layout 或中间件统一处理） | 新可补或沿用全局 |
| **发票列表** | `getRentalList({ property, type, from, to })`；前端 cache + 前端 search/sort；repeater 展示 | `getRentalList({ property, type, from, to })`；前端 filter (status/search) + sort + 分页 | ✅ 已补 from/to |
| **列表筛选** | Property、Type、Date From、Date To、Search（invoiceid/property/owner/room/tenant）、Sort（newest/az/za/amountasc/amountdesc/owner/tenant） | Property、Type、Status、**Date From/To**、Search、Sort（含 Owner/Tenant） | ✅ 已补日期 From/To、Owner/Tenant |
| **分页** | `PAGE_SIZE = 10`，`#paginationinvoice`，client-side 分页（cache 切片） | 无分页，一次拉全量后前端过滤排序 | 新可补服务端分页 |
| **列表行展示** | title, property shortname, type, tenant/owner name, amount, 颜色盒 (paid/unpaid) | Invoice #、Tenant、Property/Room、Type、Amount、Due Date、Status、Actions | ✅ 一致 |
| **详情弹窗** | `openInvoiceDetail(item)`：Date/Title/Invoice ID/Description/Amount/Paid/Property/Room/Tenant；**Invoice URL**、**Receipt URL** 按钮（有则显示） | 详情 Dialog：Invoice #、Status、Tenant、Property/Room、Type、Due Date、Amount | ❌ 新少：**Invoice URL、Receipt URL 链接**；无 Description/Title 展示 |
| **Mark as Paid** | `#boxpayment`：Payment method (Cash/Bank)、Payment date、Submit → `updateRentalRecord(id, { isPaid, paidAt, referenceid, paymentMethod })` | Pay Dialog：Payment method (Cash/Bank)、Payment date、Submit → `updateRental(id, { isPaid: true, paidAt, paymentMethod, referenceid })` | ✅ **有** 选择 payment method 与 payment date |
| **Delete** | 二次确认 → `deleteRentalRecords([id])` | 确认 Dialog → `deleteRental([id])`；**后端先 void 会计发票再删表** | ✅ 一致；新：void 再 delete |
| **Create Invoice** | `#sectioncreateinvoice`：Tenancy 下拉、Type 下拉、多行（date/tenancy/type/amount/description）、Add row、Submit → `insertRentalRecords(records)` | Create Dialog：Property、Tenancy、Type、Amount、Date、Description，单条 → `insertRental([{ tenancy, type, amount, date, description }])` | 旧可多行创建；新单条，可补多行 |
| **Meter Report / Meter Invoice** | `getMeterGroups()` → 选 Group → `calculateMeterInvoice({ mode: 'usage', ... })` 再 `mode: 'calculation'`（date range、sharing、amount）→ 后端算 usage + 拆分 | `getMeterGroups()` → 选 Group → **前端** `calculateMeterInvoices(group, tnbAmount)`（无调用 `/api/tenantinvoice/meter-calculation`）；Generate 仅前端状态，**未** 调用 `insertRental` 写入 | ❌ 新：Meter 为**纯前端计算**，未接后端 **meter-calculation** 与**写入 rentalcollection** |
| **Top-up** | `#sectiontopup`：Credit 余额、Credit Plans、Checkout（>1000 走 submitTicket 人工） | 无（预期在 Credit / Billing 页） | 刻意不在本页 |
| **Mobile** | `#buttonmobilemenu`、`#buttoninvoice2`、`#buttonmeterinvoice2`，收合菜单 | 未单独做 mobile 菜单 | 新可补 |
| **Download PDF / Send to Tenant** | 旧 Wix 页未提供此二按钮 | 新页曾为佔位项；**已移除**。PDF 可指从会计系统（invoiceurl）下载或系统生成；Send 可指发邮件给租客。若需可补对应 API。 | 新：已移除佔位 |

---

## 总结：新代码少了什么 / 差异

| 项目 | 说明 |
|------|------|
| **日期范围筛选** | ✅ **已补**：筛选区有 From/To 日期，传 `getRentalList({ from, to })`。 |
| **详情 Invoice URL / Receipt URL** | 旧：详情内若有 `item.invoiceurl`/`item.receipturl` 显示按钮跳转。新：列表数据类型未带这两项，详情未展示。**可补**：rental-list 已返回 invoiceurl/receipturl，在类型与详情 Dialog 中展示并加链接。 |
| **Meter 与会计/DB 一致** | 旧：后端 `calculateMeterInvoice`（usage + calculation）→ 公式与 TNB 拆分一致。新：前端本地计算，且 Generate 未调用 `insertRental`，不会写 rentalcollection，也不会触发会计。**可补**：接 `/api/tenantinvoice/meter-calculation`，并按结果调用 `insertRental` 或等价写入。 |
| **Sort: Owner / Tenant** | 旧：dropdown 有 Owner、Tenant（按 type 过滤）。新：无此两项。可视为 type 筛选的快捷方式，可补。 |
| **分页** | 旧：前端 10 条/页。新：一次全量。可补服务端分页。 |

---

## 2) Mark as paid 有没有选择 payment method 和 payment date？

**有。**

- **Wix：** `#boxpayment` 内 `#dropdownpaymentmethod`（Cash/Bank）、`#datepickerpayment`，提交时传 `paidAt`、`paymentMethod`、`referenceid`。
- **Next：** Pay Dialog 有 Payment method (Cash/Bank) 与 Payment date，`handleMarkAsPaidSubmit` 调用 `updateRental(id, { isPaid: true, paidAt: payDate, paymentMethod: payMethod, referenceid })`。
- **后端：** `tenantinvoice.service.js` 的 `updateRentalRecord` 接收 `payload.paidAt`、`payload.paymentMethod`，并传给 `createReceiptForPaidRentalCollection(..., { method: payload.paymentMethod })`。

---

## 3) 支付完成有没有执行 accounting（Bukku/Xero/MySQL/AutoCount）？

**有。**

- 后端在 `updateRentalRecord` 中，当 `willMarkPaid === true` 且更新成功时，会调用：
  - `createReceiptForPaidRentalCollection([id], { source: 'manual', method: payload.paymentMethod || null })`
- `createReceiptForPaidRentalCollection`（`rentalcollection-invoice.service.js`）会按客户会计集成在 **Bukku / Xero / AutoCount / SQL** 中创建 **receipt/payment**（冲账 invoice），即支付完成后会同步到会计系统。

---

## 4) 创建 Invoice 有没有执行 accounting（Bukku/Xero/MySQL/AutoCount）？

**有。**

- 后端在 `insertRentalRecords` 插入 rentalcollection 后，会调用：
  - `createInvoicesForRentalRecords(clientId, inserted)`
- `createInvoicesForRentalRecords` 会按客户会计集成在 **Bukku / Xero / AutoCount / SQL** 中创建 **credit invoice**，并回写 `invoiceid`、`invoiceurl` 到 rentalcollection。
- 即：在 Operator Invoice 页通过「Create Invoice」创建的记录，会触发会计系统开票（若客户已配置会计集成与定价方案）。

---

## 结论：有没有少功能？

- **核心列表、Mark as Paid、Create Invoice、Delete：** 新代码都有；且 **Mark as Paid 有** payment method 与 payment date；**支付完成**与**创建 Invoice** 都会走 **accounting（Bukku/Xero/MySQL/AutoCount）**。
- **少的/差异：**  
  - 日期范围筛选 (from/to)；  
  - 详情里 Invoice URL / Receipt URL 链接；  
  - Meter 流程未接后端 meter-calculation 与 insertRental（当前为前端模拟）；  
  - 无 Top-up（可放在 Credit 页）；  
  - 可选：分页、Owner/Tenant 排序/筛选。
