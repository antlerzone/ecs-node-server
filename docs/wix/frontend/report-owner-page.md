# Report / Owner Report 页迁移说明

本页原为 Wix 前端 + Wix Backend (ownerreport.jsw, createagreement.jsw) + Wix CMS，已迁移为 **Wix 前端 + Node (ECS) + MySQL**。

## CMS → MySQL 映射（本页用到的）

| Wix CMS 集合 / 用途 | MySQL 表 | 说明 |
|---------------------|-----------|------|
| PropertyDetail (GR 列表、报表筛选) | propertydetail | id, shortname, client_id, percentage, folder |
| OwnerPayout (报表列表、新增、更新、删除) | ownerpayout | id, client_id, property_id, period, title, totalrental, totalutility, totalcollection, expenses, management_fee, netpayout, paid, monthlyreport, bukkuinvoice, bukkubills, accounting_status, payment_date, payment_method |
| creditplan (Topup 套餐) | creditplan | 列表走 /api/billing/credit-plans，不再读 CMS |
| RentalCollection (generateOwnerPayout 收入) | rentalcollection | type_id→account, property_id, room_id, date, amount, ispaid, receipturl |
| MeterTransaction (generateOwnerPayout 充值) | metertransaction | property_id, tenancy_id, status='success', ispaid, amount, created_at |
| UtilityBills (generateOwnerPayout 支出) | bills | property_id, period, amount, description, supplierdetail_id |
| account (租金类型) | account | id, title → Agreement Fees / Owner Comission / Rental Income / Forfeit Deposit / Deposit |

## 前端改动摘要

- **Cache + 前端 filter（与 expenses 一致）**：日期范围内最多 2000 条拉进 `reportCache`，改 property/type/sort/search 不请求，只做前端过滤排序分页；若 `totalCount > 2000` 则 `useServerFilter = true`，之后每次分页/筛选都请求 server。`limit` 参数由前端在拉 cache 时传。
- **Section Tab**：`#sectiontab` 内放 Tab 按钮（如 `#buttonreport`、`#buttontopup`、`#buttonbankfile`），始终 expand，不在 `collapseAllSections` 里折叠。
- **移除**：`wixData` 全部移除。
- **Backend 引用**：
  - `backend/access/manage` → getAccessContext
  - `backend/billing/billing` → getMyBillingInfo, getCreditPlans, startNormalTopup
  - `backend/saas/generatereport.jsw` → getReportProperties, getOwnerReports, getOwnerReport, insertOwnerReport, updateOwnerReport, deleteOwnerReport, generateOwnerPayout, bulkUpdateOwnerReport, getOwnerReportsTotal, createOwnerReport
  - `backend/access/bankbulktransfer.jsw` → getBankBulkTransferData
- **Property 列表**：原 `wixData.query("PropertyDetail").eq("client", ...)` → `getReportProperties()` → `/api/generatereport/properties`。
- **Credit 套餐**：原 `wixData.query('creditplan')` → `getCreditPlans()` → `/api/billing/credit-plans`。
- **报表列表/筛选/分页**：`getOwnerReports({ property, from, to, search, sort, type, page, pageSize })` → `/api/generatereport/owner-reports`。
- **选中合计**：原 `wixData.query("OwnerPayout").hasSome("_id", ids)` → `getOwnerReportsTotal(ids)` → `/api/generatereport/owner-reports-total`。
- **生成 Payout**：`generateOwnerPayout(propertyId, propertyName, startDate, endDate)` → Node 内查 rentalcollection、metertransaction、bills、ownerpayout、propertydetail。
- **新增报表行**：`insertOwnerReport({ property, period, title, ... })` → `/api/generatereport/owner-report`。
- **PDF 上传**：`createOwnerReport({ base64, fileName, payoutId })` → `/api/generatereport/create-owner-report-pdf`（发 GAS，GAS 回调 finalize）。

## 后端 Node 模块

- **路由挂载**：`app.use('/api/generatereport', generatereportRoutes)`（见 `app.js`）。
- **实现**：`src/modules/generatereport/generatereport.service.js`、`generatereport.routes.js`。
- **认证**：所有接口通过 body/query 的 `email` 解析 access context，用 `client_id` 做数据范围。

## Wix 侧需配置

1. **Backend**：新增 `backend/saas/generatereport.jsw`，内容用 `docs/wix/jsw/velo-backend-saas-generatereport.jsw.snippet.js`。
2. **Secret Manager**：与现有 ECS 调用一致，需有 `ecs_token`、`ecs_username`、`ecs_base_url`。
3. **数据库**：执行 migration `0043_ownerpayout_payment_columns.sql`、`0044_propertydetail_folder.sql`（若尚未执行）。

## GAS 回调

GAS 完成后需 POST 到 Node：`/api/generatereport/finalize-owner-report-pdf`，body `{ payoutId, pdfUrl }`。若 GAS 当前回调的是 Wix，需改为回调 ECS 该 URL（或由 ECS 提供公网可访问的 callback 地址）。

---

## 不再用 html iframe 生成文件（改为 Node）

- **html1 / html2**：原在页面 iframe 内用 pdfMake 生成 Owner Report PDF。现改为 **Node 生成 PDF**：
  - **下载**：`POST /api/generatereport/owner-report-pdf-download`，body `{ email, payoutId }`，返回 `{ downloadUrl }`，前端 `wixLocation.to(downloadUrl)` 即可下载。
  - **上传到 GAS**：`POST /api/generatereport/generate-and-upload-owner-report-pdf`，body `{ email, payoutId }`，Node 根据 payoutId 重新算 rows、生成 PDF、上传 GAS，返回 `{ ok, task }`。
  - 前端 JSW：`getOwnerReportPdfDownloadUrl(payoutId)`、`generateAndUploadOwnerReportPdf(payoutId)`。
  - 报表详情中若有 `#buttondownloadpdf`、`#buttonuploadpdf` 会绑定上述逻辑。GR 生成多笔 payout 后会自动对每笔调用 `generateAndUploadOwnerReportPdf` 上传 PDF。
- **htmlbank**：原在 iframe 内用 XLSX + FileSaver 生成银行 PayBill/Bulk Transfer Excel。现改为 **Node 生成**（与 expenses 页一致）：
  - 调用 `POST /api/bank-bulk-transfer/download-url`，body `{ email, bank, type, ids }`，返回 `{ urls: [{ filename, url }] }`，前端 `wixLocation.to(urls[0].url)` 下载（多 chunk 时后端会打成一个 zip 返回一个 url）。
  - 前端 JSW：`getBankBulkTransferDownloadUrl({ bank, type, ids })`。
  - 页面不再使用 `#htmlbank`、`#html1`、`#html2` 的 postMessage。
