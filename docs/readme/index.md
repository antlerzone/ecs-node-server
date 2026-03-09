# Docs Readme Index

文档入口与各模块说明索引。主文档目录见 [docs/index.md](../index.md)。

---

## 页面类型（Public / Client / Indoor）

- **SaaS Client Page** — 需 permission 的页面（client 员工后台）：Company Setting、Room Setting、Booking、Billing、Admin Dashboard、Expenses、Tenant Invoice（员工）等。见 [page-types.md](../wix/page-types.md)。
- **Public Page** — Client 的顾客页：**Owner Dashboard**、**Tenant Dashboard**；**Enquiry Page**（新客户询价/ demo 注册，`backend/saas/enquiry` → `/api/enquiry`，无登录）；**Available Unit 页**（公开房源列表，无登录，`backend/saas/availableunit` → `/api/availableunit/list`）。
- **Indoor Admin** — 平台手動 billing 页（manual topup / manual renew），Saas-indoor-admin。

---

## 门禁拒绝与 #sectiontab 约定

- **统一约定：** 所有使用 `getAccessContext()` 的门禁页面，拒绝时须：留在 **#sectiondefault**、主按钮 disable、文案按原因二选一 — **NO_PERMISSION** → "You don't have permission"，其余（NO_STAFF、NO_CLIENT 等）→ "You don't have account yet"。详见 [ACCESS-DENIED-CONVENTION.md](../wix/jsw/ACCESS-DENIED-CONVENTION.md)。
- **Permission 与页面/按钮：** admin = 全部可进；usersetting → #buttonusersetting；integration → #buttonintegration；billing → #buttonpricingplan/#buttontopup；profilesetting → #buttonprofile；booking → Booking 页；propertylisting → Property/Smart Door/Meter/Room/Owner/Agreement Setting；tenantdetail → Contact Setting；finance → Expenses、Generate Report；Account 页 → integration \|\| billing \|\| admin。见 [ACCESS-DENIED-CONVENTION.md §4–5](../wix/jsw/ACCESS-DENIED-CONVENTION.md)。
- **#sectiontab：** 页面入口栏，内放切换到各 section 的按钮；**始终 expand & show**，不论当前在哪个 section。以下情况须 **disable sectiontab 内全部按钮**：无 credit 且当前展示 sectiontopup；无 permission；client 无 permission。
- **已加入 sectiontab 的页面：** **Expenses** — #sectiontab 内 #buttonexpenses、#buttontopup；**Admin Dashboard** — #buttonadmin、#buttonagreementlist、#buttonprofile；**Tenant Invoice** — #buttonmeterinvoices、#buttoninvoice（及 #buttontopup 若在 tab 内）。其他门禁页（Room/Tenancy/Property/Smart Door/Meter/Contact/Account/Agreement/Owner/Generate Report/Billing/Booking 等）多数已有 #sectiontab，见各页 `*-page-full.js` 注释。
- **门禁 Helper：** [ACCESS-HELPER.md](../wix/jsw/ACCESS-HELPER.md)（getAccessContext 用法、capability、accountingReady 等）。

---

## 每日定时任务（Daily Cron）

- **接口：** `POST /api/cron/daily`（Header `X-Cron-Secret` = `.env` 的 `CRON_SECRET`），建议每天 00:00 UTC+8 调用一次。
- **Daily 执行顺序（完整，代码已实现）：**
  1. **欠租检查** — 过去到期未付的 rentalcollection → tenancy 锁门、断电、active=0；queue 500 笔。
  2. **房间可租同步** — 按 tenancy 日期更新 roomdetail.available / availablesoon / availablefrom。
  3. **Refund deposit** — 租约 end &lt; 今天、未续约、deposit&gt;0、尚无 refunddeposit → 写入 refunddeposit（Admin 可见）。
  4. **Pricing plan 到期** — clientdetail.expired &lt; 今天且未 renew → client status=0（inactive）；tenant 仍可付，admin 页面 no function。
  5. **Core credit 到期日清空** — credit 中 core 项 expired ≤ 今天 → 移除并写 creditlogs（type=Expired）；**title / remark 写入到期日**（如 Core credit expired (YYYY-MM-DD)、Expired date: YYYY-MM-DD），Billing 页与 manual 流水可见。
  6. **每月 1 号 active room 扣费** — 仅 1 号：roomdetail.active=1 数量 × 10 credit/间，幂等同月不重复。
  7. **Stripe 入账** — stripepayout 未入账 → 按 client 会计系统做 DR Bank / CR Stripe，描述含 Settlement ID。
  8. **门锁电量 &lt; 20%** — 写入 feedback 表。
- **详细步骤与代码：** [cron-daily-setup-step-by-step.md](../cron-daily-setup-step-by-step.md)。实现：`tenancy-cron.routes.js`、`tenancy-active.service.js`、`refund-deposit-cron.service.js`、`pricing-plan-expiry-cron.service.js`、`core-credit-expiry-cron.service.js`、`active-room-monthly-cron.service.js`、`battery-feedback-cron.service.js`、`settlement-journal.service.js`。

---

## TTLock API wrapper（SaaS 多人调用）

- **认证：** 每 client 用 `client_integration`（key=smartDoor, provider=ttlock）的 ttlock_username / ttlock_password 换 token，token 存 `ttlocktoken` 表（按 client_id），自动 refresh。调用 TTLock 时用 **TTLock Open Platform** 的 app 凭证（env：`TTLOCK_CLIENT_ID`、`TTLOCK_CLIENT_SECRET`）。
- **目录：** `src/modules/ttlock/` — `lib/ttlockToken.service.js`、`lib/ttlockCreds.js`、`lib/ttlockRegister.js`、`lib/ttlockSubuser.js`；`wrappers/ttlockRequest.js`、`lock.wrapper.js`、`gateway.wrapper.js`；`validators/lock.validator.js`、`gateway.validator.js`；`routes/lock.routes.js`、`gateway.routes.js`、`routes/user.routes.js`。请求先 Joi 校验再进 wrapper（与 Bukku 一致）。
- **HTTP 路由：** `GET/POST /api/ttlock/locks`（列表、详情、重命名、电量、密码列表/新增/修改、远程开锁）、`GET/POST /api/ttlock/gateways`（列表、单条、重命名）、`POST /api/ttlock/users/ensure-subuser`（为当前 client 确保 TTLock 子账号，无则用 subdomain 注册并写入 client_integration）。client 由 clientresolver 从 host 解析，`req.client.id` 即 clientId。
- **程序调用：** `const ttlock = require('./src/modules/ttlock');` → `ttlock.lock.listAllLocks(clientId)`、`ttlock.gateway.listAllGateways(clientId)`、`ttlock.getValidTTLockToken(clientId)`、`ttlock.ensureTTLockSubuser(clientId)`（为 client 开子账号）。
- **子账号：** 平台可为每个 client 开一个 TTLock 子账号（v3 user/register）。**Username 与 password 均由我们 SaaS 设定**（非 TTLock 随机）：username = 该 client 的 **subdomain**（小写、唯一），password = 我们设定的默认密码（如 0123456789）；存 `client_integration`（key=smartDoor, provider=ttlock）的 ttlock_username / ttlock_password。若无该行会先自动插入再注册。详见 [docs/ttlock-subuser.md](../ttlock-subuser.md)。

---

## CNYIoT API wrapper（SaaS 多人调用）

- **认证：** 每 client 用 `client_integration`（key=meter, provider=cnyiot）的 cnyiot_username / cnyiot_password 登录，返回 apiKey + loginID 存 `cnyiottokens` 表（按 client_id），缓存 24h 后重新登录。请求时 apiKey 用 **AES-ECB** 加密（env：`CNYIOT_AES_KEY`）再传。**直连官方 API**：base URL 为 `https://www.openapi.cnyiot.com/api.ashx`；可覆盖 env `CNYIOT_BASE_URL`。`CNYIOT_API_ID` 默认 coliman。响应 5002 时自动清除 token 并重试一次。
- **目录：** `src/modules/cnyiot/` — `lib/cnyiotToken.service.js`、`lib/cnyiotCreds.js`、`lib/encryptApiKey.js`、`lib/getClientTel.js`；`wrappers/cnyiotRequest.js`（唯一调用入口）、`meter.wrapper.js`、`price.wrapper.js`、`sync.wrapper.js`；`validators/meter.validator.js`、`price.validator.js`；`routes/meter.routes.js`、`price.routes.js`。请求先 Joi 校验再进 wrapper。
- **HTTP 路由：** `GET/POST/DELETE /api/cnyiot/meters`（列表、新增、删除）、`GET /api/cnyiot/meters/:meterId/status`、`POST /api/cnyiot/meters/:meterId/edit`、`POST /api/cnyiot/meters/:meterId/relay`、`POST /api/cnyiot/meters/:meterId/power-gate`、`POST /api/cnyiot/meters/:meterId/ratio`、`POST /api/cnyiot/meters/topup`、`POST /api/cnyiot/meters/topup/confirm`、`GET /api/cnyiot/meters/usage/records`、`GET /api/cnyiot/meters/usage/month-bill`、`GET /api/cnyiot/meters/usage/history`、`POST /api/cnyiot/meters/usage-summary`、`POST /api/cnyiot/meters/update-name-rate`、`POST /api/cnyiot/meters/sync`；`GET/POST /api/cnyiot/prices`。client 由 clientresolver 解析，`req.client.id` 即 clientId。Tel 从 `client_profile.contact` 取（纯数字）。
- **程序调用：** `cnyiot.meter.getMeters(clientId)`、`cnyiot.price.getPrices(clientId)`、`cnyiot.user.getUsers(clientId)`、`cnyiot.cnyiotSubuser.ensureClientCnyiotSubuser(clientId)`（为 client 建子账号，uI=subdomain，默认密码 0123456789，写 client_integration）；addMeters 时若已有 cnyiot_subuser_id 会带 UserID 并 link2User，电表自动进该 client 的 group。
- **子账号与 subdomain：** subdomain 取自 client_profile（或 clientdetail），**小写、全库唯一**（迁移 0028）；子账号登入名/密码/id 存 client_integration（cnyiot_subuser_login、cnyiot_subuser_password、cnyiot_subuser_id）；改密须写回 client_integration。`POST /api/cnyiot/users/ensure-subuser`、`PUT /api/cnyiot/users/subuser-password`。
- **与官方文档对照：** [docs/cnyiot-api-doc-mapping.md](../cnyiot-api-doc-mapping.md)（URL 为 `/api.ashx`、Method 与错误码对照）。

---

## SaaS 户口与租客

- **总户口 / 子户口 / 租客** 对应关系、Client 是否我们的 tenant、多电表管理、创建户口在 docs 中的位置、租客支付后充值流程：[saas-account-model-and-cnyiot.md](../saas-account-model-and-cnyiot.md)。

---

## Stripe 支付封装（SaaS）

- **三种场景：**（1）**Client 充值 credit** — 平台 Payment Intent，webhook 成功后写入 `client_credit`。（2）**Tenant 付租金** — Stripe Connect；款项先入平台，按 client credit 是否足够 1% 决定是否 release 到 client 的 Connect 账户。（3）**Tenant Dashboard 付发票 / Meter 充值** — #buttonpaynow（发票，最多 10 笔）或 #buttontopupmeter（Meter）；`POST /api/tenantdashboard/create-payment` 创建 Checkout；metadata 带 `amount_cents`、`invoice_ids` 或 `meter_transaction_id`（Meter 先 INSERT metertransaction）；webhook 校验 paid 且金额一致后 UPDATE **rentalcollection** 或 **metertransaction**。description = tenant name + type + room name。
- **环境变量：** `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`；Live/Sandbox 双套与 `client_profile.stripe_sandbox`（迁移 0060）见 [stripe.md](../stripe.md)。
- **目录：** `src/modules/stripe/`（stripe.service.js、stripe.routes.js）；Tenant 支付入口在 `src/modules/tenantdashboard/`（create-payment）。
- **完整说明：** [docs/stripe.md](../stripe.md)。

---

## Profile / Contact 页（联系人）

- **前端：** [docs/wix/frontend/contact-setting-page-full.js](../wix/frontend/contact-setting-page-full.js) — Topup + Contact 列表（Owner/Tenant/Supplier），数据通过 **backend/saas/contact** JSW 请求 `/api/contact/*`，不读 Wix CMS。**#inputbukkuid** 按访客 client 的 account system（**sql / autocount / bukku / xero**）读写 account 列；**若访客没有 account system 或尚未 setup，则 #inputbukkuid 一律 disable**。**#dropdownbank**：选项来自 bankdetail（mapBankOptions、ensureContactBankOptions）；setDropdownBankOptions 在设 options 后 80ms 再设一次以保证区块展开后选项生效；无数据时显示占位「— No banks —」。**#text19**：点击 **#buttoncontact** 时显示「Loading contacts...」，在 **#sectioncontact** 切换完成后再 hide（initContactSection 传 skipHideLoading，fetchAndFillContactCache(opts) 支持 skipHideLoading，不在加载完联系人时提前 hide）。
- **Node 模块：** `src/modules/contact/`（contact.service.js、contact.routes.js）。路由：`POST /api/contact/list`、`/owner`、`/tenant`、`/supplier`、**`/banks`**（bankdetail 列表）、**`/account-system`**（当前 client 的 account system：sql|autocount|bukku|xero）、`/owner/update-account`、`/tenant/update-account`（body 含 contactId）、`/supplier/create`、`/supplier/update`（payload 含 bankName=bankdetail_id、contactId→account 按当前 provider）、`/supplier/delete`、submit-owner-approval、submit-tenant-approval 等。后端 **getAccountProvider(email)** 决定写入 account 的 provider 键。
- **JSW：** [velo-backend-saas-contact.jsw.snippet.js](../wix/jsw/velo-backend-saas-contact.jsw.snippet.js) — getContactList、getOwner、getTenant、getSupplier、**getBanks**、**getAccountSystem**、updateOwnerAccount、updateTenantAccount、updateSupplier、createSupplier、delete、submitOwnerApproval、submitTenantApproval。
- **数据对应：** 列表来自 owner_client/tenant_client + ownerdetail/tenantdetail/supplierdetail；**account** 列（TEXT JSON）`[{ clientId, provider, id }]`，provider 由访客 client 的 addonAccount 决定（无则 sql）；#inputbukkuid 仅在有 account system 时 enable；Supplier 银行为 **supplierdetail.bankdetail_id** → bankdetail。迁移：0049（account 列）、0050（tenantdetail client_id 回填与 FK）。详见 [cms-field-to-mysql-column.md](../db/cms-field-to-mysql-column.md)#7-profile--contact-页。

---

## Accounting 四系统 Contact 类型对照（create contact 时必读）

**调用前：** 必须先根据 **client 的 account system**（`client_integration` 中 key=Account/addonAccount、enabled=1 的 provider）决定用哪一套 API；再用对应 wrapper 按「角色」走不同 endpoint 或参数。

| 系统 | Contact Wrapper 路径 | Customer（客户） | Supplier（供应商） | Employee（员工） |
|------|----------------------|-----------------|-------------------|------------------|
| **Bukku** | `src/modules/bukku/wrappers/contact.wrapper.js` | 统一 `/contacts`，create 时 payload 可带 `type`（如 customer） | 同上，`type` 区分（若 API 支持） | 同上，`type: employee` |
| **Xero** | `src/modules/xero/wrappers/contact.wrapper.js` | 统一 **Contact**，无类型字段；用于 Invoice 等即视为客户 | 同一 Contact 模型 | 同一 Contact 模型，无单独 employee 类型 |
| **AutoCount** | `src/modules/autocount/wrappers/contact.wrapper.js` | **Debtor**：listDebtors / createDebtor / updateDebtor | **Creditor**：listCreditors / createCreditor / updateCreditor | 需查 API 文档，当前 wrapper 无单独 employee endpoint |
| **SQL Account** | `src/modules/sqlaccount/wrappers/contact.wrapper.js` | 统一 `/Contact`，listContacts / createContact / updateContact；类型是否在 payload 区分需看官方 API | 同上 | 同上，以 API 文档为准 |

- **统一逻辑入口：** `src/modules/contact/contact-sync.service.js` 的 `ensureContactInAccounting(clientId, provider, role, record, existingContactId)` 已按 provider 分支，role 为 `owner`/`tenant` 时用 customer，`staff` 时用 employee；owner 若需同时作 supplier 需在业务层再调一次（如 AutoCount 用 createCreditor）。
- **写回表：** 解析出的 contact id 写回 **ownerdetail.account** / **tenantdetail.account** / **staffdetail.account**（JSON 数组 `[{ clientId, provider, id }]`）。

---

## Accounting 會計流程封圈（SaaS 等級，四系統）

- **原則：** 所有會計開單（invoice / receipt / refund / purchase）均 **依 client 的 provider** 在該系統生成；每個 client 僅會有一個會計系統（xero / bukku / autocount / sql），由 `resolveClientAccounting(clientId)` 解析。
- **六類流程**：1）Meter invoice + receipt；2）Rental collection invoice + receipt；3）Expenses bill + receipt；4）Owner payout（管理費 invoice + 業主款 bill）；5）Refund deposit；6）Forfeit deposit。四系統（Xero / Bukku / AutoCount / SQL）均已實現，**ready to live**（需完成 Account Setting Sync 或手動對應 account 表 + account_client）。
- **文檔：** [docs/db/accounting-flows-summary.md](../db/accounting-flows-summary.md)（封圈確認、id/url 回傳、四系統狀態）；[docs/db/refund-forfeit-other-platforms.md](../db/refund-forfeit-other-platforms.md)（Refund / Forfeit 按平台細說、Sync、account_json）。

---

## Invoice / Purchase / Payment / Receipt / E-Invoice 四平台补齐

- **SQL Account：** 已补 `src/modules/sqlaccount/wrappers/` — **invoice.wrapper.js**（listInvoices, getInvoice, createInvoice, updateInvoice）、**purchase.wrapper.js**（listPurchases, getPurchase, createPurchase, updatePurchase）、**payment.wrapper.js**（listPayments, getPayment, createPayment）、**receipt.wrapper.js**（listReceipts, getReceipt, createReceipt）、**einvoice.wrapper.js**（submitEInvoice, getEInvoiceStatus, cancelEInvoice）。路径需以 Postman Collection 为准（从 SQL Account 内 Download Postman Collection）。
- **四平台 Payment / Receipt：**  
  - **Bukku**：payment.wrapper.js（复用 invoicepayment）、receipt.wrapper.js（bankingIncome）；  
  - **Xero**：payment.wrapper.js（POST /Payments 分配至发票）、receipt.wrapper.js（同 Payment）；  
  - **AutoCount**：payment.wrapper.js、receipt.wrapper.js（路径以 API 文档为准）；  
  - **SQL**：见上。
- **四平台 E-Invoice：**  
  - **Bukku**：einvoice.wrapper.js（submitEInvoice/getEInvoiceStatus/cancelEInvoice）；开单时可带 `myinvois_action`（NORMAL/VALIDATE/EXTERNAL）。  
  - **Xero**：einvoice.wrapper.js（submit/get/cancel；Xero MY 若支持 MyInvois 需对路径）。  
  - **AutoCount**：已有 einvoice.wrapper.js（submitEInvoice/cancelEInvoice/getEInvoiceStatus）。  
  - **SQL**：einvoice.wrapper.js（SubmitEInvoice/EInvoiceStatus/CancelEInvoice；路径以 Postman 为准）。
- **Company Setting #checkboxeinvoiceonboard = true 时必须执行 E-Invoice：** `src/modules/einvoice/einvoice.service.js` — `getClientEinvoiceEnabled(clientId, provider)` 读 `client_integration.einvoice`；`executeEInvoiceIfEnabled(req, { provider, invoiceIdOrDocNo })` 在 enabled 时调用该平台 submitEInvoice。**若顾客资料不齐导致提交失败**，返回 `generalSuggested: true`，后续可走 **general e-invoice**（简化单据）；`buildAndSubmitGeneralEInvoice` 预留，按平台实现最小开单+提交。

---

## Billing 页面与导出

- **前端：** [docs/wix/frontend/billing-page-full.js](../wix/frontend/billing-page-full.js) — 数据来自 ECS `backend/saas/billing`，无 Wix CMS。
- **导出：** `#buttonexport` 点击后请求 Node `POST /api/billing/statement-export`，返回一次性 `downloadUrl`，前端 `wixLocation.to(downloadUrl)` 触发下载。Node 用 xlsx 生成 Excel，存入 downloadStore，不依赖前端 XLSX/document。

---

## AutoCount API wrapper

- **认证：** 静态 API Key（非 OAuth）。请求头 `API-Key`、`Key-ID`；URL 路径含 `accountBookId`。凭证存 `client_integration`（key=addonAccount, provider=autocount）：autocount_apiKey、autocount_keyId、autocount_accountBookId。
- **目录：** `src/modules/autocount/` — `wrappers/autocountrequest.js`、`lib/autocountCreds.js`；**`wrappers/account.wrapper.js`**（listAccounts、getAccount、createAccount）、**`wrappers/product.wrapper.js`**（listProducts、getProduct、createProduct）；`wrappers/invoice.wrapper.js`（createInvoice、getInvoice、voidInvoice）、`validation.wrapper.js`、`einvoice.wrapper.js`；`validators/invoice.validator.js`；`routes/invoice.routes.js`。
- **HTTP 路由：** `POST /api/autocount/invoices`、`GET /api/autocount/invoices?docNo=xxx`、`POST /api/autocount/invoices/void`、`POST /api/autocount/invoices/validate`、`POST /api/autocount/invoices/e-invoice/submit`、`POST /api/autocount/invoices/e-invoice/cancel`、`GET /api/autocount/invoices/e-invoice/status?docNo=xxx`。client 由 clientresolver 解析。
- **官方文档：** [AutoCount Cloud Accounting Integration API](https://accounting-api.autocountcloud.com/documentation/)（含 Master Data：Account、Product）。

---

## Company Setting 页面（ECS 迁移）

- **前端说明：** [docs/wix/frontend/companysetting-page.md](../wix/frontend/companysetting-page.md)、[companysetting-page-full.js](../wix/frontend/companysetting-page-full.js) — 数据全部走 ECS，使用 `backend/saas/companysetting` JSW；**不再使用** `#boxintegration`、`#repeaterintegration`；Billing/Topup 仍用 `backend/saas/billing`。**Profile 头像上传**：用 HTML Embed **#htmluploadbuttonprofile**（431×52），打开 #boxprofile 时 `initHtmlUploadProfile()` 发 INIT，保存时 `profilephoto: profilePhotoUrl`；JSW 提供 `getUploadCreds()`。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。
- **Accounting 仅对特定定价方案开放：** 只有当前 client 的**主方案**（`client_pricingplan_detail` 中 `type = 'plan'` 的 `plan_id`）在 **ACCOUNTING_PLAN_IDS** 内时，才允许连接 Accounting（Xero/Bukku/AutoCount/SQL）。ACCOUNTING_PLAN_IDS 定义在 `src/modules/access/access.service.js`，取值为表 **pricingplan** 的 **id**（当前为 `896357c8-1155-47de-9d3c-15055a4820aa`、`06af7357-f9c8-4319-98c3-b24e1fa7ae27`）。Access 接口返回 `capability.accounting: true/false`，前端可按此隐藏或禁用「Accounting Connect」。
- **Integration template：** Accounting 下拉选项（Xero/Bukku/AutoCount/SQL Account）来自 ECS `getIntegrationTemplate()` 的 `addonAccount.provider` 字段；Company Setting 进入 Integration 时拉取并缓存 template，点击 Accounting Connect 时用 template 渲染选项。
- **Node 模块：** `src/modules/companysetting/`（companysetting.service.js、companysetting.routes.js）。路由挂载在 `app.js`：`/api/companysetting/*`（staff-list、staff-create、staff-update、integration-template、profile、profile-update、banks、admin、admin-save、stripe-connect-onboard、cnyiot-connect、bukku-connect、**autocount-connect**、**autocount-credentials**、**autocount-disconnect**、**sql-connect**、**sql-credentials**、**sql-disconnect**、xero-connect、xero-auth-url、xero-disconnect、ttlock-connect）。
- **JSW：** [velo-backend-saas-companysetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-companysetting.jsw.snippet.js) — 代理 access、staff、profile、banks、admin、getIntegrationTemplate、Stripe Connect / CNYIOT / Bukku / **AutoCount** / **SQL Account** / Xero / TTLock onboard。
- **getOnboardStatus 与 disconnect 后按钮刷新：** `getOnboardStatus` 仅查询 `client_integration.enabled = 1` 的行；disconnect 将对应行设为 enabled=0，故再次拉取得到 `accountingConnected: false`，前端 `refreshOnboardButtonLabels()` 会更新 #buttonaccountonboard 的 label 与颜色（恢复「Accounting Connect」及默认样式）。
- **#boxonboard 显示规则（#buttonaccountonboard / Accounting）：**  
  - **Bukku：** collapse #inputbookidonboard；显示 #inputuseronboard（Token）、#inputpasswordonboard（Subdomain）、#checkboxeinvoiceonboard。  
  - **AutoCount：** 显示 #inputuseronboard（API Key）、#inputpasswordonboard（Key ID）、#inputbookidonboard（Account Book ID）、#checkboxeinvoiceonboard。  
  - **Xero：** collapse #inputuseronboard、#inputpasswordonboard、#inputbookidonboard；只显示 #checkboxeinvoiceonboard。
- **数据对应：** pricing plan → client_pricingplan_detail；client credit → client_credit + creditlogs；integration → client_integration（Stripe Connect 用 client_profile.stripe_connected_account_id；addonAccount 支持 provider=bukku、xero、autocount、sql）；profile → client_profile + clientdetail；admin → clientdetail.admin（JSON）。

---

## Admin 页（admindashboard）

- **前端：** [docs/wix/frontend/admindashboard-page-full.js](../wix/frontend/admindashboard-page-full.js) — Sections：**topup**、**admin**（feedback+refund+待签 agreement）、**detail**、**property**（按物业+状态看租约）、**agreement**（单份 agreement 签名）。列表走 **backend/saas/admindashboard**（getAdminList、updateRefundDeposit、getTenancyList、getTenancyFilters、getAgreementForOperator、signAgreementOperator 等），数据来自 MySQL feedback + refunddeposit + agreement，不读 Wix CMS。
- **#buttonagreementlist** 点击打开 **#sectionproperty**（无 #buttonproperty）；**#repeateragreement** 已删除。**#repeatertenancy** 只显示与**当前 Staff** 相关的 tenancy：Booking 记 tenancy.submitby_id，Extend 记 tenancy.last_extended_by_id（migration 0077）；筛选条件 submitby_id = 当前 staff OR last_extended_by_id = 当前 staff。
- **#boxrefund**：含 #textrefund、**#inputrefundamount**（Refund amount，可编辑且只能 ≤ 原 amount；若改小则差额作 forfeit）、#buttonmarkasrefund（仅此时写 journal）。Daily Cron 会为「租约 end &lt; 今天且未续约、deposit&gt;0」自动写入 refunddeposit（0076 增加 refunddeposit.tenancy_id），Admin 可见并处理。
- **UI：** #buttonadmin 点击时 disable；#dropdownfilter 选项 All/Feedback/Refund/Agreement。无 item 时显示 #text50「You don't have refund item and feedback from tenant」。
- **详细说明与 API：** 见 [docs/index.md § Admin 页（admindashboard）](../index.md)、[admindashboard-sections-summary.md](../wix/frontend/admindashboard-sections-summary.md)。

---

## Smart Door Setting 页（门锁/网关与 child lock）

- **前端：** [docs/wix/frontend/smartdoorsetting-page-full.js](../wix/frontend/smartdoorsetting-page-full.js) — 门锁/网关列表、详情、更新、新增；child lock 配置（#repeaterchildsmartdoor / #dropdownchildsmartdoor）。数据全部走 ECS **backend/saas/smartdoorsetting**，不读 Wix CMS。
- **Child lock 选项：** 后端 `getChildLockOptions(excludeLockId)` 排除已用于 Property/Room 的锁，以及**已是其他门锁 child 的锁**（一个门锁只能当一个父锁的 child）；前端 repeater 用 `row._id` 识别行，删除中间行后选中值保留。
- **JSW：** [velo-backend-saas-smartdoorsetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-smartdoorsetting.jsw.snippet.js)。**详细说明与 API：** 见 [docs/index.md § Smart Door Setting 页](../index.md)。

---

## Tenancy Setting 页（tenancysetting）

- **前端：** [docs/wix/frontend/tenancysetting-page-full.js](../wix/frontend/tenancysetting-page-full.js) — 租约列表（网格 + 分页 listview）、延租 / 换房 / 终止 / 取消预订、合约上传与系统生成；数据全部走 ECS，使用 **backend/saas/tenancysetting** JSW；不读 Wix CMS。门禁用 `backend/access/manage` 的 `getAccessContext()`；Topup 用 **backend/saas/topup**。
- **Sections：** default、tenancy、listview、extend、change、terminate、topup、agreement、uploadagreement。
- **UI 约定：** **#textstatusloading** 仅在页面 init 时 show「Loading...」，init 完成后 hide。**#text19** 用于所有点击后的 loading 与错误提示（点 Tenancy 进列表、延租/换房/终止/上传合约/生成合约 成功 hide、失败 show 错误文案；权限不足/余额不足也 show 在 #text19）。**关闭按钮** #buttontopupclose、#buttoncloseextend、#buttonclosechange、#buttoncloseagreement、#buttoncloseuploadagreement、#buttoncloseterminate 统一返回上一 section（`lastSectionBeforeAction`）。
- **Node 模块：** `src/modules/tenancysetting/`（tenancysetting.service.js、tenancysetting.routes.js）。路由：`/api/tenancysetting/list`、`/filters`、`/rooms-for-change`、`/change-preview`、`/extend-options`、`/extend`、`/change`、`/terminate`、`/cancel-booking`、`/agreement-templates`、`/agreement-insert`；均需 body `email`。
- **延租 #datepickerextension：** 可延到**任意一天**（不强制对齐 payment cycle）；最后不足整月的一段按 **prorate** 入 rentalcollection（rental 与日后若有的 commission 均 prorate）。若同房已有下一笔 booking，最多延到 **下一笔 begin 的前一天**。后端 `POST /extend-options` 返回 `{ paymentCycle, maxExtensionEnd }`（paymentCycle 仅作参考）；`/extend` 会校验 `EXTEND_EXCEEDS_NEXT_BOOKING`。**Extend 的 Commission** 不写死 6 个月：按 **client 的 commission 配置** + **本次 extend 的期数（月数）** 选规则；详见 [tenancysetting-extend-agreement-summary.md](../tenancysetting-extend-agreement-summary.md)。
- **JSW：** [velo-backend-saas-tenancysetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-tenancysetting.jsw.snippet.js) — getTenancyList、getTenancyFilters、getRoomsForChange、getChangePreview、getExtendOptions、extendTenancy、changeRoom、terminateTenancy、cancelBooking、getAgreementTemplates、insertAgreement。
- **详细说明与 API：** 见 [docs/index.md § Tenancy Setting 页（tenancysetting）](../index.md)。

---

## Owner Setting 页（ownersetting）

- **前端：** [docs/wix/frontend/ownersetting-page-full.js](../wix/frontend/ownersetting-page-full.js) — 业主列表（一行一个 owner：ownername \| property A, B，仅本 client 下物业）、搜索/分页/cache、Create Owner 邀请、Edit（仅 pending 行）、Delete（二次确认：有 property 从物业解绑，仅一物业时再删 owner_client；无 property 只删 owner_client）。**Section 与 Topup：** 点击 #buttonowner / #buttoncreateowner / #buttontopup 后先 collapse #sectiondefault 再切 section；#buttontopupclose 返回上一 section（从 sectiondefault 进 Topup 则返回 default，否则返回 owner/createowner）。数据全部走 ECS，使用 **backend/saas/ownersetting** JSW；Topup 用 **backend/saas/topup**。
- **Node 模块：** `src/modules/ownersetting/`（ownersetting.service.js、ownersetting.routes.js）。路由：`/api/ownersetting/list`、`/filters`、`/search-owner`、`/property`、`/agreement-templates`、`/properties-without-owner`、`/save-invitation`、`/delete-owner`、`/remove-owner-mapping`；均需 body `email` + apiAuth。
- **JSW：** [velo-backend-saas-ownersetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-ownersetting.jsw.snippet.js) — getOwnerList、getOwnerFilters、searchOwnerByEmail、getPropertyById、getAgreementTemplates、getPropertiesWithoutOwner、saveOwnerInvitation、deleteOwnerFromProperty、removeOwnerMapping。
- **详细说明与 API：** 见 [docs/index.md § Owner Setting 页（业主）](../index.md)。

---

## Property Setting 页（propertysetting）

- **前端：** [docs/wix/frontend/propertysetting-page-full.js](../wix/frontend/propertysetting-page-full.js) — 物业列表（Property Management）、筛选/分页、详情/更新、车位（Parking Lot）、新建物业、业主协议（Owner 区）；数据全部走 ECS **backend/saas/propertysetting** + **backend/saas/topup** + **backend/saas/roomsetting**（meter/smartdoor 下拉），不读 Wix CMS。
- **列表与车位缓存：** 点击 **#buttonroom** 进入列表时，先拉当前页数据并 **预拉当前页所有 property 的 parking lots** 写入 `parkingLotsCacheByPropertyId`；翻页时同样预拉当页车位。点击 **#buttondetail**（Parking Lot）时优先用缓存，无缓存再请求 server；保存车位后更新缓存。
- **列表加载顺序：** 先 `waitForAllListItemsReady()`（等 repeater 每项 onItemReady 含 occupancy 颜色/文案完成），再 `switchSectionAsync('sectionlistview')`，避免未 load 好就切 section。
- **Owner 区：** #dropdownagreementtype 选 system 时仅 expand #dropdownagreement、collapse #inputagreementurl；选 manual 时反之；**只用 collapse/expand**，不用 hide/show。选 system 时先立即 expand 下拉并显示「Loading...」，再后台拉模板选项填下拉（不阻塞 UI）。业主协议支持已有 agreement 时再次生成/更新（renew）；#buttonagreementcopy 点击打开 URL；#textagreementdetail 有 label 时 show/expand，无则 hide。
- **共用服务：** 业主协议保存逻辑在 **src/modules/agreement/owner-agreement.service.js**（`saveOwnerAgreement`），供 Property Setting、Owner Portal 等多页共用；后期可在此加 deduct credit。
- **Node 模块：** `src/modules/propertysetting/`（propertysetting.service.js、propertysetting.routes.js）。路由：`/api/propertysetting/list`、`/filters`、`/get`、`/update`、`/set-active`、`/parkinglots`、`/parkinglots-save`、`/insert`、`/occupancy`、`/apartment-names`、`/suppliers`、`/owners`、`/agreement-templates`、`/owner-save`；均需 apiAuth + email。
- **JSW：** [velo-backend-saas-propertysetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-propertysetting.jsw.snippet.js) — getPropertyList、getPropertyFilters、getProperty、updateProperty、setPropertyActive、getParkingLotsByProperty、saveParkingLots、insertProperties、isPropertyFullyOccupied、getApartmentNames、getSupplierOptions、getOwnerOptions、getAgreementTemplateOptions、saveOwnerAgreement。
- **数据约定：** propertydetail（tnb→electric、saj→water，saj 可为字串如 SD2232423）；parkinglot、roomdetail、ownerdetail、agreementtemplate、agreement；FK 一律用 _id。

---

## Booking 页面（ECS 迁移）

- **前端：** [docs/wix/frontend/booking-page-full.js](../wix/frontend/booking-page-full.js) — 数据全部走 ECS，使用 `backend/saas/booking` JSW；**不读 Wix CMS**。门禁用 `backend/access/manage` 的 `getAccessContext()`。元素 ID 与旧版一致：`#inputrental`、`#inputdeposit`、`#inputagreementfees`、`#inputparkingfees`、`#datepicker1`、`#datepicker2`、`#radiogroupuser`、`#inputemail`、`#radiogroupproperty`、`#inputproperty`、`#checkboxgroupparkinglot`、`#repeateraddon`、`#buttonaddon`、`#buttonsave`、`#textsummary`、`#texttenantdetail`。
- **Node 模块：** `src/modules/booking/`（booking.service.js、booking.routes.js）。路由挂载在 `app.js`：`/api/booking/*`（admin-rules、staff、available-rooms、search-tenants、tenant、room、parking-by-property、create、generate-rental）。
- **JSW：** [velo-backend-saas-booking.jsw.snippet.js](../wix/jsw/velo-backend-saas-booking.jsw.snippet.js) — 代理 getAdminRules、getAvailableRooms、searchTenants、getTenant、getRoom、getParkingLotsByProperty、createBooking、generateFromTenancy；认证与 Base URL 同 companysetting（ecs_token、ecs_username、ecs_base_url）。
- **迁移：** `src/db/migrations/0032_booking_tenant_tenancy_rental_parking.sql` — tenant_client 表、tenantdetail.approval_request_json、tenancy 新增 deposit/parkinglot_json/addons_json/billing_json/commission_snapshot_json/billing_generated/tenancy_status_json/remark_json、rentalcollection.tenancy_id 及回填、parkinglot.available。执行：`node scripts/run-migration.js src/db/migrations/0032_booking_tenant_tenancy_rental_parking.sql`。若 propertydetail 仅有 owner_wixid、owner_id 为空，需再执行 `0034_backfill_propertydetail_owner_id.sql`（owner_wixid 回填 owner_id→ownerdetail），否则 Booking 页「可选房间」无数据。
- **数据对应：** admin 规则 → clientdetail.admin；房间 → roomdetail（available/availablesoon）；property 需有 owner（owner_id 或 owner_wixid）；租客 → tenantdetail + tenant_client（已批准）/approval_request_json（待批准）；车位 → parkinglot；创建订单 → 插入 tenancy，已批准租客时自动生成 rentalcollection（billing_json 中 bukkuid 由后端映射为 account.id），并锁定房间与车位。

---

## Owner Portal 页面（ECS 迁移）

- **前端：** [docs/wix/frontend/owner-portal-page-full.js](../wix/frontend/owner-portal-page-full.js) — 数据全部走 ECS，使用 `backend/saas/ownerportal` JSW；**不读 Wix CMS**。门禁用 `backend/access/manage` 的 `getAccessContext()`；合同详情弹窗用 `backend/access/agreementdetail`。默认 section 为 **#sectionownerportal**；onReady 时 **#repeaterclient** 先 hide，有数据才 show；主按钮先 disable、label「Loading...」，await 完成后 enable 并恢复 label。
- **上传（OSS）：** Profile 区 NRIC 使用 **HTML Embed**（#htmluploadbutton1、#htmluploadbutton2，431×52），同 [upload-oss-embed.html](../wix/frontend/upload-oss-embed.html)，JSW 提供 **getUploadCreds()**；打开 Profile 时 `initHtmlUploadProfile()` 发 INIT，上传成功后 `updateOwnerProfile({ nricFront/nricback: url })` 并刷新 #imagenric1/#imagenric2。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。
- **Node 模块：** `src/modules/ownerportal/`（ownerportal.service.js、ownerportal.routes.js、ownerportal-pdf.js）。路由挂载在 `app.js`：`/api/ownerportal/*`（owner、load-cms-data、clients、banks、update-profile、owner-payout-list、cost-list、agreement-list、agreement-template、agreement-get、agreement-update-sign、complete-agreement-approval、merge-owner-multi-reference、remove-approval-pending、sync-owner-for-client、**export-report-pdf**、**export-cost-pdf**）。业主的 properties/clients 从 **关联表** owner_property、owner_client 读取（一业主多 property、多 client）；无关联表数据时 fallback 到 propertydetail.owner_id、ownerdetail 单列。
- **数据与 repeater：** 业主解析：`ownerdetail` 按 email 匹配。**#repeateragreement** 数据来自 **agreement** 表：`/api/ownerportal/agreement-list`，条件为 `owner_id = ?` 或 `owner_id IS NULL 且 property_id IN (业主的 property 列表)`，mode 为 owner_operator/owner_tenant（或 NULL）。**#repeatertenancy**、**#dropdownownerreportproperty** 等依赖 load-cms-data 返回的 properties/rooms（来自 owner_property 或 propertydetail.owner_id）。
- **PDF 导出：** Owner Report 与 Cost Report 由 **Node 生成**（pdfkit，见 ownerportal-pdf.js），返回 **downloadUrl**；前端 #buttonexportpdf / #buttonexportpdfcost 调用 exportOwnerReportPdf / exportCostPdf 后 `wixLocation.to(downloadUrl)` 直接下载，与 expenses 页一致。
- **JSW：** [velo-backend-saas-ownerportal.jsw.snippet.js](../wix/jsw/velo-backend-saas-ownerportal.jsw.snippet.js) — 含 exportOwnerReportPdf、exportCostPdf；所有 export 用 ensureXxxShape；IDE 报 "Property does not exist" 时用 JSDoc `@typedef` + `@type` 断言，见 [README-wix-jsw.md §8](../wix/jsw/README-wix-jsw.md)。
- **迁移：**  
  - `0033_agreement_owner_portal_columns.sql` — agreement 表增加 owner_id、property_id、tenancy_id、agreementtemplate_id、mode、status、ownersign、owner_signed_at、tenantsign、pdfurl 等；执行见 `scripts/run-0033-agreement-columns-idempotent.sh`。  
  - `0035_ownerdetail_add_fk_client_property.sql` — ownerdetail 的 client_id、property_id 加 FK（可选；若需多对多则用 0037 后不再依赖单列 FK）。  
  - `0036_ownerdetail_backfill_client_id_property_id.sql` — 用 client_wixid/property_wixid 回填 ownerdetail 的 client_id、property_id。  
  - `0037_owner_client_owner_property_junction.sql` — 建 **owner_client**、**owner_property** 关联表（一业主多 client、多 property），带 FK；从 ownerdetail 的 _wixid 回填。Node 优先从关联表读业主的 properties/clients。
- **前端说明：** [docs/wix/frontend/owner-portal-page.md](../wix/frontend/owner-portal-page.md) — 迁移要点、NRIC 上传、CMS→MySQL 映射、repeater 数据来源、部署检查。

---

## Generate Report / Owner Report 页（generatereport）

- **前端：** [docs/wix/frontend/generatereport-page-full.js](../wix/frontend/generatereport-page-full.js) — Report 列表（筛选/分页/勾选下载 PDF）、**GR 区**（#repeatergr 物业列表、#datepicker1gr/#datepicker2gr 日期范围、#tablegr 完整 payout、可选 #tablebillsgr）；数据全部走 ECS，使用 **backend/saas/generatereport** JSW。
- **日期与时区：** **#datepicker1gr / #datepicker2gr** 按 **马来西亚 UTC+8**：默认上个月 1 号～最后一天用 `getLastMonthRangeMY()`（基于 `getMalaysiaNow()`）；传给 API 的 from/to 为 `toMalaysiaDateOnly(firstDay/lastDay)` 的 YYYY-MM-DD，后端用 `malaysiaDateRangeToUtcForQuery` 转 UTC 查表（表存 UTC+0）。
- **#tablegr 数据来源：** [generatereport-tablegr-datasource.md](../wix/frontend/generatereport-tablegr-datasource.md) — **rentalcollection 以 type_id 分类**（Rental Income、Forfeit Deposit、Parking、Owner Commission 等；title 仅 fallback）。income（Rental、Forfeit Deposit、Parking、Topup）→ Gross Income → expenses（Owner Commission、bills、Last Month Balance）→ Total Expenses → Net Income → Management Fee → Owner Payout；bills 按 supplierdetail.utility_type 显示 Electric/Water/Wifi 或 column description；Agreement Fees / Deposit / Tenant Commission 不进入 table。
- **关闭按钮：** **#buttonclosegr**、**#buttonclosegrdetail** 返回**上一个 section**（进入 gr/grdetail 前记录的 `sectionBeforeGr` / `sectionBeforeGrdetail`），无记录时分别回 report、gr。
- **Node 模块：** `src/modules/generatereport/`（generatereport.service.js、generatereport.routes.js）。路由：`/api/generatereport/*`（properties、owner-reports、owner-reports-total、owner-report、generate-payout、owner-report-pdf-download、generate-and-upload-owner-report-pdf、finalize-owner-report-pdf、bulk-update 等）。
- **JSW：** [velo-backend-saas-generatereport.jsw.snippet.js](../wix/jsw/velo-backend-saas-generatereport.jsw.snippet.js) — getReportProperties、getOwnerReports、getOwnerReport、generateOwnerPayout、insertOwnerReport、updateOwnerReport、deleteOwnerReport、getOwnerReportsTotal、getOwnerReportsPdfDownloadUrl、generateAndUploadOwnerReportPdf、bulkUpdateOwnerReport 等。
- **迁移与 PDF：** 见 [docs/wix/frontend/report-owner-page.md](../wix/frontend/report-owner-page.md)。

---

## Tenant Invoice 发票/租金页（ECS 迁移）

- **前端：** [docs/wix/frontend/tenant-invoice-page-full.js](../wix/frontend/tenant-invoice-page-full.js)、[tenant-invoice-page.md](../wix/frontend/tenant-invoice-page.md) — 发票列表、创建发票、Meter 报表、Topup；数据全部走 ECS，使用 `backend/saas/tenantinvoice` 与 `backend/saas/billing`（getCreditPlans、startNormalTopup、getMyBillingInfo）。门禁用 `backend/access/manage` 的 `getAccessContext()`。
- **Node 模块：** `src/modules/tenantinvoice/`（tenantinvoice.service.js、tenantinvoice.routes.js）。路由：`/api/tenantinvoice/*`（properties、types、rental-list、tenancy-list、meter-groups、rental-insert、rental-delete、rental-update、meter-calculation）。
- **数据表：** rentalcollection（0039 description、0040 *_wixid 列、0041 回填 *_id、0042 确保 FK）。Wix 导出 CSV 导入：先 `truncate-rentalcollection.js`（可选），再 `import-rentalcollection.js rentalcollection.csv`（CSV ID→wix_id，client_id/property_id/room_id/tenant_id/type_id/tenancy_id 由各表 wix_id 解析）。详见 [rentalcollection-import-steps-powershell.md](../db/rentalcollection-import-steps-powershell.md)、[rentalcollection-import-columns.md](../db/rentalcollection-import-columns.md)。
- **JSW：** [velo-backend-saas-tenantinvoice.jsw.snippet.js](../wix/jsw/velo-backend-saas-tenantinvoice.jsw.snippet.js) — 粘贴为 `backend/saas/tenantinvoice.jsw`；Billing/Topup 用 `backend/saas/billing`（同 Company Setting）。

---

## Tenant Dashboard 页面（ECS 迁移）

- **前端：** [docs/wix/frontend/tenant-dashboard-page-full.js](../wix/frontend/tenant-dashboard-page-full.js) — 租客仪表盘，数据全部走 ECS，使用 `backend/saas/tenantdashboard` JSW；**不读 Wix CMS**。门禁用 `backend/access/manage` 的 `getAccessContext()`；TTLock / CNYIoT 仍可从 `backend/access/ttlockaccess`、`backend/integration/cnyiotapi` 调用。默认 section 为 **tenantdashboard**（meter、agreement、smartdoor、payment、profile、feedback）。
- **上传（OSS）：** Feedback 图片/视频与 Profile NRIC 使用 **HTML Embed** 直传阿里云 OSS（不再用 Wix Upload Button）。嵌入组件：**#htmluploadbuttonfeedback**（449×34，feedback 区）、**#htmluploadbutton1**（431×52，NRIC 正面/护照）、**#htmluploadbutton2**（431×52，NRIC 背面）；HTML 源码 [upload-oss-embed.html](../wix/frontend/upload-oss-embed.html)，父页面 postMessage `INIT`（baseUrl、token、username、clientId、label、accept），上传成功后 iframe postMessage `UPLOAD_SUCCESS` 回传 url。JSW 提供 **getUploadCreds()** 供前端取鉴权。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。
- **#buttonwhatsap：** 在 #sectionfeedback 内，点击后跳转 wasap.my（client 联系号码 + 租客名/房间名），用于租客联系房东。
- **支付：** **#buttonpaynow**（发票）— 勾选最多 **10 笔** rentalcollection，合计金额 + `metadata.invoiceIds` 调 `createTenantPayment` → Stripe Checkout（固定金额、description = tenant name + account.title + room name）；webhook 校验 paid 且金额一致后 **UPDATE rentalcollection**（paidat、referenceid、ispaid）。**#buttontopupmeter**（Meter）— 先在后端 **INSERT metertransaction**（pending），再带 `meter_transaction_id` 创建 Checkout；webhook 校验后 **UPDATE metertransaction**（ispaid、referenceid、status=success），并调 `handleTenantMeterPaymentSuccess` 写 rentalcollection。详见 [stripe.md](../stripe.md)、上节 Stripe 支付封装。
- **Node 模块：** `src/modules/tenantdashboard/`（tenantdashboard.service.js、tenantdashboard.routes.js）。路由：`/api/tenantdashboard/*`（init、clients-by-ids、room、property-with-smartdoor、banks、update-profile、agreement-html、agreement-update-sign、agreement-get、**rental-list**、tenant-approve、tenant-reject、generate-from-tenancy、sync-tenant-for-client、feedback、**create-payment**）。租客按 email（tenantdetail.email）解析，所有操作校验 tenancy 归属该租客。
- **数据与 repeater：** init 返回 tenant + tenancies（含 property、client、room、agreements，client 带 contact 供 WhatsApp）；Dashboard repeater 展示待批准（approval）与待签约（agreement）；电表、Pay Now、反馈、智能门、个人资料、合同签署、支付均走对应 API。Stripe 支付成功/取消跳转 `tenant-dashboard?success=1` / `tenant-dashboard?cancel=1`。
- **JSW：** [velo-backend-saas-tenantdashboard.jsw.snippet.js](../wix/jsw/velo-backend-saas-tenantdashboard.jsw.snippet.js) — 粘贴为 `backend/saas/tenantdashboard.jsw`；认证与 Base URL 同 ownerportal。export：init、**getUploadCreds**、getClientsByIds、getRoomWithMeter、getPropertyWithSmartdoor、getBanks、updateTenantProfile、getAgreementHtml、updateAgreementTenantSign、getAgreement、getRentalList、tenantApprove、tenantReject、syncTenantForClient、submitFeedback、**createTenantPayment** 等。
- **迁移：** feedback 表见 `0038_create_feedback.sql`。若表未建，submitFeedback 返回 FEEDBACK_TABLE_MISSING。

---

## Available Unit 页面（Public）

- **前端：** [docs/wix/frontend/available-unit-page-full.js](../wix/frontend/available-unit-page-full.js) — 公开房源列表，**无登录**；数据走 ECS `backend/saas/availableunit` → `POST /api/availableunit/list`，不读 Wix CMS。
- **数据与逻辑：** 无 subdomain = 显示**全部 client** 的 available/availablesoon 且 **property/room 均为 active** 的单位；可选 `?subdomain=xxx` 仅显示该 client。一次请求返回 items + properties + clientContact/clientCurrency，同一份数据喂 **#repeatergrid** 与 **#repeaterlist**；筛选：**#inputsearch**（keyword 防抖）、**#dropdowncountry**（All / Malaysia / Singapore，后端按 client_profile.currency 过滤）、**#dropdownproperty**、**#dropdownsort**。价格显示为「currency + amount」；详情弹窗 **#boxgrid** / **#boxlist** 内 **#gallerygrid**、**#videoplayergrid**、**#gallerylist**、**#videoplayerlist** 有内容时 expand、无内容时 collapse。
- **#buttonwhatsap / #buttongrid：** 跳 wasap.my/{clientContact}/{propertyname%20roomname%20enquiry}，与 Tenant Dashboard 一致；clientContact 带国家码（后端 client_profile.contact 归一化）。
- **Init：** startInitAsync 模式；onReady 时 #text20 = "Loading"、#sectiongrid hide，等 repeater 全部 onItemReady 后 #text20 = "Available Unit"、#sectiongrid show。
- **Node 模块：** `src/modules/availableunit/`（availableunit.service.js、availableunit.routes.js）。路由：`POST /api/availableunit/list`（body：subdomain?、propertyId?、sort?、page?、pageSize?、**keyword?**、**country?**）；返回 `{ ok, items, properties, clientContact?, clientCurrency?, totalPages, currentPage, total }`；仅列 roomdetail.active=1 且 (propertydetail.active=1 or property 为空) 的房间。
- **JSW：** [velo-backend-saas-availableunit.jsw.snippet.js](../wix/jsw/velo-backend-saas-availableunit.jsw.snippet.js) — 粘贴为 `backend/saas/availableunit.jsw`；export `getData(opts)`，认证与 Base URL 同 enquiry。

---

## Wix JSW 后端服务（Billing / Integration）

以下为 Wix 站点内 **backend** 模块（非 ECS），仍可能在使用或需迁移参考。数据来源为 **Wix CMS**（如 `wix-data`），迁到 ECS 后对应逻辑在 Node 实现。

### Billing（支付完成 / 手动操作）

| JSW 文件 | 导出函数 | 说明 |
|----------|----------|------|
| **billing/completepayment.jsw** | `completePricingPlanPayment({ pricingplanlogId, payexData, status, failReason })` | 定价方案支付完成：读 pricingplanlogs/clientdetail/pricingplan，幂等（已 paid 返回 duplicated），失败则更新 log 为 failed；成功则更新 clientdetail（pricingplandetail、expired）、标记 log paid、调 completetopup 加 CORE credit、扣 addon prorate、清 cache。支持 Payex / Stripe（reference_number、payment_intent 等）。 |
| **billing/completetopup.jsw** | `completePricingPlanTopup({ pricingplanlogId, payexData, txnId, expiredDate })` | 定价方案 CORE 到账：需 log 已 paid、写 creditlogs、更新 clientdetail.credit（applyCoreCredit），若有 addon 扣减则调 deductPricingPlanAddonCredit。 |
| **billing/completetopup.jsw** | `completeNormalTopup({ creditlogId, status, payexData, failReason })` | 普通充值 FLEX 到账：读 creditlogs，失败则更新 log；成功则 applyFlexCredit 更新 clientdetail.credit、标记 log isPaid、清 cache。 |
| **backend/billing/manualrenew.jsw** | `manualRenew({ clientId, planId, paidDate })` | 手动续费：需 admin 或 billing 权限；插 pricingplanlogs（scenario: MANUAL, status: paid），再调 `completePricingPlanPayment` 走完整完成流程。 |
| **backend/billing/manualtopup.jsw** | `manualTopup({ clientId, amount, paidDate })` | 手动充值：需 admin 或 billing 权限；插 creditlogs（isPaid: true），再调 `completeNormalTopup` 加 FLEX credit。 |

### Integration（模板 / 门锁 / 电表 / 智能门）

| JSW 文件 | 导出函数 | 说明 |
|----------|----------|------|
| **backend/integration/integrationtemplate.jsw** | `getIntegrationTemplate()` | 返回集成配置模板数组：paymentGateway（stripe/payex）、meter（cnyiot）、smartDoor（ttlock）、addonAccount（bukku/xero）等，每项含 key、title、version、providers、fields。 |
| **backend/integration/lockselection.jsw** | `previewSmartDoorSelection(clientId)` | 智能门预览：拉 TTLock locks + gateways，与 CMS LockDetail/GatewayDetail 比对；已存在则同步 alias/电量/名称并跳过预览，不存在则进 preview 列表。 |
| **backend/integration/lockselection.jsw** | `syncTTLockName({ clientId, type, externalId, name })` | 同步 TTLock 名称：type 为 lock 或 gateway，调 ttlock 重命名 API。 |
| **backend/integration/metersetting.jsw** | `getMeterDropdownOptions({ clientId, roomId })` | 电表下拉：client 下启用中的 meterdetail，排除已被 Property 占用的、仅当前 room 可回显已占用的，返回 `{ label, value }`。 |
| **backend/integration/metersetting.jsw** | `updateRoomMeter({ clientId, roomId, meterId })` | 房间↔电表绑定：meterId 为空则解绑；否则双向写 meterdetail.room/property 与 RoomDetail.meter；旧 meter 若只绑该 room 则清空。 |
| **backend/integration/metersetting.jsw** | `getActiveMeterProvidersByClient(clientId)` | 按 client 从 clientdetail.integration 取 key=meter、enabled 的 provider 列表（含 slot）。 |
| **backend/integration/smartdoorsetting.jsw** | `getSmartDoorDropdownOptions({ clientId, roomId })` | 智能门下拉：client 下启用中的 LockDetail，排除被 Property 占用的、仅当前 room 可回显已占用的。 |
| **backend/integration/smartdoorsetting.jsw** | `updateRoomSmartDoor({ clientId, roomId, smartDoorId })` | 房间↔智能门绑定：smartDoorId 为空则解绑；否则校验 Lock 属 client 且 active、唯一性（未被其他 property/room 用）后写 RoomDetail.smartdoor。 |

---

## Help 页与 API 报错工单（ticket）

- **Help 页：** FAQ 列表 `getFaqPage(page)`、用户提交 Request/Feedback 工单 `submitTicket(payload)`，走 ECS `/api/help/faq`、`/api/help/ticket`，不读 Wix CMS。**工单附件上传**：用 HTML Embed **#helpuploadbutton**（449×34 或 431×52），打开 Help/Request/Feedback 时 `initHtmlUploadTicket()` 发 INIT，上传成功后按 `mediaType` 设 `ticketPhotoUrl`/`ticketVideoUrl`，提交时传给 `submitTicket`；JSW 提供 `getUploadCreds()`。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。
- **API 报错自动写 ticket：** 任意接口返回 `{ ok: false }` 时，会写入 **ticket** 表一条记录（`source=api_error`），便于后期查看。写入内容：**哪个页面**（page）、**几时发生**（created_at）、**点击什么**（action_clicked）、**哪个 function**（function_name）、**接口路径**（api_path）、**原因**（description/reason）。
- **前端约定：** 为便于工单可读，请求 body 中建议带上 `page`、`action`、`functionName`（例如 `page: 'Owner Setting'`、`action: 'Save'`、`functionName: 'saveOwner'`），后端会写入对应列。未传则列为空，仍会记录 api_path 与 reason。
- **表结构：** 迁移 `0058_ticket_api_error_columns.sql` 为 ticket 增加 `source`、`page`、`action_clicked`、`function_name`、`api_path`、`api_method`。查询 API 报错工单：`SELECT * FROM ticket WHERE source = 'api_error' ORDER BY created_at DESC`。
- **实现：** `src/modules/help/help.service.js`（`recordApiError`）、`src/middleware/recordApiErrorMiddleware.js`（包装 `res.json`，在返回 `ok: false` 时调用 `recordApiError`）。app.js 与 server.js 均已挂载该中间件。

---

## 其他

- **文档主目录与架构约定：** [docs/index.md](../index.md)
- **OSS 上传迁移总结：** [upload-oss-migration-summary.md](../wix/upload-oss-migration-summary.md) — 5 页（Tenant Dashboard、Owner Portal、Company Setting、Help、Room Setting）Wix Upload Button→HTML Embed，表存 URL；共用 upload-oss-embed.html、getUploadCreds()。
- **Bukku API wrapper 一览：** [docs/index.md#bukku-api-wrapper-一览](../index.md)
- **AutoCount API wrapper 一览：** [docs/index.md#autocount-api-wrapper-一览](../index.md)
- **Wix JSW 约定：** [docs/wix/jsw/README-wix-jsw.md](../wix/jsw/README-wix-jsw.md)（返回形状、ensureXxxShape、IDE 报 "Property does not exist" 时用 JSDoc @typedef + @type 断言）
- **前端费用页：** [docs/wix/frontend/README.md](../wix/frontend/README.md)
- **RentalCollection 导入：** [rentalcollection-import-steps-powershell.md](../db/rentalcollection-import-steps-powershell.md)、[rentalcollection-import-columns.md](../db/rentalcollection-import-columns.md)
