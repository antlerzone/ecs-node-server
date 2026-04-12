saas property management backend (node/express)
================================================

说明：本仓库是 saas 物业管理平台的 **核心后端服务**。  
**架构：前端（Wix + Next.js Portal）/ 后端 Node / 数据库 MySQL**。不再使用 Wix CMS 作为业务数据源；图片等文件使用阿里云 OSS。与阿里云 ECS / MySQL / Stripe / Bukku 等集成。

**ECS 双产品（Coliving / Cleanlemons）域名与 operator 表：** [docs/readme/ecs-two-products-domains.md](docs/readme/ecs-two-products-domains.md)。

**Coliving ↔ Cleanlemons 物业对齐（2026-04）：** MySQL `propertydetail` 为共享字段主数据；清洁价等仍在 Cleanlemons `cln_property`。列 `premises_type` / `security_system`（migration **0225**）；同步逻辑见 `src/modules/coliving-cleanlemons/coliving-cleanlemons-link.service.js`，`propertysetting` / `roomsetting` 在房源或房间变更后调用（需集成已确认且允许导出）。Coliving Operator **Property**（`/operator/property`）弹窗：**Property details** 顶层为 **Property type**（五类），含 Short name、楼盘、单位、Address；**Access** 为钥匙/安防/Other 床位；**新增** `POST .../propertysetting/insert` 的 `items[]` 可选 **shortname**、**address**。详见 [docs/index.md](docs/index.md)「近期更新」。

**Coliving ↔ Cleanlemons 清洁与租户价（2026-04）：** migration **0226** — `propertydetail` / `roomdetail` 的 **`cleanlemons_cleaning_tenant_price_myr`**；`account` 种子清洁科目；Operator 在 **Property → Edit utility** 设整租参考价与 tenant price，在 **Room** 编辑设房间 tenant price 与 **Schedule cleaning**（`room-rental-cleaning`，马来西亚日期时间）；租户门户 **`/tenant/cleaning`** 下单并走 `rentalcollection` + 开票。详见 [docs/index.md](docs/index.md)。

**Cleanlemons 员工任务（2026-04）：** Portal **`/employee/task`** — MYT 日期、按 `operatorId` 拉排班；同 **`coliving_propertydetail_id`** 且同日 **≥2** 条时可 **Group start / Group end**；**Open Door** 走 Coliving 物业/房间绑定的 TTLock（多锁弹窗选择）。后端 **`/api/cleanlemon/employee/schedule-jobs/group-start|group-end`**、**`/employee/task/unlock-targets`**、**`/employee/task/unlock`**（须 Portal JWT + 员工归属运营商）。详见 [docs/index.md](docs/index.md)「近期更新」Cleanlemons Employee Tasks 条。

**Portal 个人资料（Coliving Next 与 Cleanlemons 同一套 UI，`portal_jwt` + `GET/PUT /api/portal-auth/profile`）：** 见 [docs/readme/index.md](docs/readme/index.md) 章节 **「Portal 个人资料统一页（Coliving / Cleanlemons）」**；总索引见 [docs/index.md](docs/index.md)「近期更新」。

**Coliving Tenant/Owner 主档 ensure（2026-04）：** 进入 **`/tenant`** / **`/owner`** 布局时调用 **`POST /api/portal-auth/coliving-ensure-detail`**（body 中 **`role`** 为 **`tenant`** 或 **`owner`**），保证 **`tenantdetail`** / **`ownerdetail`** 存在，便于 **`ownerportal/owner`** 等与仅读 **`ownerdetail`** 的接口一致。实现与前端封装见 [docs/readme/index.md](docs/readme/index.md)「Coliving Portal — tenantdetail / ownerdetail」、[docs/index.md](docs/index.md)「近期更新」同条。

**文档入口：** [docs/index.md](docs/index.md) — 含 **文档目录**（docs/db、docs/wix/jsw、docs/wix/frontend）、**System Integration**（Meter/CNYIOT、**Smart Door/TTLock**（Operator `/operator/smart-door`：**Sync Lock**=未入库设备预览入库；**Refresh status**=`sync-status-from-ttlock`；TTLock 锁列表字段 **`hasGateway`** 见 index）、contact 与 subdomain 从 client_profile 取、Edit Meter 默认密码 0123456789、Connect to old account 行为与 TTLock 一致）、**會計流程封圈與四系統**（[accounting-flows-summary.md](docs/db/accounting-flows-summary.md)）、**Wix 调用 ECS 与 manage.jsw**（双重认证 token+username、Secret Manager 配置 `ecs_token`/`ecs_username`/`ecs_base_url`）、Bukku API 一览、**支付与 payout 入账**（Stripe / Xendit / Billplz：tenant payment 走 operator 自己的 provider；provider 在 payout/settlement 到银行时由 webhook 回调，若 client 已接 accounting 则即时开 journal；未接 accounting 只更新状态；同一 `payout_id / settlement_id / payment_order_id` 不会重复开 journal）、数据导入步骤、脚本速查、**数据导入与迁移流程总览**、**API User / Token**。**每日定时任务**：`POST /api/cron/daily` 依次执行多项任务（完整顺序见文档）。**主要包括**：① **欠租检查**（`rentalcollection` 过去到期未付 → TTLock **双锁**结束日改昨天、CNYIoT 断电、`active=0`）② **租约日历已过期**（`tenancy.end` &lt; 今天、`status=1`、仍存 PIN → TTLock **`keyboardPwd/delete` 删密码**并清空 `tenancy` 密码列，与 Operator **终止租约**行为一致）③ Demo 账户刷新 ④ 房间可租同步 ⑤ Refund deposit … ⑥ Pricing plan / Core credit / 每月1号 active room 扣费 ⑦ payout/reconciliation fallback（Stripe / Xendit） ⑧ 门锁电量 feedback。详见 [docs/cron-daily-setup-step-by-step.md](docs/cron-daily-setup-step-by-step.md)、[docs/index.md § 每日定时任务](docs/index.md)。**Tenancy + Smart Door**：换房会删**旧房门** PIN、同物业**保留物业门**并在新房 `add`；延租在租约活跃时 `setTenancyActive` 延长双锁有效期；代码见 `tenancy-active.service.js`、`tenancysetting.service.js`。**Storage（OSS）**：新上传走阿里云 OSS（按 client 分目录），表里已有 URL 保留。**Tenant Dashboard** 用 HTML Embed（[upload-oss-embed.html](docs/wix/frontend/upload-oss-embed.html)）上传 feedback 图片/视频与 NRIC 到 OSS，JSW 提供 `getUploadCreds()`；见 [docs/wix/upload-oss-frontend.md](docs/wix/upload-oss-frontend.md)、[docs/wix/frontend/upload-oss-embed-usage.md](docs/wix/frontend/upload-oss-embed-usage.md)。**OSS 上传迁移总结**（5 页 Wix Upload→HTML Embed、表存 URL）：[upload-oss-migration-summary.md](docs/wix/upload-oss-migration-summary.md)。**日期与时区**：datepicker 选 1 Mar = UTC+8 的 1 Mar，读 table 返回一律按 UTC+8 格式化；见 [docs/date-timezone-convention.md](docs/date-timezone-convention.md)。  
- 库表设计：[docs/db/](docs/db/)（[db.md](docs/db/db.md)）。**FK 与 Junction 表**：[fk-and-junction-tables.md](docs/db/fk-and-junction-tables.md)。**导入约定**：CSV 中 `*_wixid`/`wix_id` 必须解析为 `_id`（FK）并同步 Junction，见 [import-wixid-to-fk-junction-rule.md](docs/db/import-wixid-to-fk-junction-rule.md)。  
- Wix 后端 JSW：[docs/wix/jsw/](docs/wix/jsw/) — manage、billing、**topup**（充值多页共用）、**contact**（Profile 页联系人，[velo-backend-saas-contact.jsw.snippet.js](docs/wix/jsw/velo-backend-saas-contact.jsw.snippet.js)）、**agreementsetting**（协议模板，[velo-backend-saas-agreementsetting.jsw.snippet.js](docs/wix/jsw/velo-backend-saas-agreementsetting.jsw.snippet.js)）、admindashboard、companysetting、expenses、tenantinvoice 等；[velo-backend-manage.jsw.snippet.js](docs/wix/jsw/velo-backend-manage.jsw.snippet.js)、[README-wix-jsw.md](docs/wix/jsw/README-wix-jsw.md)。  
- Wix 前端：[docs/wix/frontend/](docs/wix/frontend/) — **Profile/Contact 页**（[contact-setting-page-full.js](docs/wix/frontend/contact-setting-page-full.js)：Owner/Tenant/Supplier 列表与编辑、#dropdownbank←bankdetail、#inputbukkuid 按 account system 读写、#text19 loading、删除二次确认）、**费用页**、**Agreement Setting 页**（[agreementsetting-page-full.js](docs/wix/frontend/agreementsetting-page-full.js)：协议模板列表/新建/删除、Topup）、**Admin 页**、**Tenant Dashboard 页**（[tenant-dashboard-page-full.js](docs/wix/frontend/tenant-dashboard-page-full.js)：Profile/未签合约/租金门控，见 [docs/index.md § Admin / Tenant Dashboard 按钮启用规则](docs/index.md)）、**Generate Report 页**（[generatereport-page-full.js](docs/wix/frontend/generatereport-page-full.js)：Report/GR、#tablegr 见 [generatereport-tablegr-datasource.md](docs/wix/frontend/generatereport-tablegr-datasource.md)；rentalcollection 以 **type_id** 分类：Rental Income、Forfeit Deposit、Parking、Owner Commission 等，title 仅 fallback；datepicker UTC+8、#buttonclosegr/#buttonclosegrdetail 返回上一 section）、Billing、Company Setting、发票/租金页等；**充值（Topup）** 多页共用 **backend/saas/topup**。详见 [docs/index.md](docs/index.md)、[docs/readme/index.md](docs/readme/index.md)。  
**各表 CSV 导入**：operatordetail、tenantdetail、ownerdetail、propertydetail、supplierdetail、lockdetail、gatewaydetail、ownerpayout、roomdetail、staffdetail、tenancy、bills(UtilityBills)、agreementtemplate、account(bukkuid)、creditplan、meterdetail、pricingplan、pricingplanaddon、pricingplanlogs 见 [docs/index.md](docs/index.md) 脚本速查与流程总览；逐步步骤见 [docs/db/](docs/db/)（import-ownerpayout-roomdetail-stepbystep.md、import-staffdetail-tenancy-stepbystep.md 等）。导入时凡有 `*_wixid`/`wix_id` 须解析为 FK 并同步 Junction（如 account→account_client），见 [import-wixid-to-fk-junction-rule.md](docs/db/import-wixid-to-fk-junction-rule.md)。**Account 設定**：存檔只寫 **account_client**；既有 account_json 可遷移：`node scripts/migrate-account-json-to-account-client.js`。Migrations：0069（operatordetail.bukku_saas_contact_id）、0070（補 Cash/Management Fees/Platform Collection，僅當無該 title）、0071（可選刪除 0070 三筆）、0072（operatordetail.cnyiot_subuser_id / cnyiot_subuser_login / ttlock_username）、0073（operatordetail.cnyiot_subuser_manual / ttlock_manual）。  
**Bank bulk transfer（JomPay / Bulk Transfer）**：bills 用 supplierdetail（不连 account）；supplierdetail.utility_type（electric/water/wifi）决定 JP Reference 1 从 propertydetail.water / electric / wifi_id 取；资料不齐时下载 zip 含 errors.txt。详见 [docs/index.md](docs/index.md)「Bank bulk transfer」节与 [docs/db/cms-field-to-mysql-column.md](docs/db/cms-field-to-mysql-column.md)。

## tech stack

- **runtime**: node.js (express)
- **database**: aliyun mysql
- **storage**: aliyun oss（图片 / 视频）
- **payments**: Stripe Connect Standard（current Stripe model）+ Xendit direct + Billplz direct。**Payout / settlement journal 主流程已改为 provider webhook 驱动**：provider payout 成功回调时，若 client 已接 accounting 则即时开 journal；未接 accounting 只更新本地状态；cron 仅保留 fallback / reconciliation。见 [docs/index.md](docs/index.md)、[docs/stripe.md](docs/stripe.md)、[docs/readme/index.md](docs/readme/index.md)
- **accounting**: **四系統** Xero / Bukku / AutoCount / SQL（開 invoice、receipt、refund、purchase 等）；**SaaS 等級**，依每個 client 的 provider 在該系統生成單據。憑證存 `client_integration`（addonAccount）。**account 表**為科目範本（全站共用），**account_client** 存每 client 每系統的 accountid 對應；Account 設定頁只寫 account_client。六類流程（Meter、Rental collection、Expenses、Owner payout、Refund deposit、Forfeit deposit）已封圈；所需科目與檢查清單見 [docs/db/accounting-accounts-checklist.md](docs/db/accounting-accounts-checklist.md)。**平台 SaaS Bukku**（topup/plan 開單）用 operatordetail.bukku_saas_contact_id（0069）、env BUKKU_SAAS_*。  
  **Xero 對齊補充（2026-03）**：operator/accounting sync、contact sync（import/export）、booking/tenant invoice create+payment+void、expenses bill create+void、owner payout create+mark paid+void、refund+forfeit create+void 均已對齊 Bukku 流程。Xero `Spend Money` 一般無公開 URL；refund void 採用 Xero BankTransactions API `POST /BankTransactions/{BankTransactionID}` + `Status=DELETED`（等同 UI「Remove & Redo」）。
- **env**: ecs server in malaysia

## architecture overview

- **frontend**
  - 主 web 前端在 wix
  - 未来：通过 wix apps 对接 ios / android
  - 每个 client 使用自己的 subdomain 登录使用平台

- **backend**
  - 单一 saas 后端，多租户（multi-tenant）架构
  - 通过中间件从 host / headers 解析当前 client / tenant
  - **Wix 调 ECS：** 双重认证（请求头 `Authorization: Bearer <token>` + `X-API-Username: <username>`），凭证与后端根地址放在 Wix Secret Manager（`ecs_token`、`ecs_username`、`ecs_base_url`），见 [docs/index.md](docs/index.md) 与 [docs/wix/jsw/velo-backend-manage.jsw.snippet.md](docs/wix/jsw/velo-backend-manage.jsw.snippet.md)
  - 每个 client 持有自己的：
    - bukku 凭证（subdomain / token）
    - stripe / stripe connect 配置
  - **API 用户（Open API / 第三方）：** `api_user` 表，token 自动生成，管理接口需 `x-admin-key`；新增用户脚本 `node scripts/insert-api-user.js <username>`

- **data & integrations**
  - **MySQL** 为唯一业务数据库（client / tenant / property / booking / payments 等），**不再读 Wix CMS**
  - stripe 处理支付，支付成功后触发后端逻辑、通过 bukku api 开 invoice / receipt
  - **Storage（OSS）**：图片/视频上传走 **阿里云 OSS**（Node `POST /api/upload`，按 client 分目录）；表里存 **URL**，已有 URL 保留；前端对接 [docs/wix/upload-oss-frontend.md](docs/wix/upload-oss-frontend.md)；**迁移总结**（5 页 HTML Embed、getUploadCreds、表存 URL）见 [upload-oss-migration-summary.md](docs/wix/upload-oss-migration-summary.md)
  - **日期**：客户 MY/SG (UTC+8)；MySQL 存 UTC；datepicker 选 1 Mar = UTC+8 的 1 Mar，读 table 返回前统一按 UTC+8 格式化；见 [docs/date-timezone-convention.md](docs/date-timezone-convention.md)

## project layout (planned)

> 目录和文件名全部使用 **小写**，函数名也使用 **小写**（例如 camelcase 或 snakecase），  
> 只有外部 api / sdk 按官方要求保留原有命名。

- `server.js`  
  - express 入口，挂载中间件和路由

- `src/config`
  - `db.js`: mysql 连接配置
  - `bukku.js`: bukku 相关基础配置（如 base url）
  - Stripe：凭证从 `.env` 读取（`STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`），封装在 `src/modules/stripe/`，见 [docs/stripe.md](docs/stripe.md)

- `src/db`
  - `migrations/`: 建表 / 修改表结构脚本（后续可以接入 migration 工具）
  - `queries/`: 复用查询（从原 wix jsw 慢慢迁移过来）

- `src/middleware`
  - `clientresolver.js`: 从 host / header 解析 client、tenant 及其 bukku/stripe 配置
  - `validate.js`: joi 校验中间件
  - `errorhandler.js`: 统一错误处理

- `src/modules/bukku`
  - 共享：`wrappers/bukkurequest.js`（HTTP 封装）、`lib/bukkuCreds.js`（按 client 取 token/subdomain）
  - 每个资源：`validators/*.validator.js`（Joi schema）、`wrappers/*.wrapper.js`（调 Bukku）、`routes/*.routes.js`（对外 HTTP）
  - Sales：invoices, quotes, orders, delivery_orders, credit_notes, **invoicepayment**（对发票的收款）, refunds
  - Purchases：orders, goods_received_notes, bills, credit_notes, **purchasepayment**（对账单的付款）, refunds
  - 完整资源列表与 prefix 见 `docs/index.md`

- `src/modules/*`
  - `tenants`, `billing`, `booking`, `cleaning`, `renovation` 等模块，将来按业务拆分

## naming convention

- **所有内部代码一律小写**：
  - 目录名：`src/modules/bukku`, `src/middleware`
  - 文件名：`invoice.routes.js`, `bukkuclient.js`
  - 函数名变量名：`create_bukku_client` 或 `createBukkuClient`（但不使用大写开头的类名风格）
- **外部 api / sdk**：保留官方命名（例如 `Stripe`, `PrismaClient` 等），避免兼容性问题。

## import & id (uuid) 规则

- **所有表的 id 一律使用我们自己的 UUID**（varchar(36)），不用 Wix/外部的 _id 当主键。
- **导入时**：每一行都必须生成新的 UUID 写入 `id`；Wix 的 `_id` 只写入 `wix_id`。
- **UUID 绝对不可重复**：生成时用 `crypto.randomUUID()`，并在同次导入内用 Set 校验不重复。
- **关联 client 的外键**：一律使用 `client_id` → `operatordetail(id)`；表中可同时保留 `client_wixid`（来自 CSV/Wix），仅用于导入与对照，不做 FK。
- 脚本：
  - **OperatorDetail（主表 + 4 子表）**：清空+导入见 [docs/db/import-operatordetail.md](docs/db/import-operatordetail.md)；一条命令 `node scripts/clear-and-import-operatordetail.js [csv]`。
  - **导入 CSV（自带 UUID）**：`node scripts/import-csv-with-uuid.js <表名> <csv路径>`
  - **把已有表的 int id 改成 UUID**：`node scripts/migrate-table-id-to-uuid.js <表名>`

## database tables (current & planned)

> 下面为 **MySQL 中已有表**的分类整理及未来规划。数据全部在 MySQL，不读 Wix CMS。  
> 真实字段（column）和约束会单独在 [docs/db/db.md](docs/db/db.md) 里再做详细设计。

- **core / identity**
  - `operatordetail`: saas 客户（公司级账号），包含子域名、email、stripe / accounting 配置等（未来不同业务线如 property / renovation 可以有各自的 operatordetail 视图或扩展表）
  - `tenantdetail`: 租客资料（与 property / tenancy 关联）
  - `ownerdetail`: 业主 / 房东资料
  - `staffdetail`: 员工 / 内部用户资料
  - `supplierdetail`: 供应商资料

- **property management**
  - `propertydetail`: 物业 / 项目（含 `premises_type`、`security_system`；与 Cleanlemons `cln_property` 同步见上「Coliving ↔ Cleanlemons 物业对齐」与 [docs/index.md](docs/index.md)）
  - `roomdetail`: 房间 / 单元
  - `tenancy`: 租约（连接 tenant / room / property）
  - `parkinglot`: 车位信息

- **billing & payments**
  - `rentalcollection`: 租金账单（周期性租金）
  - `rentalcollectiontransaction`: 租金支付记录（同步状态未来全部从 console 侧处理）
  - `bukkuid` → **rename 为** `accounting`: 对接会计系统（bukku）所需信息
  - `utiltybills` → **rename 为** `bills`: 各类账单（包括水电费等）
  - `refunddeposit`: 押金退款记录
  - `refundtransaction`: 退款交易记录
  - `ownerpayout`: 向业主打款 / 分账记录
  - `gatewaydetail`: 支付网关配置（当前主要为 stripe，旧 payex 逻辑弃用）
  - `payexsettlement`: **废弃**（payex 已不再使用）
  - `creditplan`, `creditlogs`, `pricingplan`, `pricingplanaddon`, `pricingplanlogs`: 计费方案与日志
  - `pricingplan`, `pricingplanaddon`: 套餐与附加服务

- **iot / locks / meters**
  - `ttlocktoken`: ttlock 平台 token
  - `lockdetail`: 锁具信息
  - `meterdetail`: 仪表信息（水/电/气等）
  - `metertransaction`: 仪表读数 / 扣费记录
  - `tuyatoken`: **暂不使用**（tuya 当前不用）
  - `doorsync`: **历史同步状态表，未来同步状态统一由 console 处理**
  - `syncstatus`: **历史同步状态表，未来不再使用**
  - `cnyiottokens`: cny iot 平台 token（如仍在使用，会在单独模块中统一管理）

- **support / agreement**
  - `agreement`: 租赁或服务协议（实例）
  - `agreementtemplate`: 协议模板
  - `faq`: 常见问题
  - `feedback`: 用户反馈
  - `ticket`: 工单 / 支持单
  - `bankdetail`: 银行账户信息

- **未来 renovation 模块（规划）**
  - `operatordetail`（renovation 业务线自己的视角 / 扩展字段）
  - `furniture`: 家具方案与明细
  - `electricappliance`: 家电方案与明细

> 备注：标记为「废弃 / 不再使用」的表会在迁移到新后端后逐步退出，仅保留历史数据。

## account & apps model (all-in-one apps)

- **统一账号（email）**
  - 所有用户（client / tenant / owner / staff / supplier）在未来的 all-in-one apps 中通过 **email 注册成为平台用户**。
  - email 是跨应用识别用户的主键之一（内部可以再配合 user id）。

- **按业务线授权 / 绑定**
  - 用户在 all-in-one apps 注册后，如果要使用 property management，需要绑定现有的 property management 账号（client），完成授权。
  - 如果用户要使用 renovation 模块，则单独与 renovation 的 operatordetail / 账户进行授权绑定。

- **多应用共享 client 资源**
  - 不同前端（property management、cleaning、stay/民宿、renovation 等）可以复用同一个 client 的基础资料和用户体系，但在各自业务模块中拥有独立的配置与数据表。
  - 后端会通过统一的身份层（基于 email 的 user + per-app 授权关系）把这些模块串起来。

## bukku integration notes

- 后端会提供一个统一的 bukku wrapper：
  - 封装 base url / auth / error handling
  - 对外暴露语义化的方法（如创建 invoice、receipt）
- **校验（validation）必须和 bukku 官方 api 文档 100% 对齐**：
  - 在拿到官方 api docs 前，只搭好 wrapper 结构和空的 schema
  - 拿到 docs 后，再逐个 endpoint 设计 joi schema，保证字段、必填项、类型完全匹配

## next steps

1. 基于当前表清单，在 [docs/db/db.md](docs/db/db.md) 中细化每个表的字段与约束，并标记哪些只保留历史数据。  
2. 搭建基础目录结构与中间件（clientresolver / validate / errorhandler）— 已完成。  
3. Bukku wrapper 已按资源补全（Sales / Purchases / Banking / Contacts / Products / Accounting / Files / Control Panel），见 `docs/index.md`。  
4. 从 wix jsw 逐步迁移业务逻辑到本后端，确保对前端保持兼容的 api 契约。

## cleanlemons（operator portal）近期更新

- **Property ownership model（2026-03）**：Cleanlemons `cln_property` 现按业务语义分离：
  - `clientdetail_id` → `cln_clientdetail.id`（property 归属客户）
  - `operator_id` → `cln_operatordetail.id`（可见/可管理该 property 的 operator）
  - 规则：**一个 property 仅对应一个 operator**（单行单 `operator_id`）
  - 兼容：保留 legacy `client_id`，用于旧逻辑回退；新逻辑优先 `clientdetail_id/operator_id`
  - 迁移：`src/db/migrations/0210_cln_property_clientdetail_operator_model.sql`

- `cleanlemon/next-app/app/portal/operator/pricing/page.tsx`：已从日历改为「服务配置 + 预约设置 + 动态服务 tabs」的价钱表 UI。
- Pricing 支持按服务配置多种 section mode（例如 by hour / by property / base on quotation / homestay / dobi），并通过 detail dialog 分开编辑。
- Dobi 的 `by kg`、`by pcs`、`by bed` 各自独立 dialog；`by kg` 与 `by pcs` 里均有 Dobi Services + Ironing 两个 section，支持 operator 自定义 item 与 Add Item。
- `cleanlemon/next-app/app/portal/operator/calender/page.tsx`：恢复大日历视图（定价调整、badge 色彩区分、点击 badge 编辑 promotion、下方 adjustment list）。
- Operator 侧栏已加入 `Calender` 入口：`/operator/calender`。

