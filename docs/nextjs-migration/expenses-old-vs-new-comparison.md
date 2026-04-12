# Expenses 页面：旧代码 (Wix) vs 新代码 (Next) 功能对比表

| 功能 | 旧代码 (Wix expenses-page + expenses.jsw) | 新代码 (Next operator/expenses) | 备注 |
|------|-------------------------------------------|----------------------------------|------|
| **页面结构 / Section** | #sectiontab：Expenses、Topup；Section：expenses、expensesinput、bulkupload、bank | 单页 **Expenses Management**，无 Topup 区块 | 新：Topup 在 Credit 页 |
| **Topup** | ✅ 本页有 Section：getMyBillingInfo、creditplan、#buttoncheckout；>1000 显示 problem box + submitTicket | ❌ 无 | 产品约定：充值在 Credit 页 |
| **权限** | getAccessContext；无 staff.permission.finance/admin 则 showAccessDenied | 依赖 operator 路由/权限 | 一致 |
| **列表数据** | getExpenses(from, to, sort, limit 2000 或 page/pageSize)；expenseCache + useServerFilter(>2000 走 server 分页) | getExpensesList({ limit: 500, sort: "new" })；无日期范围/分页参数 | 新：单次 500 条、无前端 cache/分页 |
| **日期范围** | #datepicker1 / #datepicker2，默认上个月；toApiDateUtc 转 UTC 给 API | ❌ 无日期范围筛选 | 新：可补日期筛选 |
| **筛选** | Property、Type、Sort(New/Old/AZ/ZA/Amount asc-desc/Paid/Unpaid)、Search(防抖 300ms) | Search、Property、Status(Paid/Unpaid) | 新：少 Type、Sort 多选项；可补 |
| **分页** | #paginationexpenses，10 条/页；>2000 条时 loadExpensesPageFromServer | ❌ 无分页，一次展示 filtered | 新：可补分页 |
| **Select All** | #checkboxall：当前筛选下全选；useServerFilter 时 getExpensesIds(opts) 取全部 id | 表头 checkbox：selectedExpenses = filteredExpenses 的 id 列表 | 一致（新无 server 分页故无 getExpensesIds） |
| **Selected / Total** | getExpensesSelectedTotal(ids) 当跨页选时；否则前端 inMemory 算；#texttotal "Selected: N \| Total: RM xxx" | 前端 totalSelected = reduce(selectedExpenses, amount)；"Selected: N \| Total: RM xxx" | 一致；**已修 totalSelected.toFixed：amount 用 Number() 避免 string** |
| **单条 Mark as Paid** | #buttonpay → #boxpayment，#dropdownpaymentmethod、#datepickerpayment，#buttonsubmitpayment → updateExpense(id, { paid, paidat, paymentmethod }) | 行内「Mark as Paid」→ 打开 Mark as Paid 弹框 → payMethod + payDate → 单条时 setSelectedExpenses([id]) 后 bulkMarkPaid | 一致 |
| **批量 Mark as Paid** | #buttonbulkpaid → #boxpayment，选方式+日期 → #buttonsubmitpayment → bulkMarkPaid(ids, paidDate, method) | 选多笔 →「Mark as Paid」→ 弹框选 Payment method + Payment date → bulkMarkPaid(ids, { paidAt, paymentMethod }) | ✅ **有；payment method & date 都有** |
| **Download Bank File** | #buttonbankfile → 进 section bank，#dropdownbank 选银行，#buttondownloadfile → getBankBulkTransferDownloadUrls(bank, type: 'supplier', ids) | 「Download Bank File」→ **先打开弹框** → 选银行 → 点 Download → getBankBulkTransferDownloadUrl(bank, type: 'supplier', ids) | ✅ **有；且已改为先选银行再下载（与 report/refund 一致）** |
| **银行文件内容** | Node 返回 urls；>99 条时拆 JP01/JP02…、PM01/PM02… 打 zip；含 JomPay(PayBill) + Bulk Transfer(PBB/IBG) | 同一 Node API；返回 1 个 url（多文件时为 zip，内含 JomPay + Bulk Transfer） | ✅ **有；下载会有两个文件（JomPay + Bulk Transfer）或一个 zip 包含两者** |
| **Bank addon** | hasBankBulkTransferAddon 无则 disable #buttonbankfile | 未单独判断 addon；依赖 API 或 layout | 可补 |
| **新增费用** | #buttoncreatenew / #buttonaddexpenses → section expensesinput，#repeaterexpensesinput（property/type/date/description/amount），#buttonsaveexpensesinput → insertExpenses(records) | 「Add Expense」→ 弹框单条填写 → insertExpense；另有 Bulk Upload | 新：单条为弹框；无多行 repeater 一次多条 |
| **Bulk Upload** | #buttonbulkupload → section bulkupload，#htmlupload iframe 上传 → BULK_PREVIEW → #tablebulkupload，#buttonbulkuploadnow → insertExpenses(records) | 「Bulk Upload」→ 选 CSV 文件 → 解析后 insertExpense({ records }) | 一致 |
| **Download Template** | #buttondownloadtemplate → getBulkTemplateDownloadUrl 或 getBulkTemplateFile(base64) → 下载 Excel | getBulkTemplateDownloadUrl / getBulkTemplateFile | 一致 |
| **删除** | 单条 #buttondeleteexpenses（Confirm 二次）；批量 #buttonbulkdelete（Confirm）→ deleteExpenses(ids) | 单条行内 Trash；无批量删除 | 新：**少批量删除**，可补 |
| **详情** | #boxdetail：说明 + #buttonexpensesurl(bukkuurl)、#boxpayment、#buttondeleteexpenses | 无单独详情弹框；行内 Mark as Paid + Delete | 新：无详情块，可补 |
| **Mobile** | formFactor Mobile 时 "Please setting on pc version" 并 collapse 主要 section | 响应式布局 | 新支持手机 |
| **会计写入** | bulkMarkPaid / updateExpense 后 Node 写 paid、paidat、paymentmethod，并 createPurchaseForBills（会计系统） | 同上，调同一 Node API | 一致 |

---

## 直接回答

1) **有没有 Mark as paid → payment method & date？**  
   **有。** 新代码有「Mark as Paid」弹框，可选 **Payment method（Bank/Cash）** 和 **Payment date**，提交后调用 `bulkMarkPaid(ids, { paidAt: payDate, paymentMethod: payMethod })`，与旧版一致。

2) **Download bank file 功能有吗？点击后打开选择银行再 download？下载会有两个文件 JomPay + Bulk Transfer？**  
   **有。**  
   - 新代码已改为：点击「Download Bank File」→ **先打开弹框** → 访客选择银行（如 Public Bank MY）→ 点「Download」才请求并下载。  
   - 后端仍是同一套 Node：`type: 'supplier'` 时按 bill 类型生成 **JomPay（PayBill）** 与 **Bulk Transfer（PBB/IBG）**；多文件时打成一个 **ZIP**（内含 JP01/JP02…、PM01/PM02… 等），所以下载会得到 **JomPay + Bulk Transfer**（或一个含两者的 zip）。

---

## 总结：新代码少了什么 / 可补

| 项目 | 说明 |
|------|------|
| **Select all toFixed 报错** | 已修：`totalSelected` 与表格金额统一用 `Number(exp?.amount ?? 0)` / `Number(expense.amount ?? 0)`，避免 API 返回 string 导致 `.toFixed` 报错。 |
| **Topup** | 刻意不做：在 Credit 页。 |
| **日期范围** | 旧：可选日期范围拉列表；新：单次 500 条无日期。可补日期 + limit/分页。 |
| **Type / Sort** | 旧：Type 下拉、Sort 多选项；新：仅有 Status(Paid/Unpaid)、Property。可补。 |
| **分页** | 旧：10 条/页，>2000 走 server；新：无。可补。 |
| **批量删除** | 旧：勾选后 Bulk Delete + 二次确认；新：无。可补。 |
| **详情块** | 旧：点行进 #boxdetail、bukkuurl、单条 Mark as Paid/Delete；新：行内操作。可补详情弹框。 |
| **新增多行** | 旧：expensesinput 多行 repeater 一次可提交多条；新：单条 Add 弹框 + Bulk Upload。可接受。 |

核心流程（列表、勾选、Selected/Total、Mark as paid 含 payment method & date、Download bank file 先选银行再下载、JomPay+Bulk Transfer/zip）新旧一致，**没有少功能**。
