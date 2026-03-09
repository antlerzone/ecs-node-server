# Docs index

## 近期更新 Summary（System Integration Meter/TTLock / Generate Report 分类 / Refund Deposit / Admin / 门控 / 门禁与 sectiontab）

- **System Integration（Meter / Smart Door）：** ① **Meter (CNYIOT)**：创建子账号时 **contact 与 subdomain 一律从 client_profile 表读取**，前端不再用 #input4profile/#input5profile 校验；后端 `cnyiotConnect({ mode: 'create' })` 未传 tel 时从 `client_profile.contact` 取，subdomain 在 `ensureClientCnyiotSubuser` 内由 `getClientSubdomain(clientId)` 从 client_profile（或 clientdetail）取；缺 contact 抛 `CONTACT_REQUIRED`、缺 subdomain 抛 `CLIENT_SUBDOMAIN_REQUIRED`。② **Edit Meter** 打开时若为 create 模式（后端未存 cnyiot_password），**#inputpasswordonboard 显示默认 0123456789**。③ **Connect to old account**：在 #dropdownaccountonboard 选「Connect to old account」后点 #buttonsubmitaccountselection，**与 TTLock 一致**：有已存凭证则直接调 `cnyiotConnect({ mode: 'existing', username, password })`，成功则更新 **#buttoncnyiotonboard** 为「Meter Edit」、`setCnyiotButtonConnectedStyle(true)` 并**关闭 #boxaccountselection**（不打开 #boxonboard）；无已存凭证则关闭 #boxaccountselection 并打开 #boxonboard 让用户输入。前端：[companysetting-page-full.js](./wix/frontend/companysetting-page-full.js)；后端：`companysetting.service.js`（cnyiotConnect、getCnyiotCredentials）、`cnyiotSubuser.js`（getClientSubdomain）。
- **Generate Report（Owner Payout）rentalcollection 分类**：以 **type_id** 为准（Rental Income、Forfeit Deposit、Parking、Owner Commission、Agreement Fees、Deposit、Tenant Commission）；title 仅作 type_id 缺失或未知时的 fallback。Parking 支持 account.title = "Parking" 或 fallback id；Forfeit Deposit id = 2020b22b-028e-4216-906c-c816dcb33a85。详见 [generatereport-tablegr-datasource.md](./wix/frontend/generatereport-tablegr-datasource.md)。

- **Migrations：** 若尚未执行请先跑 **0076**、**0077**：  
  `node scripts/run-migration.js src/db/migrations/0076_refunddeposit_tenancy_id.sql`  
  `node scripts/run-migration.js src/db/migrations/0077_tenancy_last_extended_by_id.sql`
- **Daily Cron 新增 Refund deposit：** 租约 end &lt; 今天且未续约、deposit&gt;0、尚无 refunddeposit 时自动写入 refunddeposit（Admin Dashboard 可见）；refunddeposit 表增加 tenancy_id（0076）。
- **Admin Refund：** #boxrefund 增加 #inputrefundamount（可编辑且只能 ≤ 原 amount）；若改小则差额作 forfeit，仅 #buttonmarkasrefund 时写 journal。
- **Admin Section/Repeater：** #buttonagreementlist 打开 #sectionproperty（无 #buttonproperty）；#repeateragreement 已删除。#repeatertenancy 只显示与**当前 Staff** 相关的 tenancy：**submitby_id = 当前 staff**（Booking 创建）或 **last_extended_by_id = 当前 staff**（Extend 记录，0077 + extendTenancy 写入）。
- **Admin Dashboard 按钮门控：** 公司 Profile（Company Setting 的 profile，以 `client.title` 有值为准）未填好前，仅 #buttonprofile / #buttonusersetting / #buttonintegration / #buttontopup 可点；**#buttonadmin**、**#buttonagreementlist** 须在 profile 填好后才 enable。实现：`applyAdminMainActions()` 调 `getProfile()`（backend/saas/companysetting），见 [admindashboard-page-full.js](./wix/frontend/admindashboard-page-full.js)。
- **Tenant Dashboard 按钮门控：** ① **Profile 优先**：sectionprofile 未填好前只启用 #buttonprofile；#repeatertenantdashboard 内「Approve client」须 profile 完成后才可点，完成后才出现待签 agreement。② **有未签合约时**：只启用 #buttonagreement 与 #dropdownproperty；#buttonmeter / #buttonsmartdoor / #buttonpayment / #buttonfeedback 禁用。③ **租金未还**：当前选中物业（#dropdownproperty）对应 tenancy 若有未付租金（getRentalList 有 isPaid=false），则 #buttonmeter、#buttonsmartdoor 禁用；切换 #dropdownproperty 时按该物业重新判断。实现：`applyTenantProfileGate()`、`applyRentGateForCurrentProperty()`、`hasAnyUnsignedAgreement()`，见 [tenant-dashboard-page-full.js](./wix/frontend/tenant-dashboard-page-full.js)。
- **门禁拒绝与 #sectiontab 约定：** 所有门禁页面拒绝时统一文案（NO_PERMISSION → "You don't have permission"，其余 → "You don't have account yet"）、留在 #sectiondefault、主按钮 disable。**#sectiontab** 为页面入口栏，内放各 section 切换按钮，**始终 expand & show**；无 credit 且进入 sectiontopup、或无 permission、或 client 无 permission 时，**sectiontab 内按钮全部 disable**。Expenses 页加入 #sectiontab（#buttonexpenses 等）；Admin Dashboard #sectiontab 含 #buttonadmin、#buttonagreementlist、#buttonprofile；Tenant Invoice #sectiontab 含 #buttonmeterinvoices、#buttoninvoice。Permission 与页面/按钮对应见 [ACCESS-DENIED-CONVENTION.md](./wix/jsw/ACCESS-DENIED-CONVENTION.md)。
- **详细：** [docs/wix/frontend/admindashboard-sections-summary.md](./wix/frontend/admindashboard-sections-summary.md)、[cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)、[wix/jsw/ACCESS-DENIED-CONVENTION.md](./wix/jsw/ACCESS-DENIED-CONVENTION.md)、[wix/jsw/ACCESS-HELPER.md](./wix/jsw/ACCESS-HELPER.md)。

---

## Migration 完成确认（Stripe Checkout + 大额 1000 + Topup 全页）

- **状态：** 本仓库内迁移已完成，无需在 ECS 上再粘贴额外代码；部署最新代码即可。
- **后端（ECS Node，已在 repo）：**
  - Stripe 全部改为 **Checkout**：Client 充值 `POST /api/stripe/create-checkout-credit-topup`，Tenant 租金 `POST /api/stripe/create-checkout-rent`；Webhook `checkout.session.completed` 处理 `credit_topup`、`rent`。
  - **Pricing plan 大额：** `src/modules/billing/checkout.service.js` 中 `PRICING_PLAN_STRIPE_MAX_AMOUNT = 1000`；金额 ≥ 1000 返回 `provider: 'manual'` 并调用 `recordManualBillingTicket` 写 help/ticket（mode=`billing_manual`）。
  - **Help 工单：** `src/modules/help/help.service.js` 提供 `recordManualBillingTicket`、`submitTicket`；`POST /api/help/ticket` 接收前端提交的 `topup_manual` 等。
- **前端（Wix）：** 所有带 **Credit Plan Topup** 的页面已在本仓库 **docs/wix/frontend/** 中更新：金额 > 1000 时不跳 Stripe，显示 #boxproblem2 + 文案，并调用 `submitTicket({ mode: 'topup_manual', description: '...', clientId })`。已更新页面：billing、companysetting、tenant-invoice、account-setting、admindashboard、propertysetting、ownersetting、agreementsetting、metersetting、smartdoorsetting、roomsetting、generatereport、tenancysetting、contact-setting、expenses。**你需要在 Wix 编辑器中** 将各页面对应从 [docs/wix/frontend/](./wix/frontend/) 的对应 `*-page-full.js` 粘贴/同步到实际页面代码。
- **若 ECS 尚未部署最新代码：** 在 ECS 上执行你方现有部署流程（例如 `git pull && npm install && pm2 restart all` 或 CI/CD），无需单独粘贴脚本。

---

## 文档目录（docs 结构）

| 目录 | 说明 |
|------|------|
| **[docs/db](./db/)** | 库表设计草稿（[db.md](./db/db.md)）、**CMS 字段→MySQL 表/列对照**（[cms-field-to-mysql-column.md](./db/cms-field-to-mysql-column.md)）、**FK 与 Junction 表一览**（[fk-and-junction-tables.md](./db/fk-and-junction-tables.md)）、**导入约定 wixid→FK+Junction**（[import-wixid-to-fk-junction-rule.md](./db/import-wixid-to-fk-junction-rule.md)）、**未使用列报告**（[unused-columns-report.md](./db/unused-columns-report.md)）。数据导入（import-*.md，CSV 步骤与列对齐）。**Agreement 从创建到最终合约闭环**：[agreement-flow-create-to-final.md](./db/agreement-flow-create-to-final.md)。**會計流程封圈與四系統**：[accounting-flows-summary.md](./db/accounting-flows-summary.md)；**會計 Invoice/Purchase/Bills/Expenses 所需科目檢查清單**：[accounting-accounts-checklist.md](./db/accounting-accounts-checklist.md)；**Refund & Forfeit 按平台細說**：[refund-forfeit-other-platforms.md](./db/refund-forfeit-other-platforms.md)。执行全部 migration：[run-all-migrations-paste.md](./db/run-all-migrations-paste.md)。 |
| **[docs/wix/jsw](./wix/jsw/)** | Wix 后端 JSW：调用 ECS 的约定、manage / billing / **contact**（Profile 页联系人，[velo-backend-saas-contact.jsw.snippet.js](./wix/jsw/velo-backend-saas-contact.jsw.snippet.js)）/ agreementdetail / **agreementsetting**（[velo-backend-saas-agreementsetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-agreementsetting.jsw.snippet.js)）/ **ownersetting**（[velo-backend-saas-ownersetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-ownersetting.jsw.snippet.js)）/ **propertysetting**（物业列表/筛选/详情/更新/车位/业主协议，[velo-backend-saas-propertysetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-propertysetting.jsw.snippet.js)）/ **availableunit**（公开房源列表，[velo-backend-saas-availableunit.jsw.snippet.js](./wix/jsw/velo-backend-saas-availableunit.jsw.snippet.js)）/ bankbulktransfer / expenses / companysetting / ownerportal / tenantdashboard / tenantinvoice / admindashboard / topup 等，见 [README-wix-jsw.md](./wix/jsw/README-wix-jsw.md)、[velo-backend-manage.jsw.snippet.js](./wix/jsw/velo-backend-manage.jsw.snippet.js)。**门禁与 sectiontab**：[ACCESS-DENIED-CONVENTION.md](./wix/jsw/ACCESS-DENIED-CONVENTION.md)（拒绝统一文案、permission 与页面/按钮对应、#sectiontab 约定）、[ACCESS-HELPER.md](./wix/jsw/ACCESS-HELPER.md)。**类型约定**：本目录下所有 JSW 片段已对 `postJson`/`postEcs` 返回值做 JSDoc `@type` 断言，与 Node API 返回形状一致，粘贴到 Wix 后避免 Velo 红线；见 [jsw-type-assertions.mdc](.cursor/rules/jsw-type-assertions.mdc)。 |
| **[docs/wix/frontend](./wix/frontend/)** | Wix 前端：**Profile/Contact 页**（[contact-setting-page-full.js](./wix/frontend/contact-setting-page-full.js)：联系人列表与编辑、**#dropdownbank**←bankdetail、#inputbukkuid 按 account system 读写、#buttondeletecontact 二次确认）、**费用页**（[expenses-page-full.js](./wix/frontend/expenses-page-full.js)）、**Billing 页**、**Company Setting 页**、**Admin 页**、**Smart Door 页**（[smartdoorsetting-page-full.js](./wix/frontend/smartdoorsetting-page-full.js)：门锁/网关与 child lock）、**Meter Setting 页**（[metersetting-page-full.js](./wix/frontend/metersetting-page-full.js)：电表分组 parent/child/brother、#dropdownsharing 三选一，与 [meter-billing-spec.md](./meter-billing-spec.md) 一致）、**Agreement Setting 页**（[agreementsetting-page-full.js](./wix/frontend/agreementsetting-page-full.js)：协议模板列表/搜索/分页、新建/保存/删除、Topup 区块，数据走 ECS `/api/agreementsetting/*`）、**Owner Setting 页**（[ownersetting-page-full.js](./wix/frontend/ownersetting-page-full.js)：业主列表、#buttonowner/#buttoncreateowner/#buttontopup、Topup 用 backend/saas/topup）、**Property Setting 页**（[propertysetting-page-full.js](./wix/frontend/propertysetting-page-full.js)：物业列表/筛选/详情/更新/车位/新建/业主协议，数据走 ECS **backend/saas/propertysetting** + topup + roomsetting；#buttonroom 进入列表时预拉当前页 parking lots 缓存，#buttondetail 点开车位优先用缓存；Owner 区 #dropdownagreementtype system|manual 仅 collapse/expand #dropdownagreement、#inputagreementurl；业主协议可多页共用 `src/modules/agreement/owner-agreement.service.js`）、**Available Unit 页**（[available-unit-page-full.js](./wix/frontend/available-unit-page-full.js)：公开、无登录；全部 client 的 active+available/availablesoon 房源，grid+list 一次拉取、#sectionheader 含 #inputsearch/#dropdowncountry（Malaysia/Singapore）、#text20 Loading→Available Unit、#gallerygrid/#videoplayergrid/#gallerylist/#videoplayerlist 有值 expand 无值 collapse；#buttongrid/#buttonwhatsaplist 跳 wasap.my 询盘）、**Booking 页**、**Owner Portal 页**、**Tenant Dashboard 页**（[tenant-dashboard-page-full.js](./wix/frontend/tenant-dashboard-page-full.js)：feedback/NRIC 上传用 **HTML Embed** [upload-oss-embed.html](./wix/frontend/upload-oss-embed.html) 直传 OSS，#htmluploadbuttonfeedback / #htmluploadbutton1 / #htmluploadbutton2，backend 提供 `getUploadCreds()`；#buttonwhatsap 跳 wasap.my）、**发票/租金页**（[tenant-invoice-page-full.js](./wix/frontend/tenant-invoice-page-full.js)：含 Meter 组/用量/分摊，分摊方式同 Meter Setting 三选一）、[troubleshoot-access-denied.md](./wix/frontend/troubleshoot-access-denied.md)、[troubleshoot-no-data.md](./wix/frontend/troubleshoot-no-data.md)。充值（Topup）多页共用 **backend/saas/topup**。详见 [docs/readme/index.md](./readme/index.md)#profile--contact-页联系人。 |
| **docs 根目录** | 本 index、流程总览等。数据导入（import-*.md）在 [docs/db/](./db/)。ECS 排查「谁在接 api.colivingjb.com」：[ecs-check-who-serves-api.md](./ecs-check-who-serves-api.md)。**SaaS 平台四母账号**（TTLock / CNYIOT / Stripe / Bukku 的 env 与 client 子账号/Connect 关系）：[saas-platform-mother-accounts.md](./saas-platform-mother-accounts.md)。**每日定时任务**（八件事：欠租→房间可租→Refund→Pricing plan 到期→Core credit 到期清空→每月1号 active room 扣费→Stripe→门锁电量 feedback）：[cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)。**Demo Account 设计**（每表插入项、12am 刷新、sandbox、tenancy 按日 renew）：[demo-account-design.md](./demo-account-design.md)。**Stripe 支付封装**（Client 充值 credit / Tenant 租金 Connect / **Tenant Dashboard 付发票与 Meter 充值**；**Stripe 入账**：每 client 每 payout 日一笔 journal，已写 skip，描述含 Settlement ID）：[stripe.md](./stripe.md)。**电表分组与账单规则**（AUTO/MANUAL、Prepaid/Postpaid、3 种 Sharing、12 种组合，parent+child 与 tenancy 无关）：[meter-billing-spec.md](./meter-billing-spec.md)。**Storage（OSS）**：新上传走阿里云 OSS、按 client 分目录；**表存 URL**，已有保留。5 页用 HTML Embed 直传 OSS（[upload-oss-embed.html](./wix/frontend/upload-oss-embed.html)），JSW 提供 `getUploadCreds()`；前端对接 [upload-oss-frontend.md](./wix/upload-oss-frontend.md)、[upload-oss-embed-usage.md](./wix/frontend/upload-oss-embed-usage.md)；**迁移总结** [upload-oss-migration-summary.md](./wix/upload-oss-migration-summary.md)。**日期与时区**：datepicker = UTC+8，读 table 返回按 UTC+8 格式化 [date-timezone-convention.md](./date-timezone-convention.md)。 |
| **[docs/readme/](./readme/)** | 各模块说明索引：[readme/index.md](./readme/index.md)（含 **门禁拒绝与 #sectiontab 约定**、TTLock、CNYIoT、**Stripe**、**Bukku / AutoCount**、Company Setting、Wix 文档入口）。 |

---

## Accounting 會計流程（SaaS 等級，四系統 ready to live）

- **所有會計相關流程均為 SaaS 等級**：依 **當前 client 的 provider**（`client_integration` 中 key=Account/addonAccount、enabled=1 的 **xero / bukku / autocount / sql**）在該系統生成單據；每個 client 只會對接一個會計系統，後端透過 `resolveClientAccounting(clientId)` 取得 provider 與 req，再調用對應 wrapper 開 invoice / receipt / refund / purchase 等。
- **六類流程已封圈**：1）Meter invoice + receipt；2）Rental collection invoice + receipt；3）Expenses bill + receipt；4）Owner payout bills + receipt；5）Refund deposit；6）Forfeit deposit。**Xero、Bukku、AutoCount、SQL** 四套均已對接，完成 Account Setting Sync（或手動對應 account 表 + account_client）即可上線。
- **ID / URL**：多數流程會返回或寫回會計單據 id；有線上連結的（如 Xero/Bukku 的 invoice）會寫入對應表的 invoiceurl 等欄位。詳見 [docs/db/accounting-flows-summary.md](./db/accounting-flows-summary.md)。

### Account 表與 account_client（科目範本與客戶對應）

- **account 表**：全站共用的**科目範本**（如 Bank、Cash、Rent Income、Expenses、Management Fees、Platform Collection 等），每筆有 id、title、type、bukkuaccounttype。開單時依「類型」（如 bank/cash/management_fees）用 title 查 account.id，再依 client + 該 id 查真實會計系統的 accountid。
- **account_client 表**：存每個 client、每個會計系統的對應：`(account_id, client_id, system)` → `accountid`（及選填 product_id）。**Account 設定頁存檔只寫入 account_client**，不再寫入 account.account_json；查詢時先查 account_client，無則 fallback 讀 account_json（相容舊資料）。
- **遷移既有 account_json → account_client**：執行 `node scripts/migrate-account-json-to-account-client.js`，會把 account 表內 account_json 陣列中每筆 client 對應寫入 account_client（clientId/client_id 會解析為 clientdetail.id 或依 wix_id 查詢）。
- **會計科目檢查清單**：各流程（invoice、purchase、bills、expenses、settlement journal）所需 account title 與 account_client 對應見 [docs/db/accounting-accounts-checklist.md](./db/accounting-accounts-checklist.md)。Migration **0070** 僅在尚無該 title 時補齊 Cash、Management Fees、Platform Collection；**0071** 可刪除 0070 新增的三筆（若你表裡已有這些 title，避免重複）。

---

## 架构与数据约定（必读）

- **当前架构：** **前端 Wix** / **后端 Node（ECS）** / **数据库 MySQL**。不再使用 Wix CMS，业务数据全部在 MySQL。
- **Storage（OSS）：** 图片/视频上传走 **阿里云 OSS**（`POST /api/upload`，form：`file` + `clientId`；路径 `uploads/{clientId}/YYYY/MM/`）。**表里存 URL**；已有 URL 保留；新上传统一走 OSS。前端对接 [upload-oss-frontend.md](./wix/upload-oss-frontend.md)、[upload-oss-embed-usage.md](./wix/frontend/upload-oss-embed-usage.md)；**迁移总结**（5 页 Wix Upload→HTML Embed、getUploadCreds、表存 URL）见 [upload-oss-migration-summary.md](./wix/upload-oss-migration-summary.md)。
- **日期与时区：** 客户在马来西亚/新加坡 (UTC+8)。**MySQL 一律存 UTC (UTC+0)**；**datepicker 选 1 Mar 2026 = UTC+8 的 1 Mar**；**读 table 返回前一律按 UTC+8 格式化**。详见 [docs/date-timezone-convention.md](date-timezone-convention.md) 与 `src/utils/dateMalaysia.js`。
- **迁移/开发约定：**
  - 若在 Wix 代码里看到 **CMS 集合名**，但不确定对应 MySQL **哪张表** → **先与维护者确认**，再写/改代码。
  - 若在 Wix 代码里看到 **fieldkey / 字段名**，但不确定对应 MySQL **哪一列** → **先与维护者确认**，再写/改代码。

---

## Wix 调用 ECS 与 manage.jsw（本节汇总近期沟通）

- **架构：** 前端在 Wix，后端在 Node（ECS），数据在 MySQL。Wix 通过 HTTP 调 ECS 接口（如 access context）。
- **认证方式：** **双重认证** — 不是只传 token，而是 **token + username** 两个请求头同时校验：
  - `Authorization: Bearer <token>`（对应 `api_user.token`）
  - `X-API-Username: <username>`（对应 `api_user.username`）
  - ECS 上挂 `apiAuth` 的路由（如 `/api/access`）会校验两者一致才放行。
- **Wix 侧凭证存放：** 在 Wix **Secret Manager** 里配置三个 secret（`ecs_token`、`ecs_username`、`ecs_base_url`），供 backend 的 manage.jsw 使用；用 `wixSecretsBackend.getSecret('ecs_token')` 等取用，不要在前端或代码里写死。
- **错误处理：** Node 宕机/超时/5xx 时，JSW 统一返回 `{ ok: false, reason: 'BACKEND_ERROR' }`，不把 ECS 具体错误暴露给前端。
- **完整 JSW 代码（backend/access/manage.jsw）：** 见 [velo-backend-manage.jsw.snippet.js](./wix/jsw/velo-backend-manage.jsw.snippet.js)（含 Secret Manager 版）；说明与配置步骤见 [velo-backend-manage.jsw.snippet.md](./wix/jsw/velo-backend-manage.jsw.snippet.md)。**如何写 Wix JSW 的约定与步骤**（凭证、认证、错误处理、**返回形状约定**、**IDE 报 Property 'xxx' does not exist 时用 JSDoc @type 断言**）：见 [README-wix-jsw.md](./wix/jsw/README-wix-jsw.md)。

### Admin / Tenant Dashboard 按钮启用规则（门控）

- **Admin Dashboard**（[admindashboard-page-full.js](./wix/frontend/admindashboard-page-full.js)）：公司 Profile 未填好（以 `getProfile()` 返回的 `client.title` 有值为准）时，仅 #buttonprofile、#buttonusersetting、#buttonintegration、#buttontopup 可点；**#buttonadmin**、**#buttonagreementlist** 在 profile 填好后才 enable（`applyAdminMainActions()`，依赖 backend/saas/companysetting 的 `getProfile`）。
- **Tenant Dashboard**（[tenant-dashboard-page-full.js](./wix/frontend/tenant-dashboard-page-full.js)）：**① Profile 优先** — sectionprofile 未完成前只启用 #buttonprofile；#repeatertenantdashboard 内「Approve client」须 profile 完成后才可点，之后才出现待签 agreement。**② 有未签合约** — 只启用 #buttonagreement 与 #dropdownproperty；#buttonmeter、#buttonsmartdoor、#buttonpayment、#buttonfeedback 禁用。**③ 租金未还** — 当前 #dropdownproperty 对应 tenancy 若有未付租金（rental-list 存在 isPaid=false），则 #buttonmeter、#buttonsmartdoor 禁用；#dropdownproperty onChange 时按当前物业重新执行租金门控（`applyRentGateForCurrentProperty()`）。

---

## 数据导入与同步

- **ClientDetail（主表 + 4 张子表）**：清空、CSV 上传、导入、以及「从 clientdetail 表自动同步到子表」的步骤与脚本见 [db/import-clientdetail.md](./db/import-clientdetail.md)。
- 其他 CSV 导入：tenantdetail / ownerdetail / propertydetail / supplierdetail / lockdetail / gatewaydetail / ownerpayout / roomdetail / staffdetail / tenancy / bills(UtilityBills) / agreementtemplate / account(bukkuid) / creditplan / meterdetail / pricingplan / pricingplanaddon / pricingplanlogs 见 [docs/db/](./db/) 内对应 `import-*.md` 及下方「流程总览」中的 step-by-step 链接。
- 库表设计草稿见 [db/db.md](./db/db.md)。**导入约定**：凡 CSV 有 `*_wixid`/`wix_id` 的列必须解析为对应 `_id`（FK），并同步 Junction（如 account→account_client）；见 [db/import-wixid-to-fk-junction-rule.md](./db/import-wixid-to-fk-junction-rule.md)。
- 建表/改表 SQL：`src/db/migrations/`（如 `0001_init.sql`、`0002_clientdetail_subtable_json_columns.sql`），按项目约定执行。

### Wix reference → _wixid / _id 约定（沟通记录）

- **历史：** 在 Wix CMS 里用 reference（如 property、client）；迁到 MySQL 后先有 **`_wixid`** 列（如 `property_wixid`、`client_wixid`）存原 Wix ID。
- **对齐后：** 用 service 对齐 FK 后，每张表会有 **`_id`** 列（如 `property_id`、`client_id`），指向主表 `id`。**有 `property_wixid` 就一定有 `property_id`**，同理 client 等。
- **Node 约定：** **不再使用 _wixid 做主逻辑。** 查询、JOIN、写入 FK 一律用 `client_id`、`property_id` 等；`_wixid` 仅保留给导入/迁移用。详见 Cursor 规则 `mysql-fk-use-id-only.mdc`。

### SaaS 户口层级（总户口 / 子户口 / 租客）与 CNYIoT

- **总户口** = 平台方；**子户口** = Client（clientdetail）= 我们的客户，在 CNYIoT 对应一个房东账号，可登入、管理多电表；**租客** = tenantdetail = client 的租客（不是我们的 tenant）。Client 不是我们的 tenant；租客支付成功后可用现有 API 对该 client 下电表充值。创建 client/租客的导入见 import-clientdetail、import-tenantdetail；在 CNYIoT 创建租客（addUser/link2User）的 wrapper 与 step-by-step 尚未做。详见 [docs/saas-account-model-and-cnyiot.md](./saas-account-model-and-cnyiot.md)。**电表分组与账单规则**（parent+child/sharedUsage、AUTO/MANUAL、Prepaid/Postpaid、Percentage/Divide equally/Room，与 tenancy 无关，12 种组合）见 [meter-billing-spec.md](./meter-billing-spec.md)。

### client 关联与 FK 约定

- **所有关联 client 的外键一律使用 `client_id` → `clientdetail(id)`**，没有用 `client_wixid` 做 FK。
- 表中同时保留 `client_wixid` 与 `client_id`：CSV 导入时先写 Wix ID 到 `client_wixid`，再根据 `clientdetail.wix_id` 解析出 `client_id` 写入；**业务与 Node 代码统一用 `client_id`**。

### 数据导入与迁移流程总览（按执行顺序）

| 阶段 | 迁移 / 建表 | 清空脚本 | 导入脚本 | CSV 示例 | 分步文档 |
|------|-------------|----------|----------|----------|----------|
| ClientDetail + 子表 | 0001, 0002 | clear-client-and-subtables.js / clear-and-import-clientdetail.js | import-clientdetail.js | clientdetail.csv | [import-clientdetail.md](./db/import-clientdetail.md) |
| SupplierDetail | 0003, 0004 | truncate-supplierdetail.js | import-supplierdetail.js | SupplierDetail.csv | [import-supplierdetail.md](./db/import-supplierdetail.md) |
| LockDetail / GatewayDetail | 0005 | truncate-lockdetail.js, truncate-gatewaydetail.js | import-lockdetail.js, import-gatewaydetail.js | LockDetail.csv, GatewayDetail.csv | [import-lockdetail-gatewaydetail-stepbystep.md](./db/import-lockdetail-gatewaydetail-stepbystep.md) |
| OwnerPayout / RoomDetail | 0006, 0007, 0008(建表) | truncate-ownerpayout.js, truncate-roomdetail.js | import-ownerpayout.js, import-roomdetail.js | OwnerPayout.csv, RoomDetail.csv | [import-ownerpayout-roomdetail-stepbystep.md](./db/import-ownerpayout-roomdetail-stepbystep.md) |
| StaffDetail / Tenancy | 0009, 0010, 0011(建表) | truncate-staffdetail.js, truncate-tenancy.js | import-staffdetail.js, import-tenancy.js | StaffDetail.csv, Tenancy.csv | [import-staffdetail-tenancy-stepbystep.md](./db/import-staffdetail-tenancy-stepbystep.md) |
| Bills / AgreementTemplate | 0012, 0013(建表), 0014 | truncate-bills.js, truncate-agreementtemplate.js | import-bills.js, import-agreementtemplate.js | UtilityBills.csv, agreementtemplate.csv | [import-utilitybills-agreementtemplate-stepbystep.md](./db/import-utilitybills-agreementtemplate-stepbystep.md) |
| Account / CreditPlan / MeterDetail (bukkuid 等) | 0015, 0016, 0017 | truncate-account.js, truncate-creditplan.js, truncate-meterdetail.js | import-account.js, import-creditplan.js, import-meterdetail.js | bukkuid.csv, creditplan.csv, meterdetail.csv | 见 [docs/db/](./db/) 脚本速查 |
| PricingPlan / Addon / Logs | 0018 | truncate-pricingplanlogs.js → truncate-pricingplan.js → truncate-pricingplanaddon.js | import-pricingplan.js, import-pricingplanaddon.js, import-pricingplanlogs.js | pricingplan.csv, pricingplanaddon.csv, pricingplanlogs.csv | [import-pricingplan-stepbystep.md](./db/import-pricingplan-stepbystep.md) |
| RentalCollection（发票/租金） | 0039, 0040, 0041, 0042 | truncate-rentalcollection.js | import-rentalcollection.js | rentalcollection.csv | [rentalcollection-import-steps-powershell.md](./db/rentalcollection-import-steps-powershell.md)、[rentalcollection-import-columns.md](./db/rentalcollection-import-columns.md) |

**迁移文件列表（顺序）**：`0001_init.sql` → … → `0019_create_api_user.sql` → `0020`～`0032` → `0033`～`0037`（agreement、owner_client/owner_property）→ `0038_create_feedback.sql` → `0039`～`0042`（rentalcollection）→ `0044`～`0049` → **`0050_tenantdetail_backfill_client_id_fk.sql`** → `0051`～`0052`（account_client junction）→ **`0053`**～**`0055`**（agreement）→ **`0056_client_profile_stripe_connect_pending_id.sql`** → … → **`0069_clientdetail_bukku_saas_contact_id.sql`**（clientdetail.bukku_saas_contact_id，平台 Bukku 開單用）→ **`0070_seed_account_cash_management_platform.sql`**（僅當無該 title 時補 Cash/Management Fees/Platform Collection）→ **`0071_remove_0070_seeded_account_rows.sql`**（可選，刪除 0070 新增的三筆若表裡已有）→ **`0072_clientdetail_cnyiot_ttlock_subuser.sql`**（clientdetail.cnyiot_subuser_id / cnyiot_subuser_login / ttlock_username，Company Setting 開戶後方便讀取）→ **`0073_clientdetail_cnyiot_ttlock_manual.sql`**（cnyiot_subuser_manual / ttlock_manual，1=客戶自己登入原有戶口）。执行方式：`node scripts/run-migration.js src/db/migrations/xxxx_*.sql` 或一次性执行全部见 [docs/db/run-all-migrations-paste.md](./db/run-all-migrations-paste.md)，见 [PASTE-STEPS.md](./wix/PASTE-STEPS.md)。

### 脚本 scripts 速查

| 脚本 | 用途 |
|------|------|
| `clear-and-import-clientdetail.js [csv]` | 清空 clientdetail + 4 子表后导入 CSV（默认 `./clientdetail.csv`） |
| `clear-client-and-subtables.js` | 仅清空 clientdetail + client_integration / client_profile / client_pricingplan_detail / client_credit |
| `import-clientdetail.js [csv]` | 仅导入 clientdetail + 子表，不清空 |
| `verify-and-sync-client-subtables.js` | 检查行数 + 从 clientdetail 四列重新同步到 4 张子表 |
| `import-tenantdetail.js` / … / `import-bills.js` / `import-agreementtemplate.js` | 各表 CSV 导入（见 [docs/db/](./db/) 对应 stepbystep 或 import-*.md） |
| `truncate-supplierdetail.js` | 清空 supplierdetail 表（见 [db/import-supplierdetail.md](./db/import-supplierdetail.md)） |
| `truncate-lockdetail.js` / `truncate-gatewaydetail.js` | 清空 lockdetail / gatewaydetail（见 [db/import-lockdetail-gatewaydetail-stepbystep.md](./db/import-lockdetail-gatewaydetail-stepbystep.md)） |
| `truncate-ownerpayout.js` / `truncate-roomdetail.js` | 清空 ownerpayout / roomdetail（见 [db/import-ownerpayout-roomdetail-stepbystep.md](./db/import-ownerpayout-roomdetail-stepbystep.md)） |
| `truncate-staffdetail.js` / `truncate-tenancy.js` | 清空 staffdetail / tenancy（见 [db/import-staffdetail-tenancy-stepbystep.md](./db/import-staffdetail-tenancy-stepbystep.md)） |
| `truncate-bills.js` / `truncate-agreementtemplate.js` | 清空 bills / agreementtemplate（见 [db/import-utilitybills-agreementtemplate-stepbystep.md](./db/import-utilitybills-agreementtemplate-stepbystep.md)） |
| `truncate-account.js` / `truncate-creditplan.js` / `truncate-meterdetail.js` | 清空 account / creditplan / meterdetail（见 [docs/db/](./db/)） |
| `truncate-pricingplanlogs.js` / `truncate-pricingplan.js` / `truncate-pricingplanaddon.js` | 清空 pricingplanlogs / pricingplan / pricingplanaddon（见 [db/import-pricingplan-stepbystep.md](./db/import-pricingplan-stepbystep.md)） |
| `import-pricingplan.js` / `import-pricingplanaddon.js` / `import-pricingplanlogs.js` | 导入 pricingplan.csv / pricingplanaddon.csv / pricingplanlogs.csv（见 [db/import-pricingplan-stepbystep.md](./db/import-pricingplan-stepbystep.md)） |
| `truncate-rentalcollection.js` | 清空 rentalcollection 表（重导前使用，见 [rentalcollection-import-steps-powershell.md](./db/rentalcollection-import-steps-powershell.md)） |
| `import-rentalcollection.js [csv_path]` | 导入 rentalcollection.csv：CSV ID→wix_id、id 用新 UUID；client_id/property_id/room_id/tenant_id/type_id/tenancy_id 由各表 wix_id 解析填入（见 [rentalcollection-import-columns.md](./db/rentalcollection-import-columns.md)） |
| `run-migration.js [path]` | 执行 migrations 目录下 SQL；可传路径如 `src/db/migrations/0019_create_api_user.sql`、`0069_clientdetail_bukku_saas_contact_id.sql`、`0070_seed_account_cash_management_platform.sql`、`0071_remove_0070_seeded_account_rows.sql`、`0072_clientdetail_cnyiot_ttlock_subuser.sql`、`0073_clientdetail_cnyiot_ttlock_manual.sql` |
| `run-0069-bukku-contact-id.sh` | 執行 0069：clientdetail 新增 bukku_saas_contact_id（平台 Bukku 開單用） |
| `migrate-account-json-to-account-client.js` | 將 account.account_json 內所有 client 對應遷移到 account_client 表 |
| `check-agreement-columns.js` | 检查 agreement 表是否已有 0053/0054/0055 列（hash_draft、hash_final、version、*_signed_ip、columns_locked）；缺则 exit 1 |
| `insert-api-user.js [username]` | 新增一条 `api_user`（token 自动生成），例：`node scripts/insert-api-user.js saas_wix` |
| `find-unused-db-columns.js` | 检测 src/、scripts/ 中未引用的 DB 列，输出见 [unused-columns-report.md](./db/unused-columns-report.md)；`node scripts/find-unused-db-columns.js` |

---

## Bukku API wrapper 一览

**认证：** Bearer Token + `Company-Subdomain` header；每个 client 自己的 token/subdomain（来自 clientdetail），不 refresh。

**目录：** `src/modules/bukku/` — 共用 `bukkurequest.js`、`lib/bukkuCreds.js`；每个资源独立 **validator**（Joi）+ **wrapper**（调 Bukku）+ **routes**。请求先 Joi 校验再进 wrapper。

---

## AutoCount API wrapper 一览

- **认证：** API Key（静态），非 OAuth。每个请求带 HTTP header `API-Key`、`Key-ID`；路径含 `accountBookId`（账本 ID）。凭证来自 Cloud Accounting 后台 Settings → API Keys。
- **官方文档：** [Cloud Accounting Integration API](https://accounting-api.autocountcloud.com/documentation/)（含 Master Data：Account、Product；Invoice；Journal Entry 等）。
- **目录：** `src/modules/autocount/` — `wrappers/autocountrequest.js`、`lib/autocountCreds.js`（从 `client_integration` key=addonAccount, provider=autocount 读 apiKey/keyId/accountBookId）；**`wrappers/account.wrapper.js`**（Account：listAccounts、getAccount、createAccount）、**`wrappers/product.wrapper.js`**（Product：listProducts、getProduct、createProduct）；`wrappers/invoice.wrapper.js`、`validation.wrapper.js`、`einvoice.wrapper.js`；`validators/invoice.validator.js`；`routes/invoice.routes.js`。
- **HTTP 路由：** `POST /api/autocount/invoices`（创建发票）、`GET /api/autocount/invoices?docNo=xxx`（查发票）、`POST /api/autocount/invoices/void`、`POST /api/autocount/invoices/validate`（e-invoice 校验）、`POST /api/autocount/invoices/e-invoice/submit`、`POST /api/autocount/invoices/e-invoice/cancel`、`GET /api/autocount/invoices/e-invoice/status?docNo=xxx`。client 由 clientresolver 解析。
- **Company Setting 连接：** 客户在 #boxonboard 填写 API Key、Key ID、Account Book ID，提交调用 `autocountConnect`；断开用 `autocountDisconnect`。详见 [docs/readme/index.md#autocount-api-wrapper](./readme/index.md#autocount-api-wrapper)、[docs/readme/index.md#company-setting-页面ecs-迁移](./readme/index.md#company-setting-页面ecs-迁移)。

---

## SQL Account API wrapper（马来西亚会计软件 sql.com.my）

- **产品：** [SQL Account](https://www.sql.com.my/)（E Stream MSC），马来西亚会计软件，支持 LHDN e-Invoice 等。
- **官方 API 文档：** **[SQL Accounting Linking](https://wiki.sql.com.my/wiki/SQL_Accounting_Linking)** — 官方 API / 对接总览；含四种对接方式：**SDK Live**（推荐，支持 Node.js、约 95% 模块、实时/批次）、XLS/MDB Import、XML Import、Text Import。本仓库的 wrapper 针对 **HTTP REST API**（Access Key + Secret Key + AWS Sig v4），可与 Postman Collection 配合使用。
- **认证：** 在 SQL Account 内 **Tools > Maintain User > API Secret Key** 生成 **Access Key** 与 **Secret Key**；请求使用 **AWS Signature Version 4** 签名。生成后该用户仅能用于 API，无法再登录桌面端。
- **目录：** `src/modules/sqlaccount/` — `lib/sqlaccountCreds.js`、`wrappers/sqlaccountrequest.js`、`wrappers/agent.wrapper.js`；`routes/sqlaccount.routes.js`。Base URL 可为 on-prem（SQL Mobile Connect）或厂商提供之 API 地址，由环境变量或 client_integration（provider=sqlaccount）配置。
- **HTTP 路由（Base: `/api/sqlaccount`）：** `GET /agent`（列 Agent；路径以实际 Postman 为准）、`POST /request`（body: `{ method, path, data?, params? }`，通用请求任意 endpoint）。
- **更多文档：** [Setup and Configuration](https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration)、[SQL Account API](https://docs.sql.com.my/sqlacc/category/sql-account-api)。Postman Collection 需在 SQL Account 内「Download Postman Collection」取得具体 endpoint。

---

## TTLock API wrapper（SaaS 多人调用）

- **认证：** 每 client 用 `client_integration`（key=smartDoor, provider=ttlock）的 ttlock_username / ttlock_password 换 token，token 存 `ttlocktoken` 表（按 client_id），自动 refresh。调用 TTLock 时用 **TTLock Open Platform** 的 app 凭证（env：`TTLOCK_CLIENT_ID`、`TTLOCK_CLIENT_SECRET`）。
- **目录：** `src/modules/ttlock/` — lib（ttlockToken.service、ttlockCreds、ttlockRegister、ttlockSubuser）、wrappers、validators、routes（lock、gateway、user）。详见 [docs/readme/index.md](./readme/index.md#ttlock-api-wrappersaas-多人调用)。
- **HTTP 路由：** `GET/POST /api/ttlock/locks`、`GET/POST /api/ttlock/gateways`、`POST /api/ttlock/users/ensure-subuser`（为 client 确保 TTLock 子账号）。client 由 clientresolver 解析，`req.client.id` 即 clientId。
- **程序调用：** `ttlock.lock.listAllLocks(clientId)`、`ttlock.gateway.listAllGateways(clientId)`、`ttlock.getValidTTLockToken(clientId)`、`ttlock.ensureTTLockSubuser(clientId)`。
- **子账号：** 平台可为每个 client 开 TTLock 子账号。**Username 与 password 均由我们 SaaS 设定**（非 TTLock 随机）：username=该 client 的 subdomain，password=我们设定的默认密码，存 client_integration。详见 [docs/ttlock-subuser.md](./ttlock-subuser.md)。

---

## CNYIoT API wrapper（SaaS 多人调用）

- **认证：** 每 client 用 `client_integration`（key=meter, provider=cnyiot）登录，apiKey + loginID 存 `cnyiottokens`，24h 缓存；apiKey 用 env `CNYIOT_AES_KEY` AES-ECB 加密后传参。**直连官方 API**：base `https://www.openapi.cnyiot.com/api.ashx`；可覆盖 `CNYIOT_BASE_URL`。`CNYIOT_API_ID` 默认 coliman。5002 自动清 token 重试。
- **目录：** `src/modules/cnyiot/` — lib（token、encrypt、getClientTel）、wrappers（cnyiotRequest、meter、price、sync）、validators、routes。详见 [docs/readme/index.md](./readme/index.md#cnyiot-api-wrappersaas-多人调用)。**官方接口对照：** [docs/cnyiot-api-doc-mapping.md](./cnyiot-api-doc-mapping.md)（api.ashx、Method、错误码）。

---

### 路由 → 代码对应表（一看就懂用哪个 validator/wrapper）

| 本机 API 路径 | Bukku 资源 | Validator 文件 | Wrapper 文件 |
|---------------|------------|----------------|--------------|
| **Sales 销售** |
| `/api/bukku/invoices` | 发票 | `invoice.validator.js` | `invoice.wrapper.js` |
| `/api/bukku/quotes` | 报价单 | `quote.validator.js` | `quote.wrapper.js` |
| `/api/bukku/orders` | 订单 | `order.validator.js` | `order.wrapper.js` |
| `/api/bukku/delivery_orders` | 送货单 | `deliveryOrder.validator.js` | `deliveryOrder.wrapper.js` |
| `/api/bukku/credit_notes` | 销项贷项单 | `creditNote.validator.js` | `creditNote.wrapper.js` |
| `/api/bukku/payments` | 销项付款 | `invoicepayment.validator.js` | `invoicepayment.wrapper.js` |
| `/api/bukku/refunds` | 销项退款 | `refund.validator.js` | `refund.wrapper.js` |
| **Purchases 采购** |
| `/api/bukku/purchases/orders` | 采购单 | `purchaseOrder.validator.js` | `purchaseOrder.wrapper.js` |
| `/api/bukku/purchases/goods_received_notes` | 收货单 | `goodsReceivedNote.validator.js` | `goodsReceivedNote.wrapper.js` |
| `/api/bukku/purchases/bills` | 采购账单 | `purchaseBill.validator.js` | `purchaseBill.wrapper.js` |
| `/api/bukku/purchases/credit_notes` | 采购贷项单 | `purchaseCreditNote.validator.js` | `purchaseCreditNote.wrapper.js` |
| `/api/bukku/purchases/payments` | 采购付款 | `purchasePayment.validator.js` | `purchasePayment.wrapper.js` |
| `/api/bukku/purchases/refunds` | 采购退款 | `purchaseRefund.validator.js` | `purchaseRefund.wrapper.js` |
| **Banking 银行** |
| `/api/bukku/banking/incomes` | Money In 收款 | `bankingIncome.validator.js` | `bankingIncome.wrapper.js` |
| `/api/bukku/banking/expenses` | Money Out 付款 | `bankingExpense.validator.js` | `bankingExpense.wrapper.js` |
| `/api/bukku/banking/transfers` | 转账 | `bankingTransfer.validator.js` | `bankingTransfer.wrapper.js` |
| **Contacts 联系人** |
| `/api/bukku/contacts` | 联系人 | `contact.validator.js` | `contact.wrapper.js` |
| `/api/bukku/contacts/groups` | 联系人分组 | `contactGroup.validator.js` | `contactGroup.wrapper.js` |
| **Products 产品** |
| `/api/bukku/products` | 产品 | `product.validator.js` | `product.wrapper.js` |
| `/api/bukku/products/bundles` | 产品组合 | `productBundle.validator.js` | `productBundle.wrapper.js` |
| `/api/bukku/products/groups` | 产品分组 | `productGroup.validator.js` | `productGroup.wrapper.js` |
| **Accounting 会计** |
| `/api/bukku/journal_entries` | 日记账分录 | `journalEntry.validator.js` | `journalEntry.wrapper.js` |
| `/api/bukku/accounts` | 会计科目 | `account.validator.js` | `account.wrapper.js` |
| `/api/bukku/lists` | 批量拉取列表 (v2/lists) | `list.validator.js` | `list.wrapper.js` |
| **Xero（addonAccount，OAuth2）** |
| `/api/xero/accounts` | 会计科目 | `account.validator.js` | `account.wrapper.js` |
| `/api/xero/invoices` | 发票（含 e-invoice） | `invoice.validator.js` | `invoice.wrapper.js` |
| **AutoCount（addonAccount，API Key）** |
| `/api/autocount/invoices` | 发票（创建/查询/void/validate/e-invoice 提交/取消/状态） | `invoice.validator.js` | `invoice.wrapper.js`、`validation.wrapper.js`、`einvoice.wrapper.js` |
| **Files 文件** |
| `/api/bukku/files` | 文件上传/列表/单条 | `file.validator.js` | `file.wrapper.js` |
| **Control Panel 控制面板** |
| `/api/bukku/locations` | 地点 | `location.validator.js` | `location.wrapper.js` |
| `/api/bukku/tags` | 标签 | `tag.validator.js` | `tag.wrapper.js` |
| `/api/bukku/tags/groups` | 标签组 | `tagGroup.validator.js` | `tagGroup.wrapper.js` |

---

### 说明摘要

- **Banking PATCH 状态：** 做 `void` 时必填 `void_reason`（MyInvois 要求）。
- **Contacts：** Create 返回 201；PATCH 为 archive/unarchive（`is_archived`）。
- **Products：** Create 返回 201；Bundles 无 list 接口。
- **Journal entries：** 与 Banking 类似，PATCH 改状态时 void 需 `void_reason`。
- **Accounts：** PATCH 为 archive/unarchive；Update 时 `code` 必填。
- **Account 表與 account_client：** account 為科目範本（全站共用）；Account 設定頁存檔只寫 **account_client**（每 client 每系統的 accountid 對應），不再寫 account_json。查詢時先 account_client、再 fallback account_json。見本 index「Account 表與 account_client」節；遷移既有資料：`node scripts/migrate-account-json-to-account-client.js`。支持多会计商（`account.provider`）：`bukku`（默认）、`xero`，见 migration `0040_account_provider.sql`。
- **Xero：** 认证使用 OAuth2（与 Stripe 类似）。**App ID = Client ID**：在 [developer.xero.com](https://developer.xero.com/app/manage) 创建应用后得到，填入 `.env` 的 `XERO_CLIENT_ID`、`XERO_CLIENT_SECRET`；在 Xero 应用配置里填写 **Redirect URI**（与前端传入的 `redirectUri` 一致，如公司设置页 URL）。Token 存 `client_integration`（addonAccount, provider=xero）。Company setting：按钮点击 → `getXeroAuthUrl({ redirectUri })` 取 `url` → 跳转 Xero 授权 → 用户回到 redirectUri?code=... → 前端调 `xeroConnect({ code, redirectUri })`，后端返回 `{ ok: true, tenantId }`。**Webhook（可选）：** 若需接收 Xero 的发票/联系人变更通知，在 Xero 应用里配置 Webhooks：Delivery URL = `https://api.colivingjb.com/api/xero/webhook`，勾选 Invoices（及 Contacts 按需）；创建后把 Xero 给的 **Webhook signing key** 填入 `.env` 的 `XERO_WEBHOOK_KEY`。未配置 `XERO_WEBHOOK_KEY` 时接口返回 501。
- **Company Setting 集成（Accounting / Meter / Smart Door）：** `getOnboardStatus` 只统计 `client_integration.enabled = 1` 的集成，故 disconnect（设 enabled=0）后再次拉取会得到对应 false，前端 `refreshOnboardButtonLabels()` 会更新按钮 label 与颜色。**Accounting**：返回 `accountingProvider`（xero/bukku/sql/autocount 或 null）；已连时点击打开 #boxonboard — **Bukku**（Token/Subdomain/#checkboxeinvoiceonboard）、**AutoCount**（API Key/Key ID/Account Book ID）、**Xero**（仅 #checkboxeinvoiceonboard）；`getBukkuCredentials`/`getAutoCountCredentials` 预填；断开各调 `bukkuDisconnect`/`autocountDisconnect`/`xeroDisconnect`。**Meter (CNYIOT)**：创建子账号 contact/subdomain 从 **client_profile** 取；Edit Meter 时 #inputpasswordonboard 无存密则显示默认 **0123456789**；选「Connect to old account」点 Connect 时若有已存凭证则直接 `cnyiotConnect({ mode: 'existing' })`，成功则更新 #buttoncnyiotonboard 为「Meter Edit」并关闭 #boxaccountselection。**Smart Door (TTLock)**：选「Connect to old account」时直接 `ttlockConnect({ mode: 'existing' })`，成功则更新 #buttonttlockonboard 为「Smart Door Edit」并关闭 #boxaccountselection。后端 API：`getCnyiotCredentials`、`cnyiotConnect`、`cnyiotDisconnect`、`getTtlockCredentials`、`ttlockConnect`、`ttlockDisconnect`。JSW 见 [velo-backend-saas-companysetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-companysetting.jsw.snippet.js)、前端 [companysetting-page-full.js](./wix/frontend/companysetting-page-full.js)。详见 [docs/readme/index.md#company-setting-页面ecs-迁移](./readme/index.md#company-setting-页面ecs-迁移)。
- **Lists：** 仅 POST，body 为 `{ lists: string[], params?: array }`，lists 取值见 validator 内 `listNames`。
- **Files：** POST 为 multipart（字段名 `file`），使用 multer + form-data 转发到 Bukku。
- **Locations：** Bukku 单条接口为 `/location/{id}`（单数），列表为 `/locations`。
- **Tags / Tag groups：** 子路径 `/tags/groups` 挂在 tags 路由下。

### Access 门禁（后端迁移自 Wix backend/access/manage.jsw）

- **API：** `POST /api/access/context`（body: `{ email }`）或 `GET /api/access/context?email=xxx`。返回 access context（staff、client、plan、capability、credit、expired）。`capability.accounting` = 套餐是否允许 Accounting；`capability.accountProvider` = 已接会计系统 provider（有值=已 onboard）；**`capability.accountingReady`** = 已 onboard 且 Account Setting 页所有 item 已 sync；`capability.accountingSyncedTotal` / `accountingSyncedMapped` = 模板总数 / 已映射数（可显示「3/5 synced」）。前端 JSW 用当前用户 email 调此接口。
- **门禁拒绝统一约定与 #sectiontab：** 拒绝时文案：NO_PERMISSION → "You don't have permission"，其余 → "You don't have account yet"；须留在 #sectiondefault、主按钮 disable。**#sectiontab** 为入口栏，始终 expand & show；无 credit 且进入 sectiontopup、或无 permission 时 sectiontab 内按钮全部 disable。Permission 与页面/按钮对应、各页 sectiontab 内按钮列表见 [ACCESS-DENIED-CONVENTION.md](./wix/jsw/ACCESS-DENIED-CONVENTION.md)；门禁 Helper 见 [ACCESS-HELPER.md](./wix/jsw/ACCESS-HELPER.md)。
- **前端显示 "You don't have account yet"：** 表示 `accessCtx.ok === false`，真实原因在 `accessCtx.reason`。常见为 **NO_STAFF**（MySQL staffdetail 无该 email）。排查步骤与 reason 对照表见 [troubleshoot-access-denied.md](./wix/frontend/troubleshoot-access-denied.md)。
- **代码：** `src/modules/access/access.service.js`、`src/modules/access/access.routes.js`。数据来自 MySQL：staffdetail、clientdetail、client_credit、client_pricingplan_detail。

### API User / Token（Open API 第三方）

- **用途：** 给第三方 Open API 用。在表里加一条记录 = 新增一个 API 用户：**username 手动输入**，**token 系统自动生成**；密码在该表上单独 **create / edit / delete / modify**，每用户独立（**不建议使用 ECS 登入密码**，以免泄露服务器权限）。
- **表：** `api_user`（id, username, password_hash, token, status, created_at, updated_at）。建表：`0019_create_api_user.sql`，执行 `node scripts/run-migration.js src/db/migrations/0019_create_api_user.sql`。
- **Wix / 第三方调用（双重认证）：** 需要**两个**请求头：**`Authorization: Bearer <token>`**（表里 `token` 列）+ **`X-API-Username: <username>`**（表里 `username` 列）。挂 `apiAuth` 的路由会校验 token 有效且对应用户的 username 与请求头一致。新增用户：`node scripts/insert-api-user.js <username>`（如 `saas_wix`）。
- **管理接口（需带 header `x-admin-key: <ADMIN_API_KEY>`）：**
  - `GET /api/admin/api-users` 列表
  - `POST /api/admin/api-users` 新增 body `{ username, password? }`，返回带自动生成的 `token`
  - `GET /api/admin/api-users/:id`
  - `PATCH /api/admin/api-users/:id` 改 username / status
  - `PATCH /api/admin/api-users/:id/password` 改密码 body `{ password }`
  - `DELETE /api/admin/api-users/:id` 删除
- **环境变量：** `ADMIN_API_KEY` 需在 `.env` 中配置，管理接口才会放行。
- **校验（token + username）：** 需要双重认证的路由可挂 `src/middleware/apiAuth.js`，请求头必须同时带 `Authorization: Bearer <token>` 与 `X-API-Username: <username>`，通过后 `req.apiUser` 为对应用户（id, username, token, status）。
- **常见问题：**
  - **表在 DMS 里看不到？** 执行迁移：`node scripts/run-migration.js src/db/migrations/0019_create_api_user.sql`。
  - **Edit（改 username/status）要密码吗？** 不要。PATCH `/api/admin/api-users/:id` 只需请求头 `x-admin-key`，不需 API 用户密码；只有「改该用户密码」时用 PATCH `.../password`，body 里传新密码。
  - **用 ECS 编辑要密码吗？** 分两种：（1）通过 Admin API 在 ECS 上调接口 → 需要带 `x-admin-key`（即 `.env` 里的 `ADMIN_API_KEY`），不是 ECS 登入密码；（2）在 DMS 里直接改 MySQL 的 `api_user` 表 → 用的是**数据库账号密码**（连 MySQL 的 user/password），与 `api_user` 表里的 password 无关。

### Billing 计费（后端迁移自 Wix backend/billing/billing.jsw）

- **API：** 所有接口需传 `email`（POST body 或 GET query）以解析 access context；需 staff 具 billing 或 admin 权限。
  - `GET` / `POST` `/api/billing/my-info`：当前 client 的计费信息（currency、title、plan、credit、expired、pricingplandetail）。
  - `GET` / `POST` `/api/billing/credit-statements`：分页流水，query/body 可选 `page`、`pageSize`、`sort`（`new`|`old`|`amountAsc`|`amountDesc`）、`filterType`（`Topup`|`Spending`）、`search`；返回 `{ items, total, page, pageSize }`。**注意：** 流水数据依赖 MySQL 的 creditlogs 表，表名/字段确认后需在 `billing.service.js` 内实现查询。
  - `GET` / `POST` `/api/billing/statement-items`：合并 creditlogs + pricingplanlogs 的 Event Log 流水，query/body 可选 `page`、`pageSize`、`sort`（`new`|`old`|`amountAsc`|`amountDesc`）、`filterType`（`Topup`|`Spending`|`creditOnly`|`planOnly`）、`search`；返回 `{ items, total, page, pageSize }`。
  - `POST` `/api/billing/statement-export`：导出流水为 Excel。Body 可选 `sort`、`filterType`、`search`（与当前 Event Log 筛选一致）。Node 用 xlsx 生成文件、存入 downloadStore，返回 **`{ downloadUrl }`**（一次性 `/api/download/:token`）。前端 JSW 提供 `getStatementExportUrl(opts)`，页面 `wixLocation.to(downloadUrl)` 触发下载，不依赖前端 XLSX/document。
  - `POST` `/api/billing/clear-cache`：清空当前 client 的计费缓存。
- **Pricing plan 支付：** 访客在 Wix Billing 页选 plan 后调 `POST /api/billing/checkout/confirm`。**金额 &lt; 1000**：返回 Stripe Checkout `url`，点击 #buttonconfirmpricingplan 跳转支付后 webhook 自动更新 client plan。**金额 ≥ 1000**：不创建 Stripe，返回 `provider: 'manual'`；前端显示 #boxproblem、#titleboxproblem（与 setupProblemBox 相同内容 + 单号）、#buttoncloseproblem；同时后端写入 **help/ticket**（mode=`billing_manual`），便于在工单列表看到「client 需要 upgrade/renew 大额」。Topup 金额 &gt; 1000 时前端显示 #boxproblem2 并提交 **help/ticket**（mode=`topup_manual`）。阈值见 `checkout.service.js` 中 `PRICING_PLAN_STRIPE_MAX_AMOUNT`（默认 1000）。
- **平台 SaaS Bukku 開單（topup / pricing plan）：** 手動或 Stripe 成功後會在**平台自家 Bukku** 開 cash invoice；contact 用該 client 的 **clientdetail.bukku_saas_contact_id**（insert clientdetail 時會建立 Bukku contact 並寫回；若無則 `ensureClientBukkuContact` 會補建）。開單 item description 含 client name、when、payment method、amount、currency、credit before/after（topup）或 plan（pricing plan）。env：`BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`、`BUKKU_SAAS_DEFAULT_CONTACT_ID`（fallback）、`BUKKU_SAAS_ACCOUNT`/`PAYMENT_BANK`/`PAYMENT_STRIPE` 等。Migration **0069** 新增 clientdetail.bukku_saas_contact_id。
- **代码：** `src/modules/billing/billing.service.js`、`src/modules/billing/billing.routes.js`、`checkout.service.js`、`saas-bukku.service.js`、`indoor-admin.service.js`。数据来自 MySQL：clientdetail（含 pricingplandetail、credit、bukku_saas_contact_id）、pricingplan、pricingplanaddon、creditlogs、pricingplanlogs。
- **Addon 如何记录：** 访客在 Billing 页选择的 addon 写入 `clientdetail.pricingplandetail`（JSON 数组），并同步到子表 `client_pricingplan_detail`（type=`addon`，plan_id=pricingplanaddon.id，qty）。`getMyBillingInfo` 与 `getAccessContext` 均返回当前 client 的 plan + addons（含 title、qty）。**三个 addon 与功能：**（1）**HR Salary** — 尚未实现。（2）**Bank Bulk Transfer System** — 在 Expenses 与 Generate Report 页：无此 addon 时「银行批量」按钮 disable；API `POST /api/bank-bulk-transfer`、`/files` 会校验 addon，无则 403 `ADDON_REQUIRED`。（3）**Extra User** — 在 Company Setting 的 User Setting：最大人数 = 1 + addon 的 qty；`getStaffList` 返回 `maxStaffAllowed`，`createStaff` 超限返回 403 `STAFF_LIMIT_REACHED`；前端 `#buttonnewuser` 在达到上限时 disable。Addon 与功能通过 pricingplanaddon 的 **title** 匹配（如 title 含 "bank bulk transfer"、"extra user"）。

### Stripe 支付封装（Client 充值 credit / Tenant 租金 Connect / Tenant 付发票与 Meter）

- **三种场景（全部 Stripe Checkout，跳转 Stripe 页支付；金额与描述服务端固定，付完/取消回同一页）：**（1）**Client 充值 credit**：`POST /api/stripe/create-checkout-credit-topup` 返回 url，跳转支付后 webhook 写入 `client_credit`。（2）**Tenant 付租金**：`POST /api/stripe/create-checkout-rent` 跳转支付；Stripe Connect，按 client credit 是否足够 1% 决定是否 release 到 Connect。（3）**Tenant Dashboard 付发票 / Meter 充值**：`POST /api/tenantdashboard/create-payment`（type=invoice 或 meter）创建 Checkout；webhook 校验 paid + 金额一致后 UPDATE **rentalcollection** 或 **metertransaction**。
- **平台规则：** Processing fees 由 SaaS 吸收；每笔 transaction markup 1%（从 client credit 扣）；client 无/不足 credit 时不 release 租金。
- **环境变量（.env）：** `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`；Live/Sandbox 双套与 `client_profile.stripe_sandbox`（迁移 0060）见 [stripe.md](./stripe.md)。
- **API：** `POST /api/stripe/create-checkout-credit-topup`、`create-checkout-rent`（均需 returnUrl、cancelUrl 同一页）、`release-rent`、`GET /api/stripe/credit-balance`、`connect-account`、`config?clientId=`；Tenant 支付走 `POST /api/tenantdashboard/create-payment`。Webhook 事件：`checkout.session.completed`、`account.updated`。
- **数据库：** `client_profile.stripe_connected_account_id`（0029）、`stripe_connect_pending_id`（0056）、`stripe_sandbox`（0060）；rentalcollection（paidat、referenceid、ispaid）；metertransaction（ispaid、referenceid、status）。
- **Stripe 入账（Settlement Journal）：** 每 client 每 payout 日一筆會計分錄（DR Bank / CR Stripe）；只處理 `stripepayout` 表裡 `journal_created_at IS NULL` 的列，已寫過 skip；有 stripepayout 記錄才入賬。Journal 描述含 **Settlement ID**（stripepayout.id）便於對賬。每日 cron 一次撈全部 pending 處理完；詳見 [cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)、`src/modules/stripe/settlement-journal.service.js`。
- **完整说明与流程：** [docs/stripe.md](./stripe.md)、[readme/index.md#stripe-支付封装](./readme/index.md#stripe-支付封装saas)、[readme/index.md#tenant-dashboard-页面](./readme/index.md#tenant-dashboard-页面ecs-迁移)。

### 每日定时任务（Cron）

- **接口：** `POST /api/cron/daily`（Header `X-Cron-Secret` = `.env` 的 `CRON_SECRET`），建议每天 00:00 UTC+8 调用一次。
- **Daily 执行顺序（完整，代码已实现）：**
  1. **欠租检查** — 找出「过去到期未付」的 rentalcollection（`date < 今天`），对应 tenancy 锁门、断电、设 active=0；queue 分批 500 笔，当次跑完不隔夜。
  2. **房间可租同步** — 按 tenancy **日期**（只认今天落在 [begin, end] 内的 tenancy）更新 roomdetail.available / availablesoon / availablefrom。
  3. **Refund deposit** — 租约 end &lt; 今天且未续约、deposit&gt;0、尚无 refunddeposit 时写入 refunddeposit，Admin Dashboard 可见并处理。
  4. **Pricing plan 到期** — clientdetail.expired &lt; 今天且未 renew 则 client 设为 inactive（status=0）；tenant 仍可付，admin 页面 no function。
  5. **Core credit 到期日清空** — clientdetail.credit 中 core 项 expired ≤ 今天则移除并汇总；写 creditlogs（type=Expired，amount 负值），**title 与 remark 写入到期日**（如 `Core credit expired (YYYY-MM-DD)`、`Expired date: YYYY-MM-DD`），Billing 页与 manual SaaS 流水可见。
  6. **每月 1 号 active room 扣费** — 仅当当天为 1 号时：按 roomdetail.active=1 数量每间扣 10 credit，幂等同月不重复。
  7. **Stripe 入账** — 对 `stripepayout` 中 `journal_created_at IS NULL` 的列逐笔做会計分錄（DR Bank, CR Stripe），描述含 Settlement ID；每 client 每 payout 日一筆，已寫過 skip，一次撈全部處理完。
  8. **门锁电量 &lt; 20%** — 写入 feedback 表。
- **详细步骤与 env：** [cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)。代码：`tenancy-cron.routes.js`、`tenancy-active.service.js`、`refund-deposit-cron.service.js`、`pricing-plan-expiry-cron.service.js`、`core-credit-expiry-cron.service.js`、`active-room-monthly-cron.service.js`、`battery-feedback-cron.service.js`、`settlement-journal.service.js`。

### Agreement 协议上下文（后端迁移自 Wix backend/access/agreementdetail.jsw）

- **API：** 所有接口需传 `email`（POST body）以解析 access context；返回协议模板变量与元数据（或 `{ ok: false, reason }`）。
  - `POST` `/api/agreement/tenant-context`：Body `{ email, tenancyId, agreementTemplateId, staffVars? }`，租客↔运营方协议变量。
  - `POST` `/api/agreement/owner-context`：Body `{ email, ownerId, propertyId, clientId, agreementTemplateId, staffVars? }`，业主↔运营方协议变量。
  - `POST` `/api/agreement/owner-tenant-context`：Body `{ email, tenancyId, agreementTemplateId, staffVars? }`，业主↔租客协议变量。
  - `POST` `/api/agreement/owner-tenant-html`：Body 同上，返回替换变量后的 HTML（`{ ok: true, html }` 或错误）。
  - `POST` `/api/agreement/is-data-complete`：Body `{ email, agreementId }`，资料是否齐（可生成 PDF）。
  - `POST` `/api/agreement/prepare-for-signature`：Body `{ email, agreementId }`，资料齐时生成 draft PDF、hash_draft、status=ready_for_signature。
  - `POST` `/api/agreement/try-prepare-draft`：Body `{ email, agreementId }`，Hook 1：资料齐则生成 draft PDF（幂等）。
- **代码：** `src/modules/agreement/agreement.service.js`、`agreement.routes.js`、`google-docs-pdf.js`（Google Docs/Drive 封装）。数据来自 MySQL：agreement、agreementtemplate、tenancy、tenantdetail、roomdetail、propertydetail、clientdetail、ownerdetail；关联一律用 `_id`。
- **Wix JSW：** 粘贴 [velo-backend-agreementdetail.jsw.snippet.js](./wix/jsw/velo-backend-agreementdetail.jsw.snippet.js) 到 `backend/access/agreementdetail.jsw`，Secret Manager 配置与 billing 相同（`ecs_token`、`ecs_username`、`ecs_base_url`）。导出 `getTenantAgreementContext`、`getOwnerAgreementContext`、`getOwnerTenantAgreementContext`、`getOwnerTenantAgreementHtml`，参数与 Node API 一致；成功返回 Node 原始 JSON（含 `ok: true` 与 `variables` 等），失败 `{ ok: false, reason }`（如 `NO_EMAIL`、`TIMEOUT`、`BACKEND_ERROR`）。
- **闭环：** Agreement 从创建到最终合约已闭环。Tenancy setting 做 tenancy agreement（tenant_operator/owner_tenant），Property/ownersetting 做 management agreement（owner_operator）；创建必带 agreementtemplate_id、默认 pending；manual upload 写 url 则 completed+columns_locked。两段 Hook：① 资料齐 → try-prepare-draft 生成 draft PDF；② 两方签齐 → 签名接口内 afterSignUpdate 自动生成 final PDF、hash_final、completed、columns_locked。两方谁先签均可；第一人签后 status=locked。DB：0053（hash_draft/hash_final/version）、0054（*_signed_ip）、0055（columns_locked）。**完整流程：** [docs/db/agreement-flow-create-to-final.md](./db/agreement-flow-create-to-final.md)；**执行全部 migration：** [docs/db/run-all-migrations-paste.md](./db/run-all-migrations-paste.md)。

### Bank bulk transfer 批量转账（后端迁移自 Wix backend/access/bankbulktransfer.jsw）

- **API：** `POST` `/api/bank-bulk-transfer`。Body `{ email?, bank?, type?, ids? }`。不传 `bank` 时仅返回 `{ banks: [{ label, value }] }`（不校验 email）；传 `bank` + `type` + `ids` 时需传 `email`，返回 `{ success, billerPayments, bulkTransfers, accountNumber, skippedItems? }` 或 `{ success: false }`。另有 `POST /api/bank-bulk-transfer/files`、`POST /api/bank-bulk-transfer/download-url` 返回 Excel 或 zip 下载。`type`：`supplier`（bills）或 `owner`（OwnerPayout）。单次最多 99 条。
- **数据与 Reference：** 数据来自 MySQL：bills（supplierdetail_id / billtype_wixid → supplierdetail，不连 account）、propertydetail（water、electric、wifi_id、unitnumber 等）、supplierdetail（utility_type、billercode、bankdetail_id 等）、bankdetail、ownerpayout、ownerdetail、client_profile（accountNumber）。**JomPay Column B Reference 1（户号）** 仅当 **supplierdetail.utility_type** 为 `electric`/`water`/`wifi` 时从 **propertydetail** 取：water→propertydetail.water，electric→propertydetail.electric，wifi→propertydetail.wifi_id（无则 wifidetail）；utility_type 为空视为普通 supplier（走 bank transfer，用 bankdetail）。
- **资料不齐与 errors.txt：** 若某笔缺 Biller Code、缺银行资料、或 utility 缺 Reference，该笔不会放入 JomPay/Bulk Transfer，会写入 **skippedItems**；下载 zip 时若存在 skippedItems 会包含 **errors.txt**，列出未纳入的 item 及原因（如「请填写 propertydetail.wifi_id」）。详见 [cms-field-to-mysql-column.md](./db/cms-field-to-mysql-column.md)。
- **代码：** `src/modules/bankbulktransfer/bankbulktransfer.service.js`、`bankbulktransfer-excel.js`、`bankbulktransfer.routes.js`。
- **Wix JSW：** 见 [velo-backend-bankbulktransfer.jsw.snippet.js](./wix/jsw/velo-backend-bankbulktransfer.jsw.snippet.js)；SaaS 费用页用 [velo-backend-saas-expenses.jsw.snippet.js](./wix/jsw/velo-backend-saas-expenses.jsw.snippet.js)（docs/wix/jsw 下）。

### Tenant Invoice 发票/租金页（ECS 迁移）

- **数据表：** 列表与写操作用 **`rentalcollection`**（FK：client_id、property_id、room_id、tenant_id、type_id、tenancy_id）；类型/物业下拉用 propertydetail、account、tenancy、meter 等。
- **API：** `POST /api/tenantinvoice/properties`、`/types`、`/rental-list`、`/tenancy-list`、`/meter-groups`、`/rental-insert`、`/rental-delete`、`/rental-update`、`/meter-calculation`；均需 body `email`，由 access 解析 client。Topup 用 **backend/saas/billing**（`getCreditPlans`、`startNormalTopup`、`getMyBillingInfo`）。
- **前端：** [tenant-invoice-page-full.js](./wix/frontend/tenant-invoice-page-full.js)、[tenant-invoice-page.md](./wix/frontend/tenant-invoice-page.md)。Section：invoice（列表+筛选+cache）、createinvoice、group（Meter 组）、meterreport、topup。#buttontopupclose 返回上一 section（default/invoice/group/meterreport）；入口按钮统一点击 disable + label「Loading...」，await 完成后 switch section 并恢复。**Meter 报告分摊：** section meterreport 内 #dropdownsharing 仅三选一（Percentage、Divide Equally、Room (Active Only)），与 [meter-billing-spec.md](./meter-billing-spec.md) 及 Meter Setting 页一致，无 Tenancy 选项。
- **导入：** 先 `truncate-rentalcollection.js`（可选），再 `import-rentalcollection.js rentalcollection.csv`（CSV ID→wix_id，*_id 由各表 wix_id 解析）；可选 0041 补回 _id、0042 确保 FK。见 [rentalcollection-import-steps-powershell.md](./db/rentalcollection-import-steps-powershell.md)。

### Expenses 费用页（完成版）

- **数据表：** 全部读写 **`bills`**。列表/筛选/新增/删除/标记已付/批量操作均通过 ECS 的 `/api/expenses/*`，数据来自 MySQL：bills、propertydetail（shortname）、supplierdetail（billtype_wixid → title）。
- **API 一览：** `POST /api/expenses/list`（列表/分页/limit 缓存）、`/api/expenses/filters`（property/type/supplier 下拉）、`/api/expenses/ids`、`/api/expenses/selected-total`、`/api/expenses/insert`、`/api/expenses/delete`、`/api/expenses/update`、`/api/expenses/bulk-mark-paid`；模板与下载见 `/api/expenses/bulk-template-file`、`/api/expenses/download-template-url`。所有接口需 body `email`，由 access context 解析 client。
- **前端页面（Wix）：** 完整逻辑见 [expenses-page-full.js](./wix/frontend/expenses-page-full.js)。  
  - **Sections：** expenses（列表 + 筛选 + 分页）、expensesinput（逐条新增，repeater + #pagination1 当 >10 条）、bulkupload（上传 Excel/CSV → #tablebulkupload 预览 → 插入）、bank（选银行 → 下载 zip）。  
  - **门禁：** 各页统一用 [门禁 Helper](./wix/jsw/ACCESS-HELPER.md) `getAccessContext()`，不直接调用 wixUsersBackend/wixSecretsBackend。  
  - **主要按钮：** #buttonbulkpaid → 只打开 #boxpayment，选日期与 payment method 后 #buttonsubmitpayment 才批量写入；#buttonbulkdelete / #buttondeleteexpenses → 第一次点击 label 改为「Confirm delete」，第二次点击才执行删除；所有会发请求的按钮统一 disable + label「Loading...」完成后恢复。  
  - **删除审计：** 删除时后端 `console.log('[expenses/delete] email:', email, 'deleted ids:', ids)`，查 log 可知哪個 email 刪除了，不写 table。  
  - **银行下载：** 单次最多 500 条，>99 条时后端自动拆成多文件打成一个 zip（JP01/JP02…、PM01/PM02…、errors.txt），前端只开一个下载链接。  
- **Wix JSW：** 费用相关接口统一走 [velo-backend-saas-expenses.jsw.snippet.js](./wix/jsw/velo-backend-saas-expenses.jsw.snippet.js)（backend/saas/expenses.jsw），调用 ECS；门禁用 [velo-backend-manage.jsw.snippet.js](./wix/jsw/velo-backend-manage.jsw.snippet.js)（backend/access/manage.jsw）。  
- **代码：** `src/modules/expenses/expenses.service.js`、`expenses.routes.js`、`expenses-template-excel.js`。

### Admin 页（admindashboard）

- **数据表：** **feedback**（0038 + 0044 done/remark）、**refunddeposit**（0001 + 0045 done/room_id/tenant_id/client_id）。列表/更新/删除均通过 ECS `/api/admindashboard/*`，按 client_id 鉴权。
- **API 一览：** `POST /api/admindashboard/list`（支持 filterType、search、sort、page、pageSize、limit，与 expenses 一致做 cache + server 分页）、`/api/admindashboard/feedback/update`、`/api/admindashboard/feedback/remove`、`/api/admindashboard/refund/update`、`/api/admindashboard/refund/remove`。所有接口需 body `email`，由 access context 解析 client。
- **前端页面（Wix）：** 完整逻辑见 [admindashboard-page-full.js](./wix/frontend/admindashboard-page-full.js)。Sections：**topup**、admin（feedback+refund 列表）、detail（feedback 详情/备注/图/视频）。列表支持 cache（≤500 条前端过滤）+ server 分页（>500 条）；筛选（Feedback/Refund/ALL）、搜索（room/tenant）带 debounce。**#boxrefund**：含 **#textrefund**（Room/Tenant/Amount/Bank Detail）、**#inputrefundamount**（title: Refund amount，placeholder = 应退金额，可编辑且只能 ≤ 原 amount；若改小则差额作 forfeit）、**#buttonmarkasrefund**（仅此时写 journal：refund + 若有差额则 forfeit）。
- **本页 Topup：** 本页含 Topup 区块，与 Billing、Expenses 等共用 **backend/saas/topup**：`getMyBillingInfo`、`getCreditPlans`、`startNormalTopup`。JSW 见 [velo-backend-saas-topup.jsw.snippet.js](./wix/jsw/velo-backend-saas-topup.jsw.snippet.js)。**约定：** 凡使用 Topup 的页面必须加入 **#buttontopupclose**，点击时返回上一个 section。
- **UI 约定：** **#buttonadmin** 点击时 disable，`initAdminSection` 与切到 admin section 完成后在 `finally` 中 enable。**#dropdownfilter** 选项在 `initAdminSection` 中设为 All / Feedback / Refund。无 item 时隐藏 **#repeateradmin**、**#paginationadmin**、**#dropdownfilter**、**#inputsearch**，显示 **#text50** 文案「You don't have refund item and feedback from tenant」。
- **Wix JSW：** Admin 接口走 [velo-backend-saas-admindashboard.jsw.snippet.js](./wix/jsw/velo-backend-saas-admindashboard.jsw.snippet.js)（backend/saas/admindashboard.jsw）。
- **代码：** `src/modules/admindashboard/admindashboard.service.js`、`admindashboard.routes.js`。

### Agreement Setting 页（协议模板）

- **数据表：** **agreementtemplate**（id、client_id、title、templateurl、folderurl、html、mode、created_at、updated_at）。列表/新建/更新/删除/生成 HTML 均走 ECS `/api/agreementsetting/*`，不读 Wix CMS。
- **API 一览：** `POST /api/agreementsetting/list`（search、sort、page、pageSize、limit）、`/api/agreementsetting/filters`（modes）、`/api/agreementsetting/get`、`/api/agreementsetting/create`、`/api/agreementsetting/update`、`/api/agreementsetting/delete`、`/api/agreementsetting/generate-html`。所有接口需 body `email` + apiAuth（token + X-API-Username），由 access 解析 client。HTML 预览：Node 调 GAS（`AGREEMENT_HTML_GAS_URL` 或默认硬编码 URL）生成 HTML 后写入 `agreementtemplate.html`。
- **前端：** [agreementsetting-page-full.js](./wix/frontend/agreementsetting-page-full.js)。Sections：agreementlist（列表 + #inputlistagreement 搜索 + 分页）、newagreementtemplate（新建/编辑表单）、topup。列表项显示「title \| mode」；Template/Folder 按钮打开对应 URL；Topup 用 **backend/saas/topup**（getMyBillingInfo、getCreditPlans、startNormalTopup）。
- **JSW：** [velo-backend-saas-agreementsetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-agreementsetting.jsw.snippet.js)（backend/saas/agreementsetting.jsw）。
- **代码：** `src/modules/agreementsetting/agreementsetting.service.js`、`agreementsetting.routes.js`；路由挂载 `app.use('/api/agreementsetting', apiAuth, agreementsettingRoutes)`。

### Meter Setting 页（电表分组与分摊）

- **数据与 API：** 电表列表/筛选/详情/更新/删除/新增、分组（parent/child/brother）均走 **backend/saas/metersetting**（ECS），不读 Wix CMS。JSW 见 [velo-backend-saas-metersetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-metersetting.jsw.snippet.js)；前端 [metersetting-page-full.js](./wix/frontend/metersetting-page-full.js)。**#dropdownsharing** 仅三选一：Percentage、Divide Equally、Room (Active Only)，与 tenancy 无关；业务规则见 [meter-billing-spec.md](./meter-billing-spec.md)（AUTO/MANUAL、Prepaid/Postpaid、12 种组合）。代码：`src/modules/metersetting/metersetting.service.js`、`metersetting.routes.js`。

### Owner Setting 页（业主）

- **数据表：** **ownerdetail**、**propertydetail**（owner_id）、**owner_client**、**owner_property**、**agreement**（owner 邀请待签）。列表按「本 client 的业主」一行一个 owner，展示 ownername \| property A, B（仅本 client 下物业）；同人按 email 合并去重。
- **API 一览：** `POST /api/ownersetting/list`（search、page、pageSize、limit）、`/api/ownersetting/filters`、`/api/ownersetting/search-owner`、`/api/ownersetting/property`、`/api/ownersetting/agreement-templates`、`/api/ownersetting/properties-without-owner`、`/api/ownersetting/save-invitation`、`/api/ownersetting/delete-owner`（从物业解绑）、`/api/ownersetting/remove-owner-mapping`（删 owner_client）。所有接口需 body `email` + apiAuth，由 access 解析 client。
- **前端：** [ownersetting-page-full.js](./wix/frontend/ownersetting-page-full.js)。Sections：owner（列表 + #inputlistowner 搜索 + 分页 + cache）、createowner（邀请/选物业/协议）、topup。点击 **#buttonowner** / **#buttoncreateowner** / **#buttontopup** 后先 collapse **#sectiondefault** 再切 section。**#buttontopupclose** 返回上一 section：从 sectiondefault 进 Topup 则返回 default（initDefaultSection），否则返回 owner 或 createowner。列表项「ownername \| propertiesLabel」；#buttonedit 仅 pending 行 enable；#buttondelete 二次确认：有 property 调 deleteOwnerFromProperty（仅一物业时再调 removeOwnerMapping），无 property 调 removeOwnerMapping。Topup 用 **backend/saas/topup**。
- **JSW：** [velo-backend-saas-ownersetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-ownersetting.jsw.snippet.js)（backend/saas/ownersetting.jsw）— getOwnerList、getOwnerFilters、searchOwnerByEmail、getPropertyById、getAgreementTemplates、getPropertiesWithoutOwner、saveOwnerInvitation、deleteOwnerFromProperty、removeOwnerMapping。
- **代码：** `src/modules/ownersetting/ownersetting.service.js`、`ownersetting.routes.js`；路由挂载 `app.use('/api/ownersetting', apiAuth, ownersettingRoutes)`。

### Smart Door Setting 页（门锁/网关与 child lock）

- **数据与 API：** 列表/筛选/详情/更新/新增门锁与网关均走 **backend/saas/smartdoorsetting**（ECS），不读 Wix CMS。JSW 见 [velo-backend-saas-smartdoorsetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-smartdoorsetting.jsw.snippet.js)；前端 [smartdoorsetting-page-full.js](./wix/frontend/smartdoorsetting-page-full.js)。
- **Child lock 下拉选项：** 由后端 `getChildLockOptions(excludeLockId)` 提供（`POST /api/smartdoorsetting/child-lock-options`）。后端排除：当前父锁自身、已用于 Property（propertydetail.smartdoor_id）、已用于 Room（roomdetail.smartdoor_id）、**已是其他门锁 child 的锁**（任一 lock 的 childmeter 中已出现的 id，当前父锁除外），保证一个门锁只能当一个父锁的 child。
- **前端 repeater（#repeaterchildsmartdoor / #dropdownchildsmartdoor）：** 每行以 `row._id` 识别；onChange/关闭钮用 `row._id` 更新或删除对应行，避免删除中间行后 index 错位导致选中值丢失。选项在 `applyChildDropdownOptionsToRepeater(dataOverride)` 中统一重算（排除本页其他行已选 doorId），再设 options 与 value。
- **代码：** `src/modules/smartdoorsetting/smartdoorsetting.service.js`（含 `getChildLockOptions`）、`smartdoorsetting.routes.js`。

### Tenancy Setting 页（租约 / 延租 / 换房 / 终止）

- **数据与 API：** 列表/筛选/延租/换房/终止/取消预订/协议均走 **backend/saas/tenancysetting**（ECS）。路由：`/api/tenancysetting/list`、`/filters`、`/rooms-for-change`、`/change-preview`、**`/extend-options`**、`/extend`、`/change`、`/terminate`、`/cancel-booking`、`/agreement-templates`、`/agreement-insert`；均需 body `email`。
- **房间可租（roomdetail）：** 按 **tenancy 日期** 更新：只认「今天落在 [begin, end] 内」的 tenancy（同一房可有 2025/2026 多笔）；每日 cron 同步 available/availablesoon/availablefrom，extend/change/terminate 后也会单房更新。
- **延租 #datepickerextension：** 可延到**任意一天**（不强制对齐 billing cycle）；最后不足整月的一段按 **prorate** 入 rentalcollection。若同房已有下一笔 booking，最多延到 **下一笔 begin 的前一天**。`POST /extend-options` 返回 `{ paymentCycle, maxExtensionEnd }`（paymentCycle 仅作参考）；`/extend` 会校验 `EXTEND_EXCEEDS_NEXT_BOOKING`。
- **Extend 的 Commission：** 不写死 6 个月；按 **client 的 commission 配置** + **本次 extend 的期数（月数）** 决定规则（延 3 个月跟 3 个月 rules、延 6 个月跟 6 个月 rules）；commission 行实现待接 client admin 后生成，首尾段 prorate。详见 [tenancysetting-extend-agreement-summary.md](./tenancysetting-extend-agreement-summary.md)。
- **前端与 JSW：** 详见 [readme/index.md#tenancy-setting-页](./readme/index.md#tenancy-setting-页tenancysetting)；JSW [velo-backend-saas-tenancysetting.jsw.snippet.js](./wix/jsw/velo-backend-saas-tenancysetting.jsw.snippet.js) 含 getExtendOptions、extendTenancy 等。

### 沟通记录（摘要）

- **架构：** 前端 Wix、后端 Node、数据库 MySQL；不再使用 Wix CMS；图片等用阿里云 OSS。
- **CMS/field 不确定：** 若见 Wix 中 CMS 集合名或 fieldkey 不确定对应哪张表/哪一列，先与维护者确认再写代码。
- **凭证与 Base URL：** Wix Secret Manager 配置 `ecs_token`、`ecs_username`、`ecs_base_url`；JSW 用 `wixSecretsBackend.getSecret('key')` 读取，不写死在代码里。
- **外键统一用 _id：** 原 Wix reference 迁到 MySQL 为 `_wixid`，对齐后有 `_id`；Node 里一律用 `client_id`、`property_id` 等，不再用 `_wixid` 做主逻辑。

### billing.jsw 最终版

Wix 端调用 Node billing API 的 JSW 最终版：粘贴到 `backend/billing/billing.jsw`，在 Secret Manager 配置好 `ecs_token`、`ecs_username`、`ecs_base_url` 即可。源文件：[velo-backend-billing.jsw.snippet.js](./wix/jsw/velo-backend-billing.jsw.snippet.js)。

**统一响应协议：** 成功 `{ ok: true, data? }`，失败 `{ ok: false, reason }`。`reason` 可能为 `NO_EMAIL`、`TIMEOUT`、`BACKEND_ERROR`。调用方请用 `result.ok` 判断，成功时用 `result.data`，失败时用 `result.reason` 提示。

```javascript
/* backend/billing/billing.jsw 最终版 - 含 try/catch、res.json() 安全解析、超时区分、统一响应协议 */
import wixUsersBackend from 'wix-users-backend';
import wixSecretsBackend from 'wix-secrets-backend';

const BACKEND_ERROR_REASON = 'BACKEND_ERROR';
const TIMEOUT_REASON = 'TIMEOUT';
const FETCH_TIMEOUT_MS = 15000;

/** @typedef {{ ok: false, reason: string }} BillingErrorResponse */
/** @param {unknown} data @returns {data is BillingErrorResponse} */
function isBillingError(data) {
    const o = data && typeof data === 'object' && !Array.isArray(data) ? /** @type {{ ok?: boolean, reason?: string }} */ (data) : null;
    return Boolean(o && o.ok === false && typeof o.reason === 'string');
}

function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}

async function getEcsCreds() {
    const token = await wixSecretsBackend.getSecret('ecs_token');
    const username = await wixSecretsBackend.getSecret('ecs_username');
    const baseUrl = await wixSecretsBackend.getSecret('ecs_base_url');
    return {
        token: token != null ? String(token).trim() : '',
        username: username != null ? String(username).trim() : '',
        baseUrl: baseUrl != null ? String(baseUrl).trim().replace(/\/$/, '') : ''
    };
}

async function getEmail() {
    const user = wixUsersBackend.currentUser;
    if (!user.loggedIn) return null;
    return await user.getEmail();
}

async function fetchBilling(path, body = {}) {
    try {
        const email = await getEmail();
        if (email == null || typeof email !== 'string' || !String(email).trim()) {
            return { ok: false, reason: 'NO_EMAIL' };
        }
        const { token, username, baseUrl } = await getEcsCreds();
        if (!baseUrl || !token || !username) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        const res = await fetchWithTimeout(
            `${baseUrl}${path}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-API-Username': username
                },
                body: JSON.stringify({ email: String(email).trim(), ...body })
            },
            FETCH_TIMEOUT_MS
        );
        if (!res.ok) return { ok: false, reason: BACKEND_ERROR_REASON };
        let data;
        try {
            data = await res.json();
        } catch (_) {
            return { ok: false, reason: BACKEND_ERROR_REASON };
        }
        return data;
    } catch (e) {
        if (e && e.name === 'AbortError') {
            return { ok: false, reason: TIMEOUT_REASON };
        }
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

function isValidBillingInfo(data) {
    return data && typeof data === 'object' && !Array.isArray(data) && 'noPermission' in data;
}
function isValidCreditStatements(data) {
    return data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.items) && typeof data.total === 'number';
}
function isValidClearCache(data) {
    return data && typeof data === 'object' && !Array.isArray(data) && data.ok === true;
}

export async function getMyBillingInfo() {
    try {
        const data = await fetchBilling('/api/billing/my-info');
        if (isBillingError(data)) return data;
        if (!isValidBillingInfo(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true, data };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

export async function getCreditStatements({ page = 1, pageSize = 10, sort = 'new', filterType = null, search = '' } = {}) {
    try {
        const data = await fetchBilling('/api/billing/credit-statements', { page, pageSize, sort, filterType, search });
        if (isBillingError(data)) return data;
        if (!isValidCreditStatements(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true, data };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}

export async function clearBillingCache() {
    try {
        const data = await fetchBilling('/api/billing/clear-cache');
        if (isBillingError(data)) return data;
        if (!isValidClearCache(data)) return { ok: false, reason: BACKEND_ERROR_REASON };
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: BACKEND_ERROR_REASON };
    }
}
```

### 已移除

- `test.routes.js` 已删除；仅上表所列 wrapper 为正确入口。

### Malaysia e-invoice (MyInvois)

- Invoice / Credit note（销售与采购）validator 支持 `myinvois_action`: `NORMAL` | `VALIDATE` | `EXTERNAL`。
- 业务规则（仅开启 e-invoice 且 contact 资料完整才走 MyInvois，否则走 NORMAL）在 service 层实现，不在 wrapper。
