# Generate Report 页面：旧代码 vs 新代码功能对比表

| 功能 | 旧代码 (Wix generatereport-page-full.js) | 新代码 (Next operator/report) | 备注 |
|------|------------------------------------------|--------------------------------|------|
| **页面结构 / Tab** | 多 Section：Report、GR、Bank、Topup（#buttonreport / #buttongr / #buttonbankfile / #buttontopup） | 两 Tab：**Generate Report**、**Reports History** | 新页面不包含 Topup、不单独 Bank Tab，Bank 在 History 勾选后出现 |
| **Topup（充值）** | ✅ 有独立 Section，Credit plans + Checkout | ❌ 无 | 产品要求：Report 页不展示 Topup |
| **Generate Report 区** | Section GR：日期 #datepicker1gr / #datepicker2gr、repeater 物业 + checkbox、全选 #checkboxallgr、#buttongr 生成 | Tab「Generate Report」：Date From/To、物业表格 + checkbox、全选、**Preview** 每行、**Generate**、**Download** | 新：每行多 **Preview**；Download 改为「仅下 PDF 不写表」 |
| **生成报告（写表 + PDF）** | ✅ #buttongr：insertOwnerReport + generateAndUploadOwnerReportPdf | ✅ **Generate**：同上 | 一致 |
| **下载 PDF（不写表）** | ❌ 旧版「下载」= 对已有 report 取 PDF（getOwnerReportsPdfDownloadUrl） | ✅ **Download**：getOwnerReportPdfDownloadUrlInline，只生成并下 PDF，不写 ownerpayout | 新：明确区分「生成入表」与「仅下载」 |
| **下载已有 report 的 PDF** | ✅ #buttondownloadpdfgr：勾选 Report 列表或 GR 区物业+日期 → getOwnerReportsPdfDownloadUrl | ✅ History 里单条「PDF」、多选「Bulk Download (ZIP)」 | 一致 |
| **GR 预览（生成前看明细）** | ✅ #buttongrdetail：进 section grdetail，load GR 明细表格 #tablegr（columns + rows） | ✅ 每行 **Preview**：弹窗显示 payout 明细表 + Total Rental/Utility/Collection/Expenses/Net Payout | 新用弹窗，逻辑等价 |
| **Reports History 列表** | Section Report：日期、Property 下拉、Type(All/Paid/Unpaid)、Search、Sort、分页(10条/页)、repeater | Tab「Reports History」：日期、Property、Type、Sort、Search、**无分页**（一次最多 500 条） | 新：无前端分页，limit 500 |
| **列表筛选** | 日期、property、type(Paid/Unpaid)、search、sort(new/old/amount asc/desc) | 日期、property、type、sort、search | 一致 |
| **列表缓存 / 大数据** | 日期范围内最多 2000 条 cache；超过则走 server 分页（loadReportPageFromServer） | 单次请求 limit 500，无 cache、无分页 | 旧：支持 >2000 条 + 分页；新：500 条内 |
| **分页** | ✅ #paginationreport，10 条/页 | ❌ 无 | 新：一次展示最多 500 条 |
| **勾选 + 已选合计** | checkbox、Selected: N \| Total: RM xxx（getOwnerReportsTotal） | checkbox、Selected: N \| Total: RM xxx | 一致 |
| **Report 详情** | #boxdetail：title、总览、Paid 状态、**Invoice**（bukkuinvoice）、**Payout**（bukkubills）链接 | Detail 弹窗：总览、Paid 状态、Payment 方式/日期、**Invoice (management fees)** / **Bills (payout to owner)**（仅 accounting 已集成时显示） | 新：按会计集成显隐 + 文案区分 Invoice/Bills |
| **Mark as Paid（单条）** | #buttonpay → #boxpayment，选 date + method → updateOwnerReport | Detail 内「Mark as Paid」→ 弹窗选 Payment method + Payment date → updateOwnerReport | 一致 |
| **Mark as Paid（批量）** | #buttonbulkpaid → #boxpayment → bulkUpdateOwnerReport | 勾选后「Mark as Paid」→ 同上弹窗 → bulkUpdateOwnerReport | 一致 |
| **Payment 写入会计** | updateOwnerReport 带 paymentDate、paymentMethod → Node createAccountingForOwnerPayout（cash invoice + cash bill，按 provider） | 同上 | 一致 |
| **Delete（单条）** | #buttondeletereport，Confirm 二次确认 | Detail 内「Delete」，Confirm 二次确认 | 一致 |
| **Delete（批量）** | #buttonbulkdelete，Confirm 二次确认 | 「Bulk Delete」，Confirm 二次确认 | 一致 |
| **Bank 银行文件** | Section Bank：#dropdownbank + #buttondownloadfile，选银行后下 Excel/zip | History 勾选后出现「Download Bank File」+ 银行下拉 | 功能一致，新合并在 History 区块 |
| **Bank 权限** | hasBankBulkTransferAddon 无则 disable #buttonbankfile | 调 getBankBulkTransferBanks，无数据则无下拉/按钮 | 一致（无 addon 则无银行可选） |
| **权限** | accessCtx.staff.permission.finance \|\| admin | 依赖 operator 路由/权限体系 | 新未在此页单独写 finance 判断，通常由 layout 控制 |
| **Mobile** | 显示 "Please setting on pc version" 并 collapse 主要 section | 响应式布局，无单独禁用 | 新支持手机浏览 |
| **会计系统** | Bukku/Xero/MySQL/AutoCount，Mark as Paid 时写 date 进会计 | 同上；且 Invoice/Bills 链接仅在 getOnboardStatus.accountingConnected 时显示 | 新：未集成则隐藏 Invoice/Bills |
| **生成后写回 Invoice/Bills URL** | 依赖会计回调或既有逻辑写 bukkuinvoice/bukkubills | Mark as Paid 成功后 createAccountingForOwnerPayout 内写回 bukkuinvoice、bukkubills URL | 新：显式在 Mark as Paid 后写回链接 |

---

## 总结：新代码少了什么 / 不一样的地方

| 项目 | 说明 |
|------|------|
| **Topup** | 刻意不做：产品要求 Report 页不展示 Topup。 |
| **分页** | 新：无分页，一次最多 500 条；旧：10 条/页 + 超过 2000 条走 server 分页。若需支持更多数据，可再加分页或提高 limit。 |
| **列表缓存** | 旧：日期范围内最多 2000 条 cache + 前端筛选/排序；新：每次切 History 或改筛选会重新请求，limit 500。 |
| **Bank 入口** | 旧：独立 Tab「Bank」；新：在 Reports History 勾选报告后出现 Bank 下载，功能等价。 |

其余核心能力（生成报告、下载 PDF、Preview、Mark as Paid、Payment 日期进会计、单/批量删除、Invoice/Bills 链接、Bank 文件）新旧一致或在新版更清晰（例如 Download 不写表、会计未集成隐藏链接）。

---

## 连接后端：调会计系统 API 生成 Invoice & Bills

**结论：旧 Wix 和新 Next 用的是同一套 Node 后端。** 前端都是调 `updateOwnerReport` / `bulkUpdateOwnerReport`，由 Node 去连会计系统并 call API 生成 invoice 和 bills，**没有少功能**。

### 流程（Mark as Paid 时）

| 步骤 | 说明 | 代码位置 |
|------|------|----------|
| 1 | 前端传 `paid: true`、`paymentDate`、`paymentMethod`（Bank/Cash） | Next: `handleSubmitPay` → `updateOwnerReport` / `bulkUpdateOwnerReport` |
| 2 | Node 更新 `ownerpayout` 表后，若 `paid && paymentDate && paymentMethod` 则调 `createAccountingForOwnerPayout` | `generatereport.service.js`（updateOwnerReport / bulkUpdateOwnerReport） |
| 3 | 解析当前 client 的会计系统 | `generatereport-accounting.service.js` → `resolveClientAccounting(clientId)` → 读 `client_integration`（key=Account/addonAccount），得到 **provider**：`bukku` / `xero` / `autocount` / `sql` |
| 4 | 查 owner contact、Bank/Cash 科目、Platform Collection 科目等 | 同文件：getContactForRentalItem、getPaymentDestinationAccountId、getAccountMapping、getAccountIdByPaymentType |
| 5 | **生成 Cash Invoice（管理费）** | `createCashInvoice(req, provider, { contactId, accountId, amount: managementFee, paymentAccountId, date: paymentDate, ... })` → **调用会计系统 API** |
| 6 | **生成 Cash Bill（出给屋主的钱）** | `createCashPurchaseOne(req, provider, { contactId, expenseAccountId, paymentAccountId, amount: netpayout, date: paymentDate, ... })` → **调用会计系统 API** |
| 7 | 写回 Invoice/Bills URL 到 `ownerpayout` | 同文件：成功创建后 `getInvoiceUrl` + 拼 Bukku bill URL，`UPDATE ownerpayout SET bukkuinvoice=?, bukkubills=?` |

### 各会计系统实际调用的 API

| 会计系统 | Invoice（管理费） | Bills（owner payout） |
|----------|-------------------|------------------------|
| **Bukku** | `bukkuInvoice.createinvoice`（cash invoice） | `bukkuPurchaseBill.createpurchasebill` |
| **Xero** | `xeroInvoice.create`（ACCREC）+ 可选 `xeroPayment.createPayment` | `xeroInvoice.create`（ACCPAY）+ `xeroPayment.createPayment` |
| **AutoCount** | `autocountInvoice.createInvoice` | `autocountPurchase.createPurchase` |
| **SQL** | `sqlInvoice.createInvoice` | `sqlPurchase.createPurchase` |

以上全部在 **Node 后端** 完成（`rentalcollection-invoice.service.js` 的 `createCashInvoice`、`expenses-purchase.service.js` 的 `createCashPurchaseOne`）。旧版 Wix 前端是调 Node；新版 Next 前端也是调同一个 Node API，所以「连接后端、去 account software call API 生成 invoice & bills」**新旧一致，没有少**。
