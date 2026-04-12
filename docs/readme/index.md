# Docs Readme Index

文档入口与各模块说明索引。主文档目录见 [docs/index.md](../index.md)。

---

## ECS 双产品（Coliving / Cleanlemons）

同一 ECS 上 **api.colivingjb.com + portal.colivingjb.com**（公司主表 `clientdetail` → `operatordetail`）与 **api.cleanlemons.com + portal.cleanlemons.com**（公司主表 `cln_client` → `cln_operator`，代码中无 `clm_operator` 表名）的域名、端口、OAuth 与迁移对照见 **[ecs-two-products-domains.md](./ecs-two-products-domains.md)**。

---

## Portal 个人资料统一页（Coliving / Cleanlemons）

**目标：** Tenant / Owner / Operator 个人资料 **同一套页面布局与字段**（与 Cleanlemons 侧 `unified-profile-page` 对齐），数据统一落在 **`portal_account`**，由后端 `updatePortalProfile` 同步 tenantdetail / staffdetail / ownerdetail（同 email）。

| 项目 | 说明 |
|------|------|
| **Coliving 前端** | `docs/nextjs-migration/components/shared/unified-profile-page.tsx`；路由：`/tenant/profile`、`/owner/profile`、`/operator/profile`（薄页面仅渲染该组件并传 `uploadRole`）。 |
| **Cleanlemons 前端** | `cleanlemon/next-app/components/shared/unified-profile-page.tsx`（员工等角色仍走 Cleanlemons API 封装；映射同一 `portal_account` 字段）。 |
| **读写 API** | `GET /api/portal-auth/profile`、`PUT /api/portal-auth/profile`（需 **`Authorization: Bearer <portal JWT>`**）；密码状态 `GET /api/portal-auth/password-status`；忘记/重置密码沿用 `POST /api/portal-auth/forgot-password`、`reset-password`。 |
| **`portal_jwt` 存储** | 浏览器 `localStorage` 键名 **`portal_jwt`**（`docs/nextjs-migration/lib/portal-session.ts` 中 `PORTAL_KEYS.PORTAL_JWT`）。**OAuth**：`/auth/callback` 用 `?token=` 验证成功后写入。**密码登录**：`POST /api/portal-auth/login` 成功响应含 **`token`**（Node `portal-auth.service.js` `login()`）。登出 `clearPortalSession()` 会清除该键。 |
| **Next 代理** | 使用 `NEXT_PUBLIC_USE_PROXY=true` 时，`GET`/`PUT` **`/api/portal/proxy/portal-auth/profile`** 等须转发；实现见 `docs/nextjs-migration/app/api/portal/proxy/[...path]/route.ts`（`portal-auth/*` 使用浏览器请求的 Bearer，不用 ECS API token 覆盖）。 |
| **上传** | 头像/NRIC：按角色 `tenant` → `tenantdashboard/upload`，`owner` → `ownerportal/upload`，`operator` → `POST /api/upload`（multipart，`clientId` + `file`）。 |
| **封装** | Coliving：`docs/nextjs-migration/lib/unified-profile-portal-api.ts`。 |
| **Demo** | `demo.colivingjb.com`：`shouldUseDemoMock()` 为真时不打真实 profile API，组件用 `localStorageKeyDemo` 存草稿。 |

**联动说明：** [profile-sync-and-portal.md](../profile-sync-and-portal.md)。

---

## Coliving Portal — tenantdetail / ownerdetail（进入子站时 ensure）

与 Cleanlemons **员工进 `/employee` 调 `cleanlemons-ensure-employee`** 类似，Coliving 在用户进入 **Tenant** 或 **Owner** 门户时再保证对应业务主档存在（幂等）。

| 项目 | 说明 |
|------|------|
| **API** | **`POST /api/portal-auth/coliving-ensure-detail`**，`Authorization: Bearer <portal JWT>`，body：`{ "role": "tenant" }` 或 `{ "role": "owner" }`。按当前 JWT 邮箱查 **`portal_account`**，再 **`ensureColivingTenantdetail`** 或 **`ensureColivingOwnerdetail`**（`portal-detail-ensure.service.js` → `ensureColivingDetailForPortalEmail`）。 |
| **与登录 ensure 关系** | 登录成功仍可能异步跑 **`ensureColivingTenantdetail` + `ensureColivingOwnerdetail`**（两者都试）；本子接口按 **role 只补一侧**，避免仅依赖登录路径。 |
| **Coliving Next** | **`app/owner/owner-layout-client.tsx`** 先 **`ensureColivingPortalDetail('owner')`** 再挂 **`OwnerProvider`**；**`app/tenant/tenant-layout-client.tsx`** 先 **`ensureColivingPortalDetail('tenant')`** 再挂 **`TenantProvider`**。封装：**`lib/unified-profile-portal-api.ts`** → **`ensureColivingPortalDetail`**。 |
| **Cleanlemons 对照** | **`POST /api/portal-auth/cleanlemons-ensure-employee`** → upsert **`cln_employeedetail`**；**`cln_clientdetail`** 见登录时 **`ensureCleanlemonsClnClientdetail`**。 |

---

## Migration 0087：id = Wix _id（已完成）

- **变更：** 所有表 `id` = Wix CMS 的 `_id`；已删除 `wix_id`、`*_wixid` 列。
- **Import：** CSV 的 `_id` 直接写入 `id`；reference 列（client、property 等）直接写入对应 `_id` 列。
- **新 insert：** 后端 `randomUUID()` 生成 id。
- **FK / Junction：** 全部用 `_id` 列，直接写入 Wix id 即可。详见 [import-wixid-to-fk-junction-rule.md](../db/import-wixid-to-fk-junction-rule.md)。

---

## 页面类型（Public / Client / Indoor）

- **SaaS Client Page** — 需 permission 的页面（client 员工后台）：Company Setting、Room Setting、Booking、Billing、Admin Dashboard、Expenses、Tenant Invoice（员工）等。均在 Portal Next.js Operator 中实现。
- **Public Page** — Client 的顾客页：**Owner Dashboard**、**Tenant Dashboard**；**Enquiry Page**（新客户询价 / lead 提交，`backend/saas/enquiry` → `/api/enquiry`，无登录；试用用 demo.colivingjb.com）；**Available Unit 页**（公开房源列表，无登录，`backend/saas/availableunit` → `/api/availableunit/list`）。Portal 公开页（portal.colivingjb.com：Pricing、Enquiry、Proposal、Owner Enquiry、Privacy Policy、Refund Policy）见下方「Portal 公开页」小节。
- **Indoor Admin** — 平台手動 billing 页（manual topup / manual renew）。**Portal Next.js** 提供 **SaaS Admin**（/saas-admin）：仅 **saasadmin 表**（migration 0093）内邮箱可进；Dashboard 首页（Credit used 本月 + 按月图）、Clients、Credit Top-up（Payment date 默认今天）、Pricing Plan（Remark：New customer/Renew/Upgrade，0094）、Pending 工单（Fill top-up form 预填跳转）。API：`billing/indoor-admin/*`、`credit-used-stats`。**Operator Portal**（/operator）：仅 staff 在 /portal 可见入口；默认 /operator/billing；侧栏按 staff 权限过滤（admin/profilesetting/usersetting/integration/billing/finance/tenantdetail/propertylisting/marketing/booking）；无 credit 强制 /operator/credit、新 client 未填公司资料强制 /operator/company；**主账号**（operatordetail.email = Company Email）在 Company Setting 不可编辑，具全权限。详见 [docs/index.md](../index.md)#近期更新 Summary（SaaS Admin、Operator Portal）、Billing 节 Indoor-admin 与 Operator Portal 权限与主账号。

---

## Cleanlemons Operator Portal（Next.js）

- **Pricing（`/operator/pricing`）**
  - UI 为三段式：`Services Provider`、`Booking Setting`、`Pricing Setting`。
  - `Pricing Setting` tabs 动态跟随 Services Provider 勾选结果（General/Deep/Renovation/Homestay/Room Rental/Commercial/Office/Dobi）。
  - Dobi 模式使用独立 detail 弹窗（by kg / by pcs / by bed），by kg 与 by pcs 含 Dobi Services + Ironing，支持 Add Item。

- **Invoices（`/operator/invoices`）**
  - `Preview Invoice` / `Preview Payment` 仅在已连接 Accounting（Bukku/Xero）时显示。
  - `paid` invoice 不可直接删除：Action menu 不显示 Delete，需先 `Void Payment` 后才可删除。
  - 状态已简化为 `paid` / `overdue` / `cancelled`（无 draft/sent）。
  - 已加 `Invoice Automation` 弹窗：按 service provider 设定 `during booking` / `after work` / `monthly`；monthly 支持 first day、last day、specific day（31 自动按短月最后一天）。
  - 已加筛选：`Search + Status + Month (Jan-Dec) + Year`。

- **Property（`/operator/property`）**
  - 列表卡片 + **Edit Property** / **Add Property** 弹窗分区：**Property details**（**Property type** 置顶；Short name、Apartment/Building、Unit、Address；新增楼盘时 Country 只读=operator MY/SG）、**Owner**、**Access**（钥匙领取、**security_system**、类型 **Other** 时床位/房型）、**Owner settlement & files**。
  - **新增房源**：`POST /api/propertysetting/insert` 的 `items[]` 可选 **shortname**、**address**（未传 shortname 时仍为「楼盘名 + 单位」）；与编辑一致传 `premisesType`、`securitySystem`。
  - 详述与 Cleanlemons 同步见 [docs/index.md](../index.md)「近期更新」Coliving ↔ Cleanlemons 条。

- **Property Map（`/operator/property` -> map view）**
  - 已接入真实地图（Leaflet + OpenStreetMap），按 property `lat/lng` 打 marker。
  - 左侧 property side tab 保留在地图上层；点击列表项仅定位地图到该 property，不再弹出详情弹窗。

---

## Cleanlemons Employee Portal — Tasks（`/employee/task`）

- **页面：** `cleanlemon/next-app/app/portal/employee/task/page.tsx`。员工须已在 Portal 绑定 Cleanlemons **staff** 并在 header 选择 **operator**（`localStorage.cleanlemons_employee_operator_id`）。
- **排班数据：** `GET /api/cleanlemon/operator/schedule-jobs?operatorId=...`；列表项含 **`colivingPropertydetailId`** / **`colivingRoomdetailId`**（用于同物业成组与开门解析），见 [docs/index.md](../index.md)「近期更新」Cleanlemons Employee Tasks。
- **日期：** 界面默认与「今日完成度」按 **MYT（Asia/Kuala_Lumpur）**。
- **Group start / Group end：** 仅当筛选日期下、同一 **`coliving_propertydetail_id`** 且 **≥2** 条任务时出现按钮；Start 仅针对全部为 **Ready to Clean** 的子集，End 仅针对全部为 **In Progress** 的子集；End 时 **整组一套**照片与备注写入每条 `cln_schedule`。成组依赖物业已填 Coliving 关联列，否则无按钮。
- **Open Door：** `postEmployeeTaskUnlockTargets` → 多锁则弹窗选择 → `postEmployeeTaskUnlock`；无绑定门锁时提示。解锁走员工 API + `smartdoorsetting.remoteUnlockLock`（锁行上 Coliving / `cln_client` / `cln_operator` scope）。
- **API 封装：** `cleanlemon/next-app/lib/cleanlemon-api.ts`（`postEmployeeScheduleGroupStart`、`postEmployeeScheduleGroupEnd`、`postEmployeeTaskUnlockTargets`、`postEmployeeTaskUnlock`）。**鉴权：** 请求需带 **`Authorization: Bearer <portal_jwt>`**（与 `apiFetch` 行为一致）。

---

## Portal 公开页（Pricing / Enquiry / Owner Enquiry / Proposal）

Portal（portal.colivingjb.com、demo.colivingjb.com）的公开、无登录即可访问的页面与流程：

- **Pricing（/pricing）**：先选国家（Malaysia / Singapore），再选角色。**Owner manage own** 或 **Operator** → 完整定价页：**方案**为「付 X 得 X credits，有效 1 年」；到期需再购买以 renew 或 upgrade。**Stripe 费率**表：Processing Fees 为总百分比，Note 列为 X%+1（Stripe % + 1% 平台）。**Credit Value**：**Core credit** = 方案订阅、1 年有效、1:1；**Flex credit** = 无到期、从 creditplan 表 top-up（如 RM1,800→2,000、RM850→1,000、RM160→200）。**Special features** 说明 Parent Meter、Parent Smart Door。Add-On 含 Smart Door TTLock、Smart Meter Cnyiot、Accounting partner Xero/Bukku/Autocount/MySQL。**Owner looking for operator** → 跳转 /proposal，再看 /ownerenquiry。
- **Proposal（/proposal）**：屋主找 operator 的服务与收费说明（10% 月费、按租约佣金），「Get in touch」→ /ownerenquiry。
- **Owner Enquiry（/ownerenquiry）**：屋主资料表单（无 Plan of interest），提交存 **owner_enquiry** 表（migration 0089），ECS `POST /api/owner-enquiry/submit`。
- **Enquiry（/enquiry）**：新客户询价，提交仅保存 lead（client + client_profile，ECS `POST /api/enquiry/submit`），不创建 demo 户口；试用用 **demo.colivingjb.com**，正式用 **portal.colivingjb.com**。
- **Privacy Policy（/privacy-policy）**：平台隐私政策（Coliving Management Sdn Bhd；Malaysia / Singapore；联系与投诉 colivingmanagement@gmail.com）。含收集资料、Cookie（Google Analytics、Facebook Pixel）、第三方共享、SaaS 免责（平台不参与 operator 与 tenant/owner 之法律关系，不提供保护或赔偿）。Pricing、Enquiry、Owner Enquiry、Proposal 顶栏均有链接。
- **Refund Policy（/refund-policy）**：平台退款政策。**适用范围**：仅适用于向 Coliving Management Sdn Bhd 购买之方案费与 credit top-up；租客付给 operator 之款项（租金等）依该 operator 自身条款，不适用本政策。**规则**：credit plan / top-up 不退款、不换货。Pricing 页 Top Up Credit 区块及顶栏、Enquiry / Owner Enquiry / Proposal 顶栏均有链接。

后端：`src/modules/enquiry/`、`src/modules/owner-enquiry/`。表 owner_enquiry 见 `src/db/migrations/0089_owner_enquiry.sql`。Policy 页面为静态内容，代码在 `docs/nextjs-migration/app/privacy-policy/page.tsx`、`app/refund-policy/page.tsx`。

---

## Operator Quick Setup（/operator/quicksetup）

Operator 一站式 onboarding 流程，类似 Airbnb 分步引导；**仅 header 有 Quick Setup 入口**（侧栏无）。Draft 存 **localStorage**，退出可续填；**完整提交后才写入数据库**；新建的 property/room 提交后为 **inactive**，需在 Property / Room Setting 手动激活。

- **URL：** `/operator/quicksetup`。权限：所有 operator 可访问（`operator-permissions` 中该路径无特定 permission）。
- **步骤顺序：** Property → Room (min 1) → Smart Door (optional) → Meter (optional) → **Bind Owner** (optional) → **Agreement Setting** (optional，仅在有 owner 时有效) → Summary → 确认完成。

### 各步说明

1. **Property（必填）**
   - 下拉选择**已有 property**，选中后仍须填写 **Unit number**（该物业下的单元/房号）。
   - 或点「Add new property」：与 Property Setting 一致，填写 **Apartment / Building name**、Unit number、Address；新建物业提交后为 inactive。
2. **Room（必填，至少 1 间）**
   - 房间名、租金、描述、**Remark 下拉**（预设选项）、**照片**（支持批量上传、排序、删除、预览），对应 Room Setting 能力。
3. **Smart Door（可跳过）**
   - **Sync** 拉取 TTLock **尚未写入本系统**的锁/网关列表，勾选后填 alias，点 **Binding** 写入本 client；与 Smart Door Setting 弹窗 **Sync Lock** 一致。已在库设备的电量/是否绑网关等请到 **Smart Door Setting** 点 **Refresh status**（`sync-status-from-ttlock`）。
4. **Meter（可跳过）**
   - 可添加多笔：Meter ID（11 位）、Title、Rate；提交时走 `insertMetersFromPreview` + `updateMeter`。
5. **Bind Owner（可跳过）**
   - 「Add owner」弹窗输入 email，保存邀请；与 Owner 绑定流程一致。
6. **Agreement Setting（可跳过，且依赖 Owner）**
   - **仅当已绑定 Owner 时**本步才有意义；若在 Bind Owner 步选择 Skip，则跳过 Agreement 步直接进入 Summary（不显示 Agreement 配置）。
   - 有 owner 时：选择 **Mode**，选项含 **Owner & Operator (Management agreement)**、Owner & Tenant；可链到 Agreement Setting 页配置模板。
7. **Summary**
   - 只读汇总：Property（含 unit number）、Rooms、Smart Door / Meter / Owner / Agreement（有 owner 时）状态；确认后点「Confirm & Complete onboarding」执行写入。

### 数据与 API

- **Draft 结构：** `selectedPropertyId`、`unitNumberForSelected`（选已有物业时的单元号）、`newProperty`（apartmentName, unitNumber, address）、`rooms`（含 photos）、`meters`、`ownerEmail`、`agreementMode`、`skipped`。
- **提交时：** 新建 property 用 `insertProperty`，已有用 `selectedPropertyId`；房间 `insertRoom` / `updateRoom`；电表 `insertMetersFromPreview` + `updateMeter`；智能门 `insertSmartDoors` + `syncTTLockName`；有 owner 时 `saveOwnerInvitation`。新建 property/room 会设为 inactive。
- **完成页提示：** 请到 **Property Setting** 与 **Room Setting** 激活物业与房间。

前端：`docs/nextjs-migration/app/operator/quicksetup/page.tsx`；API 见 `lib/operator-api.ts`（getPropertyList、insertProperty、insertRoom、insertSmartDoors、insertMetersFromPreview、saveOwnerInvitation 等）。

---

## 门禁拒绝约定

- **统一约定：** 所有使用 `getAccessContext()` 的门禁逻辑，拒绝时文案：**NO_PERMISSION** → "You don't have permission"，其余（NO_STAFF、NO_CLIENT 等）→ "You don't have account yet"。无 credit 或无 permission 时相关入口 disable。
- **Permission 与页面：** admin = 全部可进；usersetting → Staff；integration → System Integrations；billing → Billing/Credit；profilesetting → Company；booking → Booking；propertylisting → Property/Smart Door/Meter/Room/Owner/Agreement Setting；tenantdetail → Contact；finance → Expenses、Generate Report。逻辑在 Portal Next.js 中实现。

---

## 每日定时任务（Daily Cron）

- **接口：** `POST /api/cron/daily`（Header `X-Cron-Secret` = `.env` 的 `CRON_SECRET`），建议每天 00:00 UTC+8 调用一次。
- **要点：** ① **欠租** → TTLock **双锁**结束日改昨天、断电、`active=0`。② **租约日历到期**（`tenancy.end` &lt; 今天、`status=1`）→ TTLock **`delete` 删密码** + 清空 tenancy 密码列（响应 `endedTenancyPasscodes`）。③ **Demo 刷新** → **房间可租** → Refund deposit → Pricing / Core credit → 每月 1 号 active room → **Stripe + Payex** → 门锁电量 feedback。
- **完整顺序与 Tenancy/换房/终止 说明：** [docs/index.md § 每日定时任务](../index.md)（与代码 `tenancy-cron.routes.js` 一致）、[cron-daily-setup-step-by-step.md](../cron-daily-setup-step-by-step.md)。实现：`tenancy-cron.routes.js`、`tenancy-active.service.js`、`demo-refresh-cron.service.js`、`refund-deposit-cron.service.js`、`pricing-plan-expiry-cron.service.js`、`core-credit-expiry-cron.service.js`、`active-room-monthly-cron.service.js`、`battery-feedback-cron.service.js`、`settlement-journal.service.js`、`lock.wrapper.js`（`deletePasscode`）。

---

## TTLock API wrapper（SaaS 多人调用）

- **认证：** 每 client 用 `client_integration`（key=smartDoor, provider=ttlock）的 ttlock_username / ttlock_password 换 token，token 存 `ttlocktoken` 表（按 client_id），自动 refresh。调用 TTLock 时用 **TTLock Open Platform** 的 app 凭证（env：`TTLOCK_CLIENT_ID`、`TTLOCK_CLIENT_SECRET`）。
- **目录：** `src/modules/ttlock/` — `lib/ttlockToken.service.js`、`lib/ttlockCreds.js`、`lib/ttlockRegister.js`、`lib/ttlockSubuser.js`；`wrappers/ttlockRequest.js`、`lock.wrapper.js`、`gateway.wrapper.js`；`validators/lock.validator.js`、`gateway.validator.js`；`routes/lock.routes.js`、`gateway.routes.js`、`routes/user.routes.js`。请求先 Joi 校验再进 wrapper（与 Bukku 一致）。
- **HTTP 路由：** `GET/POST /api/ttlock/locks`（列表、详情、重命名、电量、密码列表/新增/修改、远程开锁）、`GET/POST /api/ttlock/gateways`（列表、单条、重命名）、`POST /api/ttlock/users/ensure-subuser`（为当前 client 确保 TTLock 子账号，无则用 subdomain 注册并写入 client_integration）。client 由 clientresolver 从 host 解析，`req.client.id` 即 clientId。
- **程序调用：** `const ttlock = require('./src/modules/ttlock');` → `ttlock.lock.listAllLocks(clientId)`、`addPasscode`、`changePasscode`、**`deletePasscode`**（租约到期/终止/换房删 PIN）、`ttlock.gateway.listAllGateways(clientId)`、`ttlock.getValidTTLockToken(clientId)`、`ttlock.ensureTTLockSubuser(clientId)`（为 client 开子账号）。
- **子账号：** 平台可为每个 client 开一个 TTLock 子账号（v3 user/register）。**Username 与 password 均由我们 SaaS 设定**（非 TTLock 随机）：username = 该 client 的 **subdomain**（小写、唯一），password = 我们设定的默认密码（如 0123456789）；存 `client_integration`（key=smartDoor, provider=ttlock）的 ttlock_username / ttlock_password。若无该行会先自动插入再注册。详见 [docs/ttlock-subuser.md](../ttlock-subuser.md)。

---

## CNYIoT API wrapper（统一平台主账号）

- **认证模型：** **所有 client 共享平台主账号** 调用 CNYIoT；**client 不需要绑定 CNYIoT**。平台主账号凭证来自 env：`CNYIOT_LOGIN_NAME`、`CNYIOT_LOGIN_PSW`，登录后得到 apiKey + loginID，按 **platform 级别** 缓存在内存与 `cnyiottokens` 表中，24h 失效后自动重新登录。
- **调用方式：** 所有与用量 / 抄表 / 充值相关的接口（`getUsageSummary`、`getMeterStatus`、`getUsageRecords`、`getMonthBill`、`getOperationHistory`、`createPendingTopup`、`confirmTopup`）一律传 `usePlatformAccount: true`，通过 **主账号 token** 调用 CNYIoT；client 仅在本地维护 `meterdetail` 等配置，**不需要 client_integration 的 meter/cnyiot 绑定**。
- **安全与重试：** 请求时 apiKey 仍用 **AES-ECB** 加密（env：`CNYIOT_AES_KEY`）再传。**直连官方 API**：base URL 为 `https://www.openapi.cnyiot.com/api.ashx`；仅可通过 **`CNYIOT_BASE_URL`** 覆盖（已移除 `CNYIOT_PROXY_BASE`）。`CNYIOT_API_ID` 默认 `coliman`。响应 5002 时自动清除 token 并重试一次。
- **目录：** `src/modules/cnyiot/` — `lib/cnyiotToken.service.js`、`lib/cnyiotCreds.js`、`lib/encryptApiKey.js`、`lib/getClientTel.js`；`wrappers/cnyiotRequest.js`（唯一调用入口）、`meter.wrapper.js`、`price.wrapper.js`、`sync.wrapper.js`；`validators/meter.validator.js`、`price.validator.js`；`routes/meter.routes.js`、`price.routes.js`。请求先 Joi 校验再进 wrapper。
- **HTTP 路由：** `GET/POST/DELETE /api/cnyiot/meters`（列表、新增、删除）、`GET /api/cnyiot/meters/:meterId/status`、`POST /api/cnyiot/meters/:meterId/edit`、`POST /api/cnyiot/meters/:meterId/relay`、`POST /api/cnyiot/meters/:meterId/power-gate`、`POST /api/cnyiot/meters/:meterId/ratio`、`POST /api/cnyiot/meters/topup`、`POST /api/cnyiot/meters/topup/confirm`、`GET /api/cnyiot/meters/usage/records`、`GET /api/cnyiot/meters/usage/month-bill`、`GET /api/cnyiot/meters/usage/history`、`POST /api/cnyiot/meters/usage-summary`、`POST /api/cnyiot/meters/update-name-rate`、`POST /api/cnyiot/meters/sync`；`GET/POST /api/cnyiot/prices`。client 由 clientresolver 解析，`req.client.id` 即 clientId。Tel 从 `client_profile.contact` 取（纯数字）。
- **程序调用：** `cnyiot.meter.getMeters(clientId)`、`cnyiot.price.getPrices(clientId)`、`cnyiot.user.getUsers(clientId)`、`cnyiot.cnyiotSubuser.ensureClientCnyiotSubuser(clientId)`（为 client 建子账号，uI=subdomain，默认密码 0123456789，写 client_integration）；addMeters 时若已有 cnyiot_subuser_id 会带 UserID 并 link2User，电表自动进该 client 的 group。
- **子账号与 subdomain：** subdomain 取自 client_profile（或 operatordetail），**小写、全库唯一**（迁移 0028）；子账号登入名/密码/id 存 client_integration（cnyiot_subuser_login、cnyiot_subuser_password、cnyiot_subuser_id）；改密须写回 client_integration。`POST /api/cnyiot/users/ensure-subuser`、`PUT /api/cnyiot/users/subuser-password`。
- **与官方文档对照：** [docs/cnyiot-api-doc-mapping.md](../cnyiot-api-doc-mapping.md)（URL 为 `/api.ashx`、Method 与错误码对照）。

### Meter Top-up / Clear kWh / Sync（Portal 行为约定）

- **Top-up（operator 或 tenant 支付后）**：**prepaid 且充值后余额 > 0** 时 **Active ON + setRelay Val=2 通电**（含平台账号重试）；余额仍 ≤0 则关闸逻辑由 status=0 / `updateMeterStatus(false)` 处理。
  - **后端**：CNYIOT `sellByApi` + `sellByApiOk` → 更新 DB `balance` → `connectRelayAfterPrepaidTopupIfHasBalance`（或 postpaid 仍 `updateMeterStatus(true)`）。
- **Clear kWh（operator）**（仅 prepaid）：目标 **balance=0**，且 **Active=false**（断电/关闸）。
  - **后端**：CNYIOT `clearKwh` → **立即更新 DB** `meterdetail.balance=0` 与 `meterdetail.status=0` → 下发 `setRelay Val=1`（Active OFF）。
- **Sync Meter（手动同步）**：CNYIOT 可能返回 `s=6 / 等待下发`（指令未落地）。
  - **约定**：只有 `s=3`（在线通电）或 `s=4`（在线断电）时，sync 才用设备数据覆盖 `balance/status`；否则保留 DB（portal 刚写入的 balance/status），避免 topup/clear 被中间态覆盖。
  - **Prepaid + 合并后余额 ≤0**：强制 `status=0` 并 `setRelay` 断电；解决「Active ON 但余额 0」与表计读数一致后的关闸。
- **Meter Active 与 Room 无关**：电表 Active（ON/OFF）只控制该表的继电器（通电/断电），**不影响** room 是否可租。房间可租由 tenancy 决定（available/availablesoon/availablefrom）；meter 断电 ≠ 房间不可租。
- **与 `roomdetail.active` 无联动**：电表接口**不会**改 Room Setting 的 Active；允许「房间仍 Active、电表断电」。

---

## SaaS 户口与租客

- **总户口 / 子户口 / 租客** 对应关系、Client 是否我们的 tenant、多电表管理、创建户口在 docs 中的位置、租客支付后充值流程：[saas-account-model-and-cnyiot.md](../saas-account-model-and-cnyiot.md)。

---

## Stripe 支付封装（SaaS）

- **三种场景：**（1）**Client 充值 credit** — 平台 Payment Intent，webhook 成功后写入 `client_credit`。（2）**Tenant 付租金** — Stripe Connect；款项先入平台，按 client credit 是否足够 1% 决定是否 release 到 client 的 Connect 账户。（3）**Tenant Dashboard 付发票 / Meter 充值** — #buttonpaynow（发票，最多 10 笔）或 #buttontopupmeter（Meter）；`POST /api/tenantdashboard/create-payment` 创建 Checkout；metadata 带 `amount_cents`、`invoice_ids` 或 `meter_transaction_id`（Meter 先 INSERT metertransaction）；webhook 校验 paid 且金额一致后 UPDATE **rentalcollection** 或 **metertransaction**。description = tenant name + type + room name。
- **环境变量：** `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`；Live/Sandbox 双套与 `client_profile.stripe_sandbox`（迁移 0060）见 [stripe.md](../stripe.md)。
- **目录：** `src/modules/stripe/`（stripe.service.js、stripe.routes.js）；Tenant 支付入口在 `src/modules/tenantdashboard/`（create-payment）。
- **完整说明：** [docs/stripe.md](../stripe.md)。

### Payment gateway 與 payment method 設定責任

- **Payment gateway（選 Stripe 或 Xendit）：** 由 **operator** 在 **Portal → Company → Integrations（Payment）** 設定；一間公司只能選一個。Tenant 付款會跟隨該 operator 自己連接的 payment system。
- **Payment methods（接受銀行轉帳、信用卡、FPX、PayNow、GrabPay 等）：** 由 **operator 在自家 payment provider 後台** 設定，**不是** SaaS 設定。Stripe → **Stripe Dashboard**（Settings → Payment methods）開關；Xendit → **Xendit Dashboard** 啟用/申請各渠道。平台發起收款時依該 operator 帳號在 provider 的設定決定可用方式。

### Payment gateway 模式（2026-03）

- **統一原則：** `Stripe` 目前是 **Connect Standard**；`Xendit` 是 **direct**；`Billplz` 是 **direct**。
- **Tenant payment 原則：** 租客付款應盡量直接走到 operator 自己的 gateway account；SaaS 不應偷偷把 tenant payment 改走平台帳號。
- **secret 存法：** 仍落在 `client_integration` 的 `paymentGateway` row，但敏感值改為 **AES-GCM 加密字串**（如 `stripe_secret_key_enc`、`stripe_webhook_secret_enc`、`xendit_secret_key_enc`、`xendit_webhook_token_enc`），只回傳 last4，不回傳明文。
- **Stripe 補充：** 目前仍走 **Stripe Connect Standard OAuth**。完成 OAuth 後，會把 `stripe_account_id` 與 OAuth token（若 Stripe 回傳）一併加密保存；tenant 若要走 Stripe，必須使用該 operator 自己的 connected account。
- **Xendit 補充：** 目前走 **direct**。operator 自己提供 `secret key` 與 `X-CALLBACK-TOKEN`；tenant 付款直接走 operator 自己的 Xendit account。
- **Billplz 補充：** 規劃走 **direct**。operator 自己提供 API key / Collection ID / X Signature key。
- **雙重驗證狀態：** `no_connect` → 尚未填 secret；`pending_verification` → 已填 secret / webhook secret 但後端未收到 provider webhook；`connected` → webhook 簽名/回调 token 驗證成功，後端已收到至少 1 次有效事件。
- **Webhook 驗證：** `Stripe Connect Standard` 使用 **平台統一管理的 webhook**；operator 不需要自己配置 webhook secret。`Xendit direct` callback 會驗 `X-CALLBACK-TOKEN` 與 operator 存的 token。Stripe 平台 webhook 收到該 connected account 的有效事件後會自動把狀態更新成 `connected`。
- **Tenant 付款閘門：** `pending_verification` 不再等於完全不可付款。只要 operator 已填好可用 credentials + webhook secret/token，tenant 可付款；真正記帳改成 **API verify 為主、webhook 補確認**，而 gateway 是否正式 verified 仍看有沒有收過有效 webhook。
- **Stripe tenant 付款限制：** 已移除平台 Stripe fallback。Tenant 若要走 Stripe，該 operator 必須先完成自己的 Stripe Connect Standard 連接，並由後端用該 operator 自己的 connected account 建單；否則直接拒絕付款，不會再偷偷改走平台 Stripe。
- **成功回跳確認：** Stripe / Xendit tenant 付款成功回到 Portal 後，前端會立刻呼叫 `/api/tenantdashboard/confirm-payment`，後端直接向 provider API 查該筆付款狀態，若已成功就先把 invoice / meter payment 落帳，不再把 webhook 當唯一入口。
- **1% SaaS 與 credit：** 所有 payment provider 都應扣 **1% as credit**。`Stripe` 成功付款後會扣 `client_credit` 的 1%（credit 不足時掛 pending，top-up 後再處理）；`Xendit direct` 也會扣 `client_credit` 的 1%；`Billplz` 接入時同樣遵守這個規則。

---

## Profile 联动（Tenant / Owner / Staff）

- **一个 email 一份个人资料：** 在 **Tenant**（租客 Portal 改 profile）、**Owner**（业主 Portal 改 profile）、**Operator**（Company Setting 改某 Staff 姓名/银行）任一處更改姓名、電話、地址、NRIC、銀行等，後端都會經 **`updatePortalProfile`** 寫入 **portal_account** 並**同步**到 **tenantdetail**、**staffdetail**、**ownerdetail**（同 email 的列），故同一人不必填三次。
- **详细说明（谁改会同步、包含 portal、API 入口）：** [profile-sync-and-portal.md](../profile-sync-and-portal.md)。

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
- **Xero 关键行为补充（2026-03）**：Xero `Spend Money` 多数场景无公开 URL（UI 不应强制显示 Refund 链接）。Refund void / Back to Approved 时，Xero 回滚需走 `POST /BankTransactions/{BankTransactionID}` 并设置 `Status: "DELETED"`（对应 Xero 页面「Remove & Redo」）。

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
- **Accounting 仅对特定定价方案开放：** 只有当前 client 的**主方案**（`client_pricingplan_detail` 中 `type = 'plan'` 的 `plan_id`）在 **ACCOUNTING_PLAN_IDS** 内时，才允许连接 Accounting（Xero/Bukku/AutoCount/SQL）。ACCOUNTING_PLAN_IDS 定义在 `src/modules/access/access.service.js`，取值为表 **pricingplan** 的 **id**（默认为 `896357c8-1155-47de-9d3c-15055a4820aa`、`06af7357-f9c8-4319-98c3-b24e1fa7ae27`，可通过 `.env` 中的 `ACCOUNTING_PLAN_IDS`（逗号分隔）覆盖，例如加入 Elite 方案的 id）。Access 接口返回 `capability.accounting: true/false`，前端可按此隐藏或禁用「Accounting Connect」。
- **Integration template：** Accounting 下拉选项（Xero/Bukku/AutoCount/SQL Account）来自 ECS `getIntegrationTemplate()` 的 `addonAccount.provider` 字段；Company Setting 进入 Integration 时拉取并缓存 template，点击 Accounting Connect 时用 template 渲染选项。
- **Node 模块：** `src/modules/companysetting/`（companysetting.service.js、companysetting.routes.js）。路由挂载在 `app.js`：`/api/companysetting/*`（staff-list、staff-create、staff-update、integration-template、profile、profile-update、banks、admin、admin-save、stripe-connect-onboard、cnyiot-connect、bukku-connect、**autocount-connect**、**autocount-credentials**、**autocount-disconnect**、**sql-connect**、**sql-credentials**、**sql-disconnect**、xero-connect、xero-auth-url、xero-disconnect、ttlock-connect）。
- **JSW：** [velo-backend-saas-companysetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-companysetting.jsw.snippet.js) — 代理 access、staff、profile、banks、admin、getIntegrationTemplate、Stripe Connect / CNYIOT / Bukku / **AutoCount** / **SQL Account** / Xero / TTLock onboard。
- **getOnboardStatus 与 disconnect 后按钮刷新：** `getOnboardStatus` 仅查询 `client_integration.enabled = 1` 的行；disconnect 将对应行设为 enabled=0，故再次拉取得到 `accountingConnected: false`，前端 `refreshOnboardButtonLabels()` 会更新 #buttonaccountonboard 的 label 与颜色（恢复「Accounting Connect」及默认样式）。
- **#boxonboard 显示规则（#buttonaccountonboard / Accounting）：**  
  - **Bukku：** collapse #inputbookidonboard；显示 #inputuseronboard（Token）、#inputpasswordonboard（Subdomain）、#checkboxeinvoiceonboard。  
  - **AutoCount：** 显示 #inputuseronboard（API Key）、#inputpasswordonboard（Key ID）、#inputbookidonboard（Account Book ID）、#checkboxeinvoiceonboard。  
  - **Xero：** collapse #inputuseronboard、#inputpasswordonboard、#inputbookidonboard；只显示 #checkboxeinvoiceonboard。
- **Portal Next.js Company 页（/operator/company）Accounting：** System Integrations 中 **Connect** 弹窗（选 Bukku/Xero/AutoCount/SQL 后）与 **Manage** 弹窗（已连接时点击 Manage）均提供 **Enable E-Invoice** 勾选框；Manage 下勾选变化立即调用 `POST /api/companysetting/einvoice-update`（updateAccountingEinvoice）保存，无需重新连接。
- **数据对应：** pricing plan → client_pricingplan_detail；client credit → client_credit + creditlogs；integration → client_integration（Stripe Connect 用 client_profile.stripe_connected_account_id；addonAccount 支持 provider=bukku、xero、autocount、sql）；profile → client_profile + operatordetail；admin → operatordetail.admin（JSON）。

---

## Admin 页（admindashboard）

- **前端：** [docs/wix/frontend/admindashboard-page-full.js](../wix/frontend/admindashboard-page-full.js) — Sections：**topup**、**admin**（feedback+refund+待签 agreement）、**detail**、**property**（按物业+状态看租约）、**agreement**（单份 agreement 签名）。列表走 **backend/saas/admindashboard**（getAdminList、updateRefundDeposit、getTenancyList、getTenancyFilters、getAgreementForOperator、signAgreementOperator 等），数据来自 MySQL feedback + refunddeposit + agreement，不读 Wix CMS。
- **#buttonagreementlist** 点击打开 **#sectionproperty**（无 #buttonproperty）；**#repeateragreement** 已删除。**#repeatertenancy** 只显示与**当前 Staff** 相关的 tenancy：Booking 记 tenancy.submitby_id，Extend 记 tenancy.last_extended_by_id（migration 0077）；筛选条件 submitby_id = 当前 staff OR last_extended_by_id = 当前 staff。
- **#boxrefund**：含 #textrefund、**#inputrefundamount**（Refund amount，可编辑且只能 ≤ 原 amount；若改小则差额作 forfeit）、#buttonmarkasrefund（仅此时写 journal）。Daily Cron 会为「租约 end &lt; 今天且未续约、deposit&gt;0」自动写入 refunddeposit（0076 增加 refunddeposit.tenancy_id），Admin 可见并处理。
- **UI：** #buttonadmin 点击时 disable；#dropdownfilter 选项 All/Feedback/Refund/Agreement。无 item 时显示 #text50「You don't have refund item and feedback from tenant」。
- **详细说明与 API：** 见 [docs/index.md § Admin 页（admindashboard）](../index.md)、[admindashboard-sections-summary.md](../wix/frontend/admindashboard-sections-summary.md)。

---

## Smart Door Setting 页（门锁/网关与 child lock）

- **Portal Next.js Operator（推荐）：** `docs/nextjs-migration/app/operator/smart-door/page.tsx`，API `lib/operator-api.ts`。**Sync Lock（顶栏）**：弹窗 + `preview-selection` → 仅 **TTLock 有、本系统尚未入库** 的 lock/gateway；Save Selected → `insert-smartdoors`。**Refresh status（列表卡片）**：`sync-status-from-ttlock` → 刷新 **已在库** 锁（电量、`hasgateway`、可选 `gateway_id`）与网关（在线、lock 数、名称）。**TTLock `/v3/lock/list` 用 `hasGateway`（1/0）表示是否绑网关**，列表通常无 `gatewayId`；后端合并见 `smartdoorsetting.service.js`。锁行 UI：**Gateway** 绿标 / **No gateway**（不把锁当 Online/Offline）；网关行仍显示 Online/Offline。删除走 `delete-lock` / `delete-gateway`。
- **前端（Wix 历史）：** [docs/wix/frontend/smartdoorsetting-page-full.js](../wix/frontend/smartdoorsetting-page-full.js) — 门锁/网关列表、详情、更新、新增；child lock 配置（#repeaterchildsmartdoor / #dropdownchildsmartdoor）。数据全部走 ECS **smartdoorsetting**，不读 Wix CMS。
- **Child lock 选项：** 后端 `getChildLockOptions(excludeLockId)` 排除已用于 Property/Room 的锁，以及**已是其他门锁 child 的锁**（一个门锁只能当一个父锁的 child）；前端 repeater 用 `row._id` 识别行，删除中间行后选中值保留。
- **JSW：** [velo-backend-saas-smartdoorsetting.jsw.snippet.js](../wix/jsw/velo-backend-saas-smartdoorsetting.jsw.snippet.js)。**详细说明与 API：** 见 [docs/index.md § Smart Door Setting 页](../index.md)、[docs/index.md § TTLock API wrapper](../index.md)（锁列表 `hasGateway`）。

---

## Tenancy Setting 页（tenancysetting）

- **前端：** [docs/wix/frontend/tenancysetting-page-full.js](../wix/frontend/tenancysetting-page-full.js) — 租约列表（网格 + 分页 listview）、延租 / 换房 / 终止 / 取消预订、合约上传与系统生成；数据全部走 ECS，使用 **backend/saas/tenancysetting** JSW；不读 Wix CMS。门禁用 `backend/access/manage` 的 `getAccessContext()`；Topup 用 **backend/saas/topup**。
- **Sections：** default、tenancy、listview、extend、change、terminate、topup、agreement、uploadagreement。
- **UI 约定：** **#textstatusloading** 仅在页面 init 时 show「Loading...」，init 完成后 hide。**#text19** 用于所有点击后的 loading 与错误提示（点 Tenancy 进列表、延租/换房/终止/上传合约/生成合约 成功 hide、失败 show 错误文案；权限不足/余额不足也 show 在 #text19）。**关闭按钮** #buttontopupclose、#buttoncloseextend、#buttonclosechange、#buttoncloseagreement、#buttoncloseuploadagreement、#buttoncloseterminate 统一返回上一 section（`lastSectionBeforeAction`）。
- **Node 模块：** `src/modules/tenancysetting/`（tenancysetting.service.js、tenancysetting.routes.js）+ **`tenancy-active.service.js`**（TTLock：欠租 inactive、延租 active、**换房**删旧锁/新房 add、**终止**删密码、**日历到期** cron 删密码）。路由：`/api/tenancysetting/list`、`/filters`、`/rooms-for-change`、`/change-preview`、`/extend-options`、`/extend`、`/change`、`/terminate`、`/cancel-booking`、`/agreement-templates`、`/agreement-insert`；均需 body `email`。
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
- **数据对应：** admin 规则 → operatordetail.admin；房间 → roomdetail（available/availablesoon）；property 需有 owner（owner_id 或 owner_wixid）；租客 → tenantdetail + tenant_client（已批准）/approval_request_json（待批准）；车位 → parkinglot；创建订单 → 插入 tenancy，已批准租客时自动生成 rentalcollection（billing_json 中 bukkuid 由后端映射为 account.id），并锁定房间与车位。

---

## Owner Portal 页面（ECS 迁移）

- **前端：** [docs/wix/frontend/owner-portal-page-full.js](../wix/frontend/owner-portal-page-full.js) — 数据全部走 ECS，使用 `backend/saas/ownerportal` JSW；**不读 Wix CMS**。门禁用 `backend/access/manage` 的 `getAccessContext()`；合同详情弹窗用 `backend/access/agreementdetail`。默认 section 为 **#sectionownerportal**；onReady 时 **#repeaterclient** 先 hide，有数据才 show；主按钮先 disable、label「Loading...」，await 完成后 enable 并恢复 label。
- **上传（OSS）：** Profile 区 NRIC 使用 **HTML Embed**（#htmluploadbutton1、#htmluploadbutton2，431×52），同 [upload-oss-embed.html](../wix/frontend/upload-oss-embed.html)，JSW 提供 **getUploadCreds()**；打开 Profile 时 `initHtmlUploadProfile()` 发 INIT，上传成功后 `updateOwnerProfile({ nricFront/nricback: url })` 并刷新 #imagenric1/#imagenric2。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。**Next.js Owner Portal** 中 NRIC 正反面上传走 `POST /api/ownerportal/upload`（multipart form：file + email），后端 `uploadToOss` 存阿里云 OSS（路径 `owner-{ownerId}/`），返回 URL 写入 ownerdetail.nricfront / nricback。
- **Node 模块：** `src/modules/ownerportal/`（ownerportal.service.js、ownerportal.routes.js、ownerportal-pdf.js）。路由挂载在 `app.js`：`/api/ownerportal/*`（owner、load-cms-data、clients、banks、update-profile、**upload**、**rooms-with-locks**、owner-payout-list、cost-list、agreement-list、agreement-template、agreement-get、agreement-update-sign、complete-agreement-approval、merge-owner-multi-reference、remove-approval-pending、sync-owner-for-client、**export-report-pdf**、**export-cost-pdf**）。业主的 properties/clients 从 **关联表** owner_property、owner_client 读取（一业主多 property、多 client）；无关联表数据时 fallback 到 propertydetail.owner_id、ownerdetail 单列。
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

## Owner Portal（Next.js 业主门户）

- **入口与路由：** 同 Portal 站点 **portal.colivingjb.com**，业主路由 `/owner`（Dashboard、Profile、Report、Smart Door、Agreement 等）。代码在 `docs/nextjs-migration/app/owner/`。
- **Smart Access 选项逻辑：** 门锁可装在 property 大门或每个 room 门上。`getRoomsWithLocksForOwner` 返回：① 只有 property 大门有锁 → 1 option（Property A）；② 4 个 room 有锁、property 没有 → 4 options（Property A | Room A, ...）；③ property + 4 room 都有锁 → 5 options。itemId 为 `property:${propertyId}` 或 `room:${roomId}`；密码分别存 `owner_property_passcodes`、`owner_room_passcodes`。调试脚本：`node scripts/debug-smart-access-options.js owner@example.com`。
- **Owner Report / Payout：** 汇总卡片（Total Rental、Utility、Gross Collection、Expenses、Net Payout）金额用 `whitespace-nowrap` 防止换行；Utility/Expenses 用 `text-base` 以容纳较长数字。数据来自 `getOwnerPayoutList`。
- **Profile NRIC 上传：** 见上节 Owner Portal 上传（OSS）；Next 版用 `uploadFile` → `ownerportal/upload` → OSS → `updateOwnerProfile({ nricFront/nricback: url })`。

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
- **Next.js Tenant Portal（portal.colivingjb.com/tenant）：** 与 Wix Tenant Dashboard 功能对照、各 element 接線檢查（Init/Profile/Agreement/Payment/Meter/Feedback/Approval/Smart Door）见 [tenant-frontend-checklist-and-wix-comparison.md](../nextjs-migration/tenant-frontend-checklist-and-wix-comparison.md)。
- **上传（OSS）：** Feedback 图片/视频与 Profile NRIC 使用 **HTML Embed** 直传阿里云 OSS（不再用 Wix Upload Button）。嵌入组件：**#htmluploadbuttonfeedback**（449×34，feedback 区）、**#htmluploadbutton1**（431×52，NRIC 正面/护照）、**#htmluploadbutton2**（431×52，NRIC 背面）；HTML 源码 [upload-oss-embed.html](../wix/frontend/upload-oss-embed.html)，父页面 postMessage `INIT`（baseUrl、token、username、clientId、label、accept），上传成功后 iframe postMessage `UPLOAD_SUCCESS` 回传 url。JSW 提供 **getUploadCreds()** 供前端取鉴权。详见 [upload-oss-embed-usage.md](../wix/frontend/upload-oss-embed-usage.md)。
- **#buttonwhatsap：** 在 #sectionfeedback 内，点击后跳转 wasap.my（client 联系号码 + 租客名/房间名），用于租客联系房东。
- **支付：** **#buttonpaynow**（发票）— 勾选最多 **10 笔** rentalcollection，合计金额 + `metadata.invoiceIds` 调 `createTenantPayment` → Stripe Checkout（固定金额、description = tenant name + account.title + room name）；webhook 校验 paid 且金额一致后 **UPDATE rentalcollection**（paidat、referenceid、ispaid）。**#buttontopupmeter**（Meter）— 先在后端 **INSERT metertransaction**（pending），再带 `meter_transaction_id` 创建 Checkout；webhook 校验后 **UPDATE metertransaction**（ispaid、referenceid、status=success），并调 `handleTenantMeterPaymentSuccess` 写 rentalcollection。详见 [stripe.md](../stripe.md)、上节 Stripe 支付封装。
- **Node 模块：** `src/modules/tenantdashboard/`（tenantdashboard.service.js、tenantdashboard.routes.js）。路由：`/api/tenantdashboard/*`（init、clients-by-ids、room、property-with-smartdoor、banks、update-profile、agreement-html、agreement-update-sign、agreement-get、**rental-list**、tenant-approve、tenant-reject、generate-from-tenancy、sync-tenant-for-client、feedback、**create-payment**）。租客按 email（tenantdetail.email）解析，所有操作校验 tenancy 归属该租客。
- **数据与 repeater：** init 返回 tenant + tenancies（含 property、client、room、agreements，client 带 contact 供 WhatsApp）；Dashboard repeater 展示待批准（approval）与待签约（agreement）；电表、Pay Now、反馈、智能门、个人资料、合同签署、支付均走对应 API。Stripe 支付成功/取消跳转 `tenant-dashboard?success=1` / `tenant-dashboard?cancel=1`。
- **JSW：** [velo-backend-saas-tenantdashboard.jsw.snippet.js](../wix/jsw/velo-backend-saas-tenantdashboard.jsw.snippet.js) — 粘贴为 `backend/saas/tenantdashboard.jsw`；认证与 Base URL 同 ownerportal。export：init、**getUploadCreds**、getClientsByIds、getRoomWithMeter、getPropertyWithSmartdoor、getBanks、updateTenantProfile、getAgreementHtml、updateAgreementTenantSign、getAgreement、getRentalList、tenantApprove、tenantReject、syncTenantForClient、submitFeedback、**createTenantPayment** 等。
- **迁移：** feedback 表见 `0038_create_feedback.sql`。若表未建，submitFeedback 返回 FEEDBACK_TABLE_MISSING。

---

## Portal（Next.js 租客门户）

- **站点与入口：** **portal.colivingjb.com**（Next.js 16，PM2 进程 `portal-next`，port 3001）。路由：`/` 首页、`/login` 登入、`/register` 注册（仅 email + 密码）、`/signup` 注册入口、`/auth/callback` OAuth 回调、`/portal` 租客首页（需已登录）。
- **登入方式：** ① **Email + 密码**：`POST {ECS_BASE}/api/portal-auth/login`，成功则 setMember 并跳 `/portal`。② **Google / Facebook**：**同一标签页**跳转 `{ECS_BASE}/api/portal-auth/google?frontend=<portal 来源>`（或 facebook），选账号后回到 **`/auth/callback?token=...`**（主窗口，非弹窗），verify 后 setMember 并 `replace` 到 `/portal`。弹窗方案已弃用（重定向后易丢失 `window.opener`，导致门户只出现在小窗内）。
- **注册：** 仅 **email + 密码 + 确认密码**，无银行/证件；`POST {ECS_BASE}/api/portal-auth/register`。邮箱须已在 tenantdetail / staffdetail / ownerdetail / operatordetail 中才可注册；表 `portal_account` 存密码哈希。
- **后端 API：** `src/modules/portal-auth/`（portal-auth.routes.js、portal-auth.service.js、passport-strategies）。路由：`POST /api/portal-auth/register`、`POST /api/portal-auth/login`、`GET /api/portal-auth/verify?token=...`、`GET/PUT /api/portal-auth/profile`（需 Bearer token）、`POST /api/portal-auth/forgot-password`、`POST /api/portal-auth/reset-password`、Google/Facebook OAuth 等。环境变量：`PORTAL_FRONTEND_URL`、`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`、`FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET`。
- **会员资料同步（一个 email 一份）：** 会员资料以 **portal_account** 为准（表含 fullname、phone、address、nric、bank*）。在 **Tenant**（Portal 或 Wix 租客 profile）、**Owner**（Owner Portal 更新 profile）、**Operator**（Company Setting 更新 staff）任一處更改上述欄位，都會經 `updatePortalProfile` 寫入 portal_account 並**同步**到 tenantdetail、staffdetail、ownerdetail（同 email 的列），故同一人不必填三次。
- **更换 email 需驗證：** 租客在 Tenant Dashboard 申請更換 email 時，後端 `requestEmailChange` 發送驗證碼到**新 email**；用戶在 `confirmEmailChange` 輸入正確 code 後，會更新 **tenantdetail**、**portal_account**、**staffdetail**、**ownerdetail** 中該舊 email 的列為新 email，確保一個 user 處處一致。
- **Forgot password（已完成）：** `POST /api/portal-auth/forgot-password`（body: `{ email }`）若該 email 在 portal_account 則寫入 **portal_password_reset**（6 位 code、expires_at **30 分鐘**；每次重發會更新 code 與過期時間，以 MySQL `DATE_ADD(NOW(), INTERVAL 30 MINUTE)` 為準）。`portal-password-reset-sender.sendPasswordResetCode(email, code)`：**已配置 SMTP** 時發送真實郵件，未配置時僅打 log。要發信需在 ECS 設定 SMTP 與發件人，見 [portal-password-reset-email.md](../portal-password-reset-email.md)。用戶在 **/reset-password** 頁輸入 email、code、新密碼後呼叫 `POST /api/portal-auth/reset-password` 完成重設。Migration：`0086_portal_password_reset.sql`。
- **CORS 与 Nginx：** 从 portal 域名请求 api.colivingjb.com 会发 **OPTIONS** preflight；若 Node 日志无 `[CORS debug]`，表示 OPTIONS 未进 Node。需在 **api.colivingjb.com** 的 Nginx 中为 `location /api/` 对 OPTIONS 回 204 + CORS 头（或转给 Node），POST/GET 转 `http://127.0.0.1:3000`。详见 [nginx-api-portal-auth-cors.md](../nginx-api-portal-auth-cors.md)。
- **Portal 的 /api 必須進 Next.js：** 租客在 portal 的 Change PIN、Remote Unlock 等會打 `portal.colivingjb.com/api/portal/proxy/...`。若 Nginx 把 portal 的 `/api/*` 轉到 Node (3000)，會回 404 HTML，導致「Unexpected token '<'」錯誤。portal 的**所有請求**（含 `/api/*`）應轉到 Next.js (3001)。詳見 [nginx-portal-proxy.md](../nginx-portal-proxy.md)。
- **部署与重启：** 改 **Node 后端** 后执行 `pm2 restart app`。改 **Next 前端**（`docs/nextjs-migration/` 下代码）后须先构建再重启：`cd docs/nextjs-migration && npm run build && pm2 restart portal-next`（无 pnpm 时用 `npm run build`）；否则会出现 chunk 404（浏览器拿到新 HTML 但进程仍提供旧 build）。
- **Agreement Preview PDF：** Operator 在 **Agreement Setting**（/operator/agreement-setting）保存模板（Google Doc + Drive folder）后，后端用 **Node + Google Docs/Drive API** 异步生成 PDF 并上传 OSS，写入 `agreementtemplate.preview_pdf_oss_url`。点 Preview 时后端只从 **OSS** 流式返回 PDF（`POST /api/agreementsetting/preview-pdf-download`）。删 Drive folder 里的预览文件不会立刻影响 Portal 预览（Portal 用 OSS）。详见 [agreement-template-preview-node.md](../agreement-template-preview-node.md) 与 [index.md](../index.md) 的「Agreement Setting 页」节。
- **本地绑定 Next + Node：** 端口约定（Node `server.js` 5000、Next 3001/ dev 3000）、环境变量（`ECS_BASE_URL`、`NEXT_PUBLIC_USE_PROXY`、`FORCE_LOCAL_BACKEND`）及同机/生产部署说明见 [nextjs-migration/NEXT-NODE-BINDING.md](../nextjs-migration/NEXT-NODE-BINDING.md)。

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
| **billing/completepayment.jsw** | `completePricingPlanPayment({ pricingplanlogId, payexData, status, failReason })` | 定价方案支付完成：读 pricingplanlogs/operatordetail/pricingplan，幂等（已 paid 返回 duplicated），失败则更新 log 为 failed；成功则更新 operatordetail（pricingplandetail、expired）、标记 log paid、调 completetopup 加 CORE credit、扣 addon prorate、清 cache。支持 Payex / Stripe（reference_number、payment_intent 等）。 |
| **billing/completetopup.jsw** | `completePricingPlanTopup({ pricingplanlogId, payexData, txnId, expiredDate })` | 定价方案 CORE 到账：需 log 已 paid、写 creditlogs、更新 operatordetail.credit（applyCoreCredit），若有 addon 扣减则调 deductPricingPlanAddonCredit。 |
| **billing/completetopup.jsw** | `completeNormalTopup({ creditlogId, status, payexData, failReason })` | 普通充值 FLEX 到账：读 creditlogs，失败则更新 log；成功则 applyFlexCredit 更新 operatordetail.credit、标记 log isPaid、清 cache。 |
| **backend/billing/manualrenew.jsw** | `manualRenew({ clientId, planId, paidDate })` | 手动续费：需 admin 或 billing 权限；插 pricingplanlogs（scenario: MANUAL, status: paid），再调 `completePricingPlanPayment` 走完整完成流程。 |
| **backend/billing/manualtopup.jsw** | `manualTopup({ clientId, amount, paidDate })` | 手动充值：需 admin 或 billing 权限；插 creditlogs（isPaid: true），再调 `completeNormalTopup` 加 FLEX credit。 |

### Integration（模板 / 门锁 / 电表 / 智能门）

| JSW 文件 | 导出函数 | 说明 |
|----------|----------|------|
| **backend/integration/integrationtemplate.jsw** | `getIntegrationTemplate()` | 返回集成配置模板数组：paymentGateway（stripe/payex）、meter（cnyiot）、smartDoor（ttlock）、addonAccount（bukku/xero）等，每项含 key、title、version、providers、fields。 |
| **backend/integration/lockselection.jsw** | `previewSmartDoorSelection(clientId)` | **Node 等价：** `smartdoorsetting.previewSmartDoorSelection` — 仅把 TTLock 有、**MySQL 尚无**的 lock/gateway 放进预览列表；**不**在预览流程写回已在库行。**已在库**刷新：`sync-status-from-ttlock`（电量、`hasGateway`、网关在线等）。Wix 旧描述若写「已存在则同步」以 Node 为准。 |
| **backend/integration/lockselection.jsw** | `syncTTLockName({ clientId, type, externalId, name })` | 同步 TTLock 名称：type 为 lock 或 gateway，调 ttlock 重命名 API。 |
| **backend/integration/metersetting.jsw** | `getMeterDropdownOptions({ clientId, roomId })` | 电表下拉：client 下启用中的 meterdetail，排除已被 Property 占用的、仅当前 room 可回显已占用的，返回 `{ label, value }`。 |
| **backend/integration/metersetting.jsw** | `updateRoomMeter({ clientId, roomId, meterId })` | 房间↔电表绑定：meterId 为空则解绑；否则双向写 meterdetail.room/property 与 RoomDetail.meter；旧 meter 若只绑该 room 则清空。 |
| **backend/integration/metersetting.jsw** | `getActiveMeterProvidersByClient(clientId)` | 按 client 从 operatordetail.integration 取 key=meter、enabled 的 provider 列表（含 slot）。 |
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
