# Wix 前端文档

本目录存放 **Wix 前端** 相关代码与文档（Page Code、调用后端方式、页面约定等）。

---

## 页面类型约定（Public / Client / Indoor）

- **SaaS Client Page：** 需要 permission 的页面（client 员工后台），如 Company Setting、Room Setting、Booking、Billing、Admin Dashboard、Expenses 等。
- **Public Page（Client 的顾客页）：** Owner Dashboard、Tenant Dashboard（client 的顾客端）。
- **Indoor Admin：** SaaS 平台手動 billing 页（manual topup / manual renew）。详见 [page-types.md](../page-types.md)。
- **Enquiry Page（Public）：** 新客户询价/ demo 注册，无需登录；数据走 `backend/saas/enquiry` → ECS `/api/enquiry`。完整代码 [enquiry-page-full.js](./enquiry-page-full.js)；JSW [velo-backend-saas-enquiry.jsw.snippet.js](../jsw/velo-backend-saas-enquiry.jsw.snippet.js)。

---

## 费用页（完成版）

- **完整页面逻辑：** [expenses-page-full.js](./expenses-page-full.js) — 可直接粘贴到 Wix 费用页的 Page Code，或按需裁剪。
- **说明与粘贴步骤：** [full-expenses-page.md](./full-expenses-page.md)、[PASTE-STEPS.md](../PASTE-STEPS.md)、[FRONTEND-FIX-STEPS.md](../FRONTEND-FIX-STEPS.md)。
- **功能概要：**
  - **Sections：** 列表（expenses）、逐条新增（expensesinput）、批量上传（bulkupload）、银行文件下载（bank）。
  - **门禁：** 统一用 `getAccessContext()`（[ACCESS-HELPER.md](../jsw/ACCESS-HELPER.md)），不直接使用 wixUsersBackend / wixSecretsBackend。
  - **列表：** 按日期范围拉取、≤2000 条前端筛选/分页，>2000 走服务端分页；写入后统一 `refetchAfterWrite()` 更新 `#repeaterexpenses`。
  - **批量标记已付：** #buttonbulkpaid 只打开 #boxpayment，选日期与付款方式后 #buttonsubmitpayment 才写入。
  - **删除：** #buttonbulkdelete、#buttondeleteexpenses 第一次点击 label 改为「Confirm delete」，第二次才执行删除；后端 `console.log` 记录 email 与 ids，查 log 即可知谁删了哪些。
  - **按钮规则：** 所有会发请求的按钮点击时 disable + label「Loading...」，完成后 enable 并恢复原 label（`withButtonLoading`）。

---

## Profile / Contact 页（联系人）

- **完整页面逻辑：** [contact-setting-page-full.js](./contact-setting-page-full.js) — Topup + Contact 列表（Owner/Tenant/Supplier），数据走 **backend/saas/contact** JSW → `/api/contact/*`。
- **#dropdownbank：** 选项来自 bankdetail（mapBankOptions、ensureContactBankOptions）；setDropdownBankOptions 设 options 后 80ms 再设一次；无数据时占位「— No banks —」。
- **#text19：** 点击 #buttoncontact 时显示「Loading contacts...」，在切到 #sectioncontact 后再 hide（fetchAndFillContactCache 支持 skipHideLoading）。
- **#inputbukkuid：** 按访客 client 的 account system（sql/autocount/bukku/xero）读写；无 account system 时 disable。详见 [docs/readme/index.md](../../readme/index.md)#profile--contact-页联系人。

---

## 其他文档

| 文件 | 说明 |
|------|------|
| [troubleshoot-access-denied.md](./troubleshoot-access-denied.md) | 「You don't have account yet」排查（reason、staffdetail 检查） |
| [troubleshoot-no-data.md](./troubleshoot-no-data.md) | 列表无数据、筛选与日期排查 |
| [bulk-upload-iframe.html](./bulk-upload-iframe.html) | 批量上传 iframe（Excel/CSV → BULK_PREVIEW → #tablebulkupload） |
| [bulk-upload-iframe-usage.md](./bulk-upload-iframe-usage.md) | 批量上传 iframe 使用说明 |
| [HTML-DOWNLOAD-SETUP.md](./HTML-DOWNLOAD-SETUP.md) | 用 HTML iframe 触发下载（若需） |

---

**文档总入口：** [docs/index.md](../../index.md)。
