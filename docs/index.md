# Docs index

## 近期更新 Summary（Portal 登入/OAuth / System Integration / CNYIoT 平台主账号 / 门控 / 门禁与 sectiontab）

- **Portal — Alibaba eKYC（护照 / MyKad）、Gov ID 状态与 `portal_account` 迁移（2026-04）：**
  - **库表：** `0266_portal_account_aliyun_ekyc_locked.sql`（`aliyun_ekyc_locked`）、`0267_portal_account_passport_expiry_date.sql`（`passport_expiry_date`，护照 OCR 到期日）；**建议**已跑 **`0263`**（`phone_verified`）。若库中**尚无 `phone_verified`**，旧逻辑在 `getPortalProfile` 单条 SELECT 失败时会落入极简备用查询，**读不到 `passport_expiry_date`**（界面一直显示「Expiry —」）；**已修复**：`portal-auth.service.js` **`getPortalProfile`** 按序尝试多条 SELECT（例如用 **`0 AS phone_verified`** 代替缺失列），仍返回 **`passport_expiry_date`**、**`aliyun_ekyc_locked`**、Gov 列等。
  - **后端：** `src/services/aliyun-idverify.service.js` — `POST /api/access/aliyun-idv/start`、`POST /api/access/aliyun-idv/result`；成功回调 **`applyAliyunEkycToPortalAccount`**（`portal-auth.service.js`）写入姓名/证件/护照到期、**`aliyun_ekyc_locked=1`**；护照到期 OCR 支持更多字段名、**`YYYYMMDD`**、树形 JSON **兜底解析**。**`gov-id.service.js`** — `getGovIdStatus` 返回 **`aliyunEkycLocked`**（供前端与 `identityLocked` 一致）。
  - **前端（Coliving Next）：** `unified-profile-page.tsx`、`unified-profile-portal-api.ts` — Verification Status **绿钮**与 **Singpass/MyDigital/文档 eKYC** 状态对齐；**`fetchGovIdStatus`** 合并 **`aliyunEkycLocked`**；护照到期展示 **`passport_expiry_date`**。
  - **运维：** `node scripts/reset-portal-account-ekyc.js <portal_account_uuid>` — 清空 Aliyun eKYC 填充与锁定（**不**解除 Singpass/MyDigital）。

- **Coliving Portal — 进入 Tenant / Owner 时 ensure 业务主档（2026-04）：**
  - **问题背景：** 会员资料在 **`portal_account`**（`GET/PUT /api/portal-auth/profile`）可已填齐，但 **`/api/ownerportal/owner`** 只认 **`ownerdetail`** 行；若无行，`OwnerProfileGate` 会把用户留在 `/owner/profile`。登录成功时后端仍会异步 **`ensureColivingTenantdetail` + `ensureColivingOwnerdetail`**（`portal-detail-ensure.service.js`），若登录路径未触发或仅写 portal 表，可能仍缺行。
  - **新增 API：** **`POST /api/portal-auth/coliving-ensure-detail`**（**`Authorization: Bearer <portal JWT>`**），body：`{ "role": "tenant" }` 或 `{ "role": "owner" }`。内部按 `portal_account.id` 调用 **`ensureColivingTenantdetail`** 或 **`ensureColivingOwnerdetail`**（幂等）。实现：`ensureColivingDetailForPortalEmail`（`src/modules/portal-auth/portal-detail-ensure.service.js`），路由：`src/modules/portal-auth/portal-auth.routes.js`。
  - **前端：** Coliving Next（`docs/nextjs-migration`）**`owner-layout-client.tsx`** / **`tenant-layout-client.tsx`** 在挂载 **`OwnerProvider` / `TenantProvider`** 前先调用 **`ensureColivingPortalDetail('owner'|'tenant')`**（`lib/unified-profile-portal-api.ts`）。**demo.colivingjb.com** 无真实 API 基址时为 no-op。
  - **对照 Cleanlemons：** 员工进 **`/employee`** 等由 **`POST /api/portal-auth/cleanlemons-ensure-employee`** upsert **`cln_employeedetail`**；B2B **`cln_clientdetail`** 仍在登录 ensure 中处理。详见 [readme/index.md](./readme/index.md)「Coliving Portal — tenantdetail / ownerdetail」。

- **Coliving `propertydetail` ↔ Cleanlemons `cln_property`（2026-04）：**
  - **数据主从**：`propertydetail`（Coliving operator）为多数共享字段的主源；**清洁价格、部分照片等**仍以 Cleanlemons / B2B 侧与 `cln_property` 为准；**不向** Cleanlemons operator 写回覆盖 `propertydetail`。
  - **库表**：migration **`0225_propertydetail_premises_security.sql`** — `propertydetail.premises_type`、`propertydetail.security_system`（可空）。`premises_type` 取值：`landed` | `apartment` | `other` | `office` | `commercial`（与 `cln_property.premises_type` 词汇一致）。
  - **后端**：`src/modules/coliving-cleanlemons/coliving-cleanlemons-link.service.js` — `maybeSyncPropertydetailToCleanlemons`（内部 `upsertSyncedClnProperty`、`mirrorPropertydetailToClnRows`；需 client 已配置 Cleanlemons 集成且 `export_property_enabled` 未关闭等）。**`propertysetting.service.js`**：成功执行 `updateProperty`、`insertProperties`、`setPropertyActive`、`setPropertyArchived` 后 `try/catch` 调用同步（失败只打日志）。**`roomsetting.service.js`**：`updateRoom`、`insertRooms` 后按涉及 `property_id` 去重并同步。
  - **`insertProperties`（`POST /api/propertysetting/insert`）**：每条 `items[]` 除 `unitNumber`、`apartmentName`、`country`、`ownerSettlementModel`、百分比/固定租等外，可选 **`shortname`**（有值则写入 `shortname`；否则默认「规范化楼盘名 + 单位」）、**`address`**（有值则在插入成功后 `UPDATE propertydetail.address`）。仍写入 **`premisesType`** / **`securitySystem`**（与编辑一致）。
  - **Portal（Coliving Next）**：`docs/nextjs-migration/app/operator/property/page.tsx` — **Edit / Add Property** 弹窗分块：**Property details**（**Property type** 置顶；Short name、Apartment/Building、Unit、Address；「Add new building」时 **Country** 只读，随 operator 币种 **MY/SG**）、**Owner**（含 View profile）、**Access**（钥匙领取勾选与密码、`security_system` icare/ecommunity；**Other** 时显示床位/房型）、**Owner settlement**（及 Drive folder 等）。已移除重复的「Binding client」「Property address」字段（地址仅 **Address** 一处）。**Add Property** 表单含 Short name、Address，与后端 `insert` 对齐。旧版仅适用于 Cleanlemons 的清洁类 UI 已不在此页；清洁价等仍由 Cleanlemons 维护。

- **Coliving ↔ Cleanlemons 租户清洁与排程（2026-04）：**
  - **库表**：migration **`0226_cleaning_tenant_price_and_account.sql`** — `propertydetail.cleanlemons_cleaning_tenant_price_myr`、`roomdetail.cleanlemons_cleaning_tenant_price_myr`（房间可覆盖物业）；`account` 插入 Coliving 清洁科目（Cleaning Services，供 `rentalcollection` 开票）。
  - **后端**：`src/modules/coliving-cleanlemons/coliving-cleanlemons-cleaning.service.js`（从 `cln_property` 取参考价、`scheduleColivingCleaningJob`、`getTenantCleaningPriceForTenancy`、`createTenantCleaningOrder`）；`propertysetting.routes.js` — `POST .../cleanlemons-cleaning/pricing`、`.../schedule`；`tenantdashboard` — `POST .../cleaning-order`；`cleanlemon.service.js` — `general-cleaning` / **`room-rental-cleaning`**，`working_day` / `start_time` 使用 **马来西亚墙钟** 字符串。
  - **Portal（Coliving Next）**：Operator **Property** 卡片菜单 **Schedule cleaning**（general-cleaning）与 **Edit utility** 内 **Cleanlemons — General cleaning**（参考价 + tenant price）；**Room**（`/operator/room`）编辑内 **Cleanlemons — Room rental cleaning** + 排程；Tenant **`/tenant/cleaning`**（侧栏在 `hasCleaningOrder` 时显示），`tenant-api.ts` → `tenantdashboard/cleaning-order`。

- **Cleanlemons Employee Tasks — 成组 Start/End 与远程开门（2026-04）：**
  - **前端**：`cleanlemon/next-app/app/portal/employee/task/page.tsx` — 日期与「今日完成度」按 **马来西亚时间（MYT）**；拉取任务时带 **`GET /api/cleanlemon/operator/schedule-jobs?operatorId=`**（与 header 中 `localStorage.cleanlemons_employee_operator_id` 一致）。同一 **`coliving_propertydetail_id`**、同一 **`jobDate`**、且 **≥2** 条任务时显示 **Group start**（子集须全部为 **Ready to Clean**）/ **Group end**（子集须全部为 **In Progress**，**整组共享**照片与备注，事务内各 job 写入相同 `start_time` / `end_time`）。**Open Door**：按 Coliving **`propertydetail` / `roomdetail` 的 `smartdoor_id`** 解析 `lockdetail`；无锁则提示；**一把锁**直接调解锁；**多把**（如物业门 + 房门）弹窗单选后解锁。
  - **可见性**：若 `submit_by` 等字段与当前登录用户 email/姓名可匹配，则优先只显示匹配任务；否则退回显示该 operator 下全部任务（与 employee layout 推断 team 的思路一致）。
  - **排班列表扩展字段**：`listOperatorScheduleJobs` 返回的 `items[]` 增加 **`colivingPropertydetailId`**、**`colivingRoomdetailId`**、**`clnOperatorId`**、**`clnClientdetailId`**（依赖 `cln_property` 上 Coliving 关联列，如 migration **0219**）。
  - **员工专用 API**（须 **`Authorization: Bearer <portal JWT>`**，且 **`assertClnOperatorStaffEmail(operatorId, email)`**）：
    - `POST /api/cleanlemon/employee/schedule-jobs/group-start` — body：`operatorId`, `jobIds[]`（≥2）, `estimateCompleteAt?`, `estimatePhotoCount?`；校验同运营商、同 `coliving_propertydetail_id`、同 `working_day` 日期、状态均为 ready-to-clean。
    - `POST /api/cleanlemon/employee/schedule-jobs/group-end` — body：`operatorId`, `jobIds[]`, `photos[]`, `remark?`；同上分组键，状态均为 in-progress。
    - `POST /api/cleanlemon/employee/task/unlock-targets` — body：`operatorId`, `jobId` → `{ targets: [{ lockDetailId, label, role, scopeKind }] }`。
    - `POST /api/cleanlemon/employee/task/unlock` — body：`operatorId`, `jobId`, `lockDetailId`；内部 **`smartdoorsetting.remoteUnlockLock`**（**Coliving `client_id` / Cleanlemons `cln_client` / `cln_operator`** 按锁行解析）。
  - **实现**：`src/modules/cleanlemon/cleanlemon.service.js`、`cleanlemon.routes.js`；前端封装 **`cleanlemon/next-app/lib/cleanlemon-api.ts`**（`postEmployeeScheduleGroupStart`、`postEmployeeScheduleGroupEnd`、`postEmployeeTaskUnlockTargets`、`postEmployeeTaskUnlock`）。

- **Cleanlemons Property 归属模型（2026-03，已执行）：**
  - `cln_property.clientdetail_id`（FK → `cln_clientdetail.id`）：property 实际归属客户。
  - `cln_property.operator_id`（FK → `cln_operatordetail.id`）：哪个 operator 可见/管理该 property。
  - 业务规则：**一个 property 仅可由一个 operator 管理**（单行单 `operator_id`）。
  - 兼容字段：`cln_property.client_id` 继续保留给旧流程；新逻辑优先使用 `clientdetail_id / operator_id`。
  - migration：`src/db/migrations/0210_cln_property_clientdetail_operator_model.sql`（含回填：`cc_json.wixClientReference` → `clientdetail_id`）。

- **cleanlemons / Operator Pricing + Calender（Next.js）：**
  - `cleanlemon/next-app/app/portal/operator/pricing/page.tsx` 已落地为「Services Provider + Booking Setting + Pricing Setting」三段式结构。
  - Pricing Setting 依勾选服务动态生成 tab（General/Deep/Renovation/Homestay/Room Rental/Commercial/Office/Dobi）。
  - 各服务支持独立 section mode 与 detail dialog；Dobi 的 by kg / by pcs / by bed 分开弹窗，by kg / by pcs 均含 Dobi Services + Ironing 且可 Add Item。
  - `cleanlemon/next-app/app/portal/operator/calender/page.tsx` 保留大日历定价调整视图（颜色 badge、点击 badge 编辑、adjustment list）。
  - `cleanlemon/next-app/app/portal/operator/layout.tsx` 已加入侧栏 `Calender`：`/operator/calender`。
  - `cleanlemon/next-app/app/portal/operator/team/page.tsx` 已加入右上角 tab：`Team List` / `Calendar`；Calendar 采用大月历视图并显示 team rest badge。badge 颜色按 team 固定映射（同一 team 跨日期同色）。
  - Team 成员规则：**一个 staff 只允许属于一个 team**。在 Add Member 弹窗中，已归属其他 team 的 staff 会禁用并提示 `Already in <Team Name>`；提交保存时也会二次校验并阻止重复归属。
  - **Cleanlemons 线上端口与 chunk 404 排查（2026-03-27 记录）：** `next-cleanlemons` 在 PM2 使用 `npm start -- -p 3100`（`exec cwd=/home/ecs-user/app/cleanlemon/next-app`）；`next-coliving` 使用 `3001`；API 分别在 `5000/5001`。`portal.cleanlemons.com` 的 Nginx `location /` 应指向 `127.0.0.1:3100`，`location /api/` 指向 `127.0.0.1:5001`。若浏览器出现 `/_next/static/chunks/*.css|*.js 404`，先用 `curl -I http://127.0.0.1:3100/_next/static/chunks/<hash>.css` 与 `curl -I https://portal.cleanlemons.com/_next/static/chunks/<hash>.css` 对比，再从线上 HTML 抓当前 chunk（`curl -s https://portal.cleanlemons.com/ | grep -oE '/_next/static/chunks/[^"]+\\.(css|js)'`）确认是否旧缓存 hash；本次结论为服务端正常，404 来自旧缓存/旧 hash 请求。

- **Portal（Next.js 租客门户）：** 注册（仅 email+密码）、登录（email+密码 或 Google/Facebook **同页跳转 OAuth**，回 `/auth/callback` 再进 `/portal`）；**会员资料** 一个 email 一份，存 portal_account，在 Tenant/Owner/Operator 任一處改 profile 會同步到 portal 與三張 detail 表；**更换 email** 需 verify（requestEmailChange → 發碼到新 email，confirmEmailChange 更新 tenantdetail + portal_account + staffdetail + ownerdetail）；**Forgot password（已完成）**：/forgot-password 發 6 位驗證碼到顧客 email（表 portal_password_reset，migration 0086），code 有效期 30 分鐘、每次重發會更新 code 與過期時間；/reset-password 輸入 email + code + 新密碼完成重設。發信需在 ECS 配置 SMTP（見 [portal-password-reset-email.md](./portal-password-reset-email.md)），未配置時 code 僅打 log。后端 `src/modules/portal-auth/`，Nginx 需对 api 的 `/api/` OPTIONS 回 CORS（见 [nginx-api-portal-auth-cors.md](./nginx-api-portal-auth-cors.md)）；改前端须 `npm run build` 后 `pm2 restart portal-next`。详见 [readme/index.md](./readme/index.md)#portalnextjs-租客门户。
- **Portal 个人资料页（Coliving Next 与 Cleanlemons 同一套 UI，2026-03）：** Coliving（`docs/nextjs-migration`）的 **Tenant / Owner / Operator** 个人资料路由（`/tenant/profile`、`/owner/profile`、`/operator/profile`）共用组件 **`components/shared/unified-profile-page.tsx`**，与 Cleanlemons `cleanlemon/next-app/components/shared/unified-profile-page.tsx` 布局与字段一致；数据经 **`GET/PUT /api/portal-auth/profile`**（`Authorization: Bearer <portal JWT>`）读写 `portal_account` 并触发既有 `updatePortalProfile` 同步。浏览器在 **`localStorage` 键 `portal_jwt`** 存短期 JWT：OAuth `/auth/callback?token=` 验证成功后写入；**密码登录** `POST /api/portal-auth/login` 成功响应体含 **`token`**（`portal-auth.service.js`）。Next 代理 **`/api/portal/proxy/*`** 已支持 **`GET`/`PUT`** 转发 `portal-auth/*`（用户 JWT 从请求头透传，见 `app/api/portal/proxy/[...path]/route.ts`）。前端封装见 **`lib/unified-profile-portal-api.ts`**；头像/NRIC 上传按角色分别走 `tenantdashboard/upload`、`ownerportal/upload`、`POST .../upload`（operator 需 `clientId`）。**demo.colivingjb.com** 仍走本地 mock / `localStorage`（`shouldUseDemoMock()`）。详细索引见 [readme/index.md](./readme/index.md) 章节「Portal 个人资料统一页（Coliving / Cleanlemons）」。
- **System Integration（Meter / Smart Door）：** ① **Meter (CNYIOT)**：**用量 / 抄表 / 充值** 一律用 **平台主账号**（env `CNYIOT_LOGIN_NAME`、`CNYIOT_LOGIN_PSW`）；**client 不需要绑定 CNYIoT** 即可使用租客电表、用量、充值等功能。创建子账号（若需）时 contact 与 subdomain 从 client_profile 取；Edit Meter、Connect to old account 等见 [readme/index.md](./readme/index.md)#cnyiot-api-wrapper。**Base URL**：直连官方 API，仅可通过 env **`CNYIOT_BASE_URL`** 覆盖（已移除 `CNYIOT_PROXY_BASE`）。前端：Portal Next.js（Company / System Integrations）；后端：`meter.wrapper.js`（getUsageSummary、getMeterStatus、createPendingTopup、confirmTopup 等均 `usePlatformAccount: true`）。② **Operator Smart Door（Portal `/operator/smart-door`）：** 顶部 **Sync Lock** 打开弹窗 → 调 `preview-selection`：仅列出 TTLock 里**尚未入库**的 lock/gateway，勾选 **Save Selected** 写入；**不写回**已在表内的锁/网关状态。列表卡片 **Refresh status** → `POST /api/smartdoorsetting/sync-status-from-ttlock`：从 TTLock **刷新已在库**数据——锁：`lockalias`、`electricquantity`、`hasgateway`、`gateway_id`；网关：`gatewayname`、`isonline`、`locknum`、`networkname`。**TTLock Open API `GET /v3/lock/list` 返回 `hasGateway`（1=已绑网关、0=否），列表响应不含 `gatewayId`**；后端用 `hasGateway` 写 `lockdetail.hasgateway`（见 `smartdoorsetting.service.js` 中 `ttlockListItemHasGateway`），有 `gatewayId` 时再解析 `gateway_id` FK。兼容别名 `sync-locks-from-ttlock`（deprecated）= 同上。锁列表 UI：**Gateway** 绿标 / **No gateway**（不按 Online/Offline 展示锁）；网关行仍显示 Online/Offline。删除：`POST .../delete-lock`、`.../delete-gateway`。代码：`docs/nextjs-migration/app/operator/smart-door/page.tsx`、`lib/operator-api.ts`；`src/modules/smartdoorsetting/`。
- **Generate Report（Owner Payout）rentalcollection 分类**：以 **type_id** 为准（Rental Income、Forfeit Deposit、Parking、Owner Commission、Agreement Fees、Deposit、Tenant Commission）；title 仅作 type_id 缺失或未知时的 fallback。Parking 支持 account.title = "Parking" 或 fallback id；Forfeit Deposit id = 2020b22b-028e-4216-906c-c816dcb33a85。

- **Migrations：** 若尚未执行请先跑 **0076**、**0077**；**0087**（wixid→id 替换，已执行）；**0093**（saasadmin 表，SaaS Admin 登入用）；**0094**（pricingplanlogs.remark，Manual billing 方案类型）；**0106**（commission_release 表）、**0107**（commission_release.staff_id/bukku_expense_id）、**0108**（种子 Referral 科目，Commission 会计 money out 用）：  
  `node scripts/run-migration.js src/db/migrations/0076_refunddeposit_tenancy_id.sql`  
  `node scripts/run-migration.js src/db/migrations/0077_tenancy_last_extended_by_id.sql`  
  `node scripts/run-migration.js src/db/migrations/0093_saasadmin_table.sql`  
  `node scripts/run-migration.js src/db/migrations/0094_pricingplanlogs_remark.sql`  
  **0103**：`api_user.can_access_docs`，用于控制谁可登录 portal /docs 查看 API 文档；SaaS Admin「API Docs」tab 管理。  
  **0087**：`id` = Wix `_id`，已删除所有 `wix_id`、`*_wixid` 列；Import 用 CSV `_id` 直接写入 `id`；新 insert 由后端 `randomUUID()` 生成。  
  **0130**（租客门户 Smart Door 分物业/房间 PIN）：`tenancy.password_property` / `password_room` / `passwordid_property` / `passwordid_room`；未跑 migration 时远程开锁仍可按 scope 过滤，但单独改「仅物业门 / 仅房门」PIN 会返回 `SMARTDOOR_SCOPE_REQUIRES_MIGRATION`。`node scripts/run-migration.js src/db/migrations/0130_tenancy_smartdoor_scope_passwords.sql`
- **Tenancy + TTLock（欠租 / 到期 / 终止 / 换房 / 延租）：** ① **欠租 daily**：仍对物业+房门（及父锁同名）做 **`change` 结束日=昨天**，不断 delete。② **日历到期**：`POST /api/cron/daily` 在欠租之后跑 **`runEndedTenancyPasscodeRemoval`** — `DATE(tenancy.end) < 今天(马)`、`status=1` 且仍存 PIN → TTLock **`/keyboardPwd/delete`** + 清空 `tenancy` 密码列（幂等）。③ **Operator 终止租约**：`terminateTenancy` 内同样 **`removeTenancySmartDoorPasscodes`**。④ **换房 `changeRoom`**：删旧**房门** PIN；若换物业则删旧**物业门** PIN；新房 `add` 后 `setTenancyActive` 对齐 `end`；租约因欠租 `active=0` 时仅 **`extendLocksOnly`**（不自动合闸、不改 active）。⑤ **延租**：租约活跃时 `setTenancyActive` 延长双锁。封装：`lock.wrapper.js` 的 **`deletePasscode`**；逻辑：`tenancy-active.service.js`、`tenancysetting.service.js`。Daily JSON 多 **`endedTenancyPasscodes`**。
- **Daily Cron 新增 Refund deposit：** 租约 end &lt; 今天且未续约、deposit&gt;0、尚无 refunddeposit 时自动写入 refunddeposit（Admin Dashboard 可见）；refunddeposit 表增加 tenancy_id（0076）。
- **Admin Refund：** #boxrefund 增加 #inputrefundamount（可编辑且只能 ≤ 原 amount）；若改小则差额作 forfeit，仅 #buttonmarkasrefund 时写 journal。
- **Admin Section/Repeater：** #buttonagreementlist 打开 #sectionproperty（无 #buttonproperty）；#repeateragreement 已删除。#repeatertenancy 只显示与**当前 Staff** 相关的 tenancy：**submitby_id = 当前 staff**（Booking 创建）或 **last_extended_by_id = 当前 staff**（Extend 记录，0077 + extendTenancy 写入）。
- **Admin Dashboard 按钮门控：** 公司 Profile（Company Setting 的 profile，以 `client.title` 有值为准）未填好前，仅 profile / usersetting / integration / topup 可点；**admin**、**agreementlist** 须在 profile 填好后才 enable。实现见 Portal Next.js Operator 与 `companysetting.service.js` 的 `getProfile`。
- **Tenant Dashboard 按钮门控：** ① **Profile 优先**；② **有未签合约时** 只启用 agreement 与 property 选择；③ **租金未还** 时 meter、smartdoor 禁用。实现见 Portal Next.js 租客门户。
- **门禁拒绝约定：** 拒绝时统一文案（NO_PERMISSION → "You don't have permission"，其余 → "You don't have account yet"）；无 credit 或无 permission 时相关入口 disable。逻辑在 Portal Next.js 中实现。
- **Portal 公开页（portal.colivingjb.com）：** **Pricing**（/pricing）先选国家→选角色：Owner manage own / Operator 看平台定价表（**方案**：付 X 得 X credits、valid 1 year，到期需再购买以 renew/upgrade；Add-On 含 Smart Door TTLock、Smart Meter Cnyiot、Accounting partner Xero/Bukku/Autocount/MySQL；**Stripe 费率** 表 Note 列为 X%+1（Stripe % + 1% 平台）；**Credit Value**：Core credit = 方案订阅、1 年有效、1:1；Flex credit = 无到期、从 creditplan 表 top-up，如 1800→2000 / 850→1000 / 160→200；**Special features** 说明 Parent Meter、Parent Smart Door）。**Owner looking for operator** 先进 **Proposal**（/proposal）看服务与收费方式（10% 月费/按租约佣金），再点 Get in touch 进 **Owner Enquiry**（/ownerenquiry）提交屋主资料，存 **owner_enquiry** 表，无 Plan of interest、无 demo。**Enquiry**（/enquiry）提交后仅保存 lead（client + client_profile，/api/enquiry/submit），不创建 demo 户口；试用请直接用 **demo.colivingjb.com**，正式用 **portal.colivingjb.com**。**Privacy Policy**（/privacy-policy）、**Refund Policy**（/refund-policy）为平台条款（Coliving Management Sdn Bhd；MY/SG；联系 colivingmanagement@gmail.com）；Privacy 含 Cookie（Google Analytics、Facebook Pixel）、SaaS 免责；Refund 仅适用于向平台购买的方案与 credit top-up，不退款不换货，租客付 operator 之款项依 operator 自身条款。详见 [readme/index.md](./readme/index.md)#portal-公开页。
- **SaaS Admin（Portal Next.js /saas-admin）：** 仅 **saasadmin 表** 内邮箱可进入（migration **0093**）；登入后默认 **Dashboard** 首页，含「本月 Credit used」统计与 **Credit used by month** 柱状图（`POST /api/billing/indoor-admin/credit-used-stats`）。**Credit Top-up**：Payment date 默认今天；Submit 后写 credit log 并生成平台 SaaS Bukku invoice。**Pricing Plan**：必选 **Remark**（New customer / Renew / Upgrade），Create 后写 pricingplanlogs（含 remark，migration **0094**）并生成平台 Bukku invoice。**Pending** 工单：`topup_manual` 可点「Fill top-up form」跳转 Credit Top-up 并预填 Client、Payment date；`billing_manual` 可点「Go to Pricing」跳转并预选 Client。**API Docs**：SaaS Admin 内「API Docs」tab 管理 **api_user** 的 **can_access_docs**（migration **0103**）；被允许的用户可用 username+password 登录 **portal /docs** 查看 API 文档。后端 docs-auth 需配置 **DOCS_SESSION_SECRET**（或 SESSION_SECRET）用于签署 cookie。后端：`getAccessContextByEmail` 对 saasadmin 表邮箱返回 ok（无 staff/client），故可调 indoor-admin 全系列；详见 [nextjs-migration](./nextjs-migration/) 与 Billing 节 indoor-admin。**Operator API 数据隔离**：使用 Bearer + X-API-Username 调接口时，只能操作该 **api_user 绑定的 client**（`api_user.client_id`）；中间件 **apiClientScope** 强制 `req.clientId = req.apiUser.client_id`，body/query 带其他 clientId 则 403（CLIENT_SCOPE_VIOLATION）；未绑定 client 的 api_user 访问需 client 的接口会 403（API_USER_NOT_BOUND_TO_CLIENT）。
- **Operator Portal（Portal Next.js /operator）：** 仅 **staff** 角色在 /portal 可见 Operator 卡片；默认进入 **/operator/billing**。**权限与侧栏**：admin = 主账号全权限；profilesetting → Company（/operator/company）；usersetting → Staff 可编辑否则仅看；integration → System Integrations 可点按钮否则仅看；billing → /operator/billing；finance → /operator/credit；tenantdetail → Contact（/operator/contact）；propertylisting → Property；marketing → Room（/operator/room）；booking → /operator/booking。无某权限则侧栏不显示该入口；无权限访问当前路径时重定向回 /operator/billing。**无 credit**：operator 余额 ≤ 0 时所有员工强制跳转 /operator/credit（不限权限）。**新 client**：公司资料未填完（如 client.title 为空）时强制先填 Company Setting（/operator/company）方可离开。**主账号（Company Email）**：注册用 **operatordetail.email** = 主账号，开户时已设为 master admin 全权限；在 Company Setting 的 Staff 列表中主账号显示「主账号 / Company Email」、**不可编辑**（后端 updateStaff 对主账号抛 MAIN_ACCOUNT_CANNOT_EDIT）。**员工同步到会计系统：** 在 Company Setting 的 Staff「新建/编辑」以及员工编辑自己 profile 点击 Save 时，后端根据该 client 在 `client_integration` 中启用的会计系统调用 contact-sync。**Accounting Manage 弹窗 E-Invoice：** Portal 的 Company → System Integrations → 点击已连接会计（Bukku/Xero/AutoCount/SQL）的「Manage」时，弹窗内显示 **Enable E-Invoice** 勾选框；勾选变化立即调用 `updateAccountingEinvoice` 保存。详见 `contact-sync.service.js`、`companysetting.service.js`。
- **Commission (Referral)：** Booking 由 **portal 用户（client_user）** 提交；**tenancy.submitby_id** 不表示创建人（保持 **NULL**，该列 FK 仅指向 staffdetail）。仅当 Booking 页 **Commission staff** 选了 **Contact Setting 的 Staff**（staffdetail）且 billing 含佣金金额时，才写入 **commission_release**（due_by_date 来自 admin 规则）；**— No staff —** 则不创建 commission_release（无 referral 发放记录），**billing_json** 里租户/业主佣金行仍可照常生成。**Commission (Referral)** 页列表、Mark as paid、会计 money out 等同上。Migrations：**0106**、**0107**、**0108**；会计能力需 account package 且 addonAccount 已整合。
- **详细：** [cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)、[nextjs-migration/](./nextjs-migration/)。

---

## Migration 完成确认（Stripe Checkout + 大额 1000 + Topup 全页）

- **状态：** 本仓库内迁移已完成，无需在 ECS 上再粘贴额外代码；部署最新代码即可。
- **后端（ECS Node，已在 repo）：**
  - Stripe 全部改为 **Checkout**：Client 充值 `POST /api/stripe/create-checkout-credit-topup`，Tenant 租金 `POST /api/stripe/create-checkout-rent`；Webhook `checkout.session.completed` 处理 `credit_topup`、`rent`。
  - **Pricing plan 大额：** `src/modules/billing/checkout.service.js` 中 `PRICING_PLAN_STRIPE_MAX_AMOUNT = 1000`；金额 ≥ 1000 返回 `provider: 'manual'` 并调用 `recordManualBillingTicket` 写 help/ticket（mode=`billing_manual`）。
  - **Help 工单：** `src/modules/help/help.service.js` 提供 `recordManualBillingTicket`、`submitTicket`；`POST /api/help/ticket` 接收前端提交的 `topup_manual` 等。
- **前端（Portal Next.js）：** 金额 > 1000 时不跳 Stripe，走 manual 工单并调用 `submitTicket({ mode: 'topup_manual', description: '...', clientId })`。见 Portal 相关页面。
- **若 ECS 尚未部署最新代码：** 在 ECS 上执行你方现有部署流程（例如 `git pull && npm install && pm2 restart all` 或 CI/CD），无需单独粘贴脚本。

---

## 文档目录（docs 结构）

| 目录 | 说明 |
|------|------|
| **[docs/architecture](./architecture/)** | **多产品 SaaS 大方向**（coliving / homestay / cleaning / handyman、终端、channel manager）：[multi-domain-saas-blueprint.md](./architecture/multi-domain-saas-blueprint.md)。仓库内可提交，与 Cursor 详细计划互补。 |
| **[docs/db](./db/)** | 库表设计草稿（[db.md](./db/db.md)）、**CMS 字段→MySQL 表/列对照**（[cms-field-to-mysql-column.md](./db/cms-field-to-mysql-column.md)）、**FK 与 Junction 表一览**（[fk-and-junction-tables.md](./db/fk-and-junction-tables.md)）、**导入约定（0087 后）**（[import-wixid-to-fk-junction-rule.md](./db/import-wixid-to-fk-junction-rule.md)：id=Wix _id、Import 直接写入、新 insert 后端生成）、**未使用列报告**（[unused-columns-report.md](./db/unused-columns-report.md)）。数据导入（import-*.md，CSV 步骤与列对齐）。**Agreement 从创建到最终合约闭环**：[agreement-flow-create-to-final.md](./db/agreement-flow-create-to-final.md)。**會計流程封圈與四系統**：[accounting-flows-summary.md](./db/accounting-flows-summary.md)；**會計 Invoice/Purchase/Bills/Expenses 所需科目檢查清單**：[accounting-accounts-checklist.md](./db/accounting-accounts-checklist.md)；**Refund & Forfeit 按平台細說**：[refund-forfeit-other-platforms.md](./db/refund-forfeit-other-platforms.md)。执行全部 migration：[run-all-migrations-paste.md](./db/run-all-migrations-paste.md)。 |
| **docs 根目录** | 本 index、流程总览等。**Profile 联动**（Tenant/Owner/Staff 改 profile 经 updatePortalProfile 同步到 portal_account 与三张 detail 表）：[profile-sync-and-portal.md](./profile-sync-and-portal.md)（含 **Next Coliving 统一个人资料页** 与 `portal_jwt`）。**Cleanlemons Operator Contact**（`/operator/contact`、`cln_clientdetail` / `cln_employeedetail`、Portal 同邮箱合并、会计集成推送）：[cleanlemons-operator-contact-data-flow.md](./cleanlemons-operator-contact-data-flow.md)。**Portal 忘记密码发信**（SMTP 配置、Gmail/SendGrid 等）：[portal-password-reset-email.md](./portal-password-reset-email.md)。数据导入（import-*.md）在 [docs/db/](./db/)。ECS 排查「谁在接 api.colivingjb.com」：[ecs-check-who-serves-api.md](./ecs-check-who-serves-api.md)。**SaaS 平台四母账号**（TTLock / CNYIOT / Stripe / Bukku 的 env 与 client 子账号/Connect 关系）：[saas-platform-mother-accounts.md](./saas-platform-mother-accounts.md)。**每日定时任务**（含：**欠租**→**租约日历到期 TTLock 删密码**→Demo 刷新→房间可租→Refund→Pricing/Core credit→每月1号 active room→payout fallback/reconciliation→门锁电量；详见下文 § 每日定时任务）：[cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)。**Demo Account 设计**（每表插入项、12am 刷新、sandbox、tenancy 按日 renew）：[demo-account-design.md](./demo-account-design.md)。**支付与 payout 入账**（Client 充值 credit / Tenant 租金 / Tenant Dashboard 付发票与 Meter 充值；**Stripe / Xendit / Billplz payout journal 主流程为 webhook 驱动**：若 client 已接 accounting 则 payout 终态回调即开 journal；未接 accounting 只更新状态；同一 provider payout id 不会重复开 journal）：[stripe.md](./stripe.md)。**电表分组与账单规则**（AUTO/MANUAL、Prepaid/Postpaid、3 种 Sharing、12 种组合，parent+child 与 tenancy 无关）：[meter-billing-spec.md](./meter-billing-spec.md)。**Storage（OSS）**：新上传走阿里云 OSS、按 client 分目录；**表存 URL**。**日期与时区**：datepicker = UTC+8，读 table 返回按 UTC+8 格式化 [date-timezone-convention.md](./date-timezone-convention.md)。 |
| **[docs/readme/](./readme/)** | 各模块说明索引：[readme/index.md](./readme/index.md)（含 **Portal 登入/注册/OAuth 与部署**、**Portal 个人资料统一页（Coliving / Cleanlemons）**、`portal_jwt`、**Operator Quick Setup**（/operator/quicksetup，见 readme#operator-quicksetup）、**Cleanlemons Employee Tasks**（/employee/task，成组 Start/End、MYT、远程开门）、TTLock、CNYIoT、**Stripe**、**Bukku / AutoCount**、Company Setting）。**ECS 双产品域名与 operator 表对照（Coliving / Cleanlemons）：** [readme/ecs-two-products-domains.md](./readme/ecs-two-products-domains.md)。 |
| **[docs/nextjs-migration/](./nextjs-migration/)** | **Portal 前端**（portal.colivingjb.com / demo.colivingjb.com）：Next.js 16，登入/注册/Google·Facebook OAuth（同页跳转）、/portal 租客首页；API 用 `NEXT_PUBLIC_ECS_BASE_URL` 或 proxy 调 Node。**统一个人资料**（`/tenant/profile`、`/owner/profile`、`/operator/profile`，`components/shared/unified-profile-page.tsx`，`portal_jwt` + `GET/PUT portal-auth/profile`）：见 [readme/index.md](./readme/index.md) 对应章节。**公开页**：**Pricing**（/pricing）、**Enquiry**（/enquiry）、**Proposal**、**Owner Enquiry**、**Privacy/Refund Policy**。**SaaS Admin**（/saas-admin）：仅 saasadmin 表邮箱可进；**Dashboard** 首页（Credit used 本月 + 按月柱状图）、**Clients** 列表、**Credit Top-up**（Payment date 默认今天，Submit 写 credit log + 平台 Bukku invoice）、**Pricing Plan**（Remark：New customer/Renew/Upgrade，Create 写 pricingplanlogs + 平台 invoice）、**Pending** 工单（Fill top-up form / Go to Pricing 预填跳转）。**Operator Portal**（/operator）：仅 staff 在 /portal 可见入口；默认 **/operator/billing**；侧栏按 **staff 权限** 过滤（admin/profilesetting/usersetting/integration/billing/finance/tenantdetail/propertylisting/marketing/booking）；无 credit 强制 /operator/credit、新 client 未填公司资料强制 /operator/company；**主账号**（operatordetail.email）在 Company Setting 不可编辑。**Property Settings**（/operator/property）：**Property details**（type 置顶 + 简称/楼盘/单位/地址）、**Access**（钥匙与安防；Other 时床位）、**Owner settlement**；新增 `insert` 可选 shortname/address；物业类型五类与 `propertydetail.premises_type` 及 Cleanlemons 同步见本页「近期更新」Coliving ↔ Cleanlemons 条。**Company → System Integrations**：Connect 与 Manage 弹窗中 **Bukku/Xero/AutoCount/SQL** 四套会计均有 **Enable E-Invoice** 勾选框；Manage（已连接）时勾选变化即调 `updateAccountingEinvoice` 保存。**Booking** 页：Commission 区块下 **Commission staff** 下拉来自 **Contact Setting 的 Staff**（getContactList type=staff），非 Company 登入用户；Remark 可填备注。**Commission (Referral)**（/operator/commission）：列表来自 commission_release，可设 release amount/date、选 Staff 与 Payment method，Mark as paid 时做会计 money out 至该 staff。**Smart Door**（/operator/smart-door）：**Sync Lock** = TTLock 未入库设备弹窗入库；**Refresh status** = `sync-status-from-ttlock` 刷新已在库锁/网关；TTLock 锁列表用 **`hasGateway`**。详见本页下文「Smart Door Setting 页」。API 见 `lib/operator-api.ts`、`lib/operator-permissions.ts`。**部署**：`cd docs/nextjs-migration && npm run build && pm2 restart next-coliving`（或项目内 `npm run build:portal`）；**Nginx CORS** 见 [nginx-api-portal-auth-cors.md](./nginx-api-portal-auth-cors.md)。v0 设计导入：[nextjs-migration/v0-import/](./nextjs-migration/v0-import/)、[UPDATE-FROM-V0.md](./nextjs-migration/UPDATE-FROM-V0.md)。 |

---

## Accounting 會計流程（SaaS 等級，四系統 ready to live）

- **所有會計相關流程均為 SaaS 等級**：依 **當前 client 的 provider**（`client_integration` 中 key=Account/addonAccount、enabled=1 的 **xero / bukku / autocount / sql**）在該系統生成單據；每個 client 只會對接一個會計系統，後端透過 `resolveClientAccounting(clientId)` 取得 provider 與 req，再調用對應 wrapper 開 invoice / receipt / refund / purchase 等。
- **六類流程已封圈**：1）Meter invoice + receipt；2）Rental collection invoice + receipt；3）Expenses bill + receipt；4）Owner payout bills + receipt；5）Refund deposit；6）Forfeit deposit。**Xero、Bukku、AutoCount、SQL** 四套均已對接，完成 Account Setting Sync（或手動對應 account 表 + account_client）即可上線。
- **ID / URL**：多數流程會返回或寫回會計單據 id；有線上連結的（如 Xero/Bukku 的 invoice）會寫入對應表的 invoiceurl 等欄位。詳見 [docs/db/accounting-flows-summary.md](./db/accounting-flows-summary.md)。
- **Xero/Bukku parity 狀態（2026-03 驗收）**：`operator/accounting` sync、contact sync（import in / export out）、booking invoice、invoice create/void/payment、expenses bill create/void、owner payout create/void/mark paid、deposit refund+forfeit create/void 均已通。  
  補充：Xero `Spend Money` 通常無可分享 URL，前端不應強制顯示 refund 連結；void 需用 BankTransactions 更新狀態為 `DELETED`（`POST /BankTransactions/{BankTransactionID}` + body `{ BankTransactionID, Status: "DELETED" }`，即 UI 的 Remove & Redo 行為）。

### Account 表與 account_client（科目範本與客戶對應）

- **account 表**：全站共用的**科目範本**（如 Bank、Cash、Rent Income、Expenses、Management Fees、Platform Collection 等），每筆有 id、title、type、bukkuaccounttype。開單時依「類型」（如 bank/cash/management_fees）用 title 查 account.id，再依 client + 該 id 查真實會計系統的 accountid。
- **account_client 表**：存每個 client、每個會計系統的對應：`(account_id, client_id, system)` → `accountid`（及選填 product_id）。**Account 設定頁存檔只寫入 account_client**，不再寫入 account.account_json；查詢時先查 account_client，無則 fallback 讀 account_json（相容舊資料）。
- **遷移既有 account_json → account_client**：執行 `node scripts/migrate-account-json-to-account-client.js`，會把 account 表內 account_json 陣列中每筆 client 對應寫入 account_client（clientId/client_id 會解析為 operatordetail.id）。
- **會計科目檢查清單**：各流程（invoice、purchase、bills、expenses、settlement journal）所需 account title 與 account_client 對應見 [docs/db/accounting-accounts-checklist.md](./db/accounting-accounts-checklist.md)。Migration **0070** 僅在尚無該 title 時補齊 Cash、Management Fees、Platform Collection；**0071** 可刪除 0070 新增的三筆（若你表裡已有這些 title，避免重複）。

---

## 架构与数据约定（必读）

- **多产品长期方向（蓝图）**：见 [architecture/multi-domain-saas-blueprint.md](./architecture/multi-domain-saas-blueprint.md)（与当前「单后端多租户」演进关系、基础设施与 CPU 对照摘要）。
- **当前架构：** **前端 Next.js**（Portal / Operator / SaaS Admin）/ **后端 Node（ECS）** / **数据库 MySQL**。业务数据全部在 MySQL。
- **Storage（OSS）：** 图片/视频上传走 **阿里云 OSS**（`POST /api/upload`，form：`file` + `clientId`；路径 `uploads/{clientId}/YYYY/MM/`）。**表里存 URL**；已有 URL 保留；新上传统一走 OSS。
- **日期与时区：** 客户在马来西亚/新加坡 (UTC+8)。**MySQL 一律存 UTC (UTC+0)**；**datepicker 选 1 Mar 2026 = UTC+8 的 1 Mar**；**读 table 返回前一律按 UTC+8 格式化**。详见 [docs/date-timezone-convention.md](date-timezone-convention.md) 与 `src/utils/dateMalaysia.js`。
- **API 路由与时区审计（命令、已完成项、仍为 pending 的原因）：** [docs/api-route-timezone-audit.md](api-route-timezone-audit.md)。
- **开发约定：** 表/列不确定时 → **先与维护者确认**，再写/改代码。

---

## 数据导入与同步

- **OperatorDetail（主表 + 4 张子表）**：清空、CSV 上传、导入、以及「从 operatordetail 表自动同步到子表」的步骤与脚本见 [db/import-operatordetail.md](./db/import-operatordetail.md)。
- 其他 CSV 导入：tenantdetail / ownerdetail / propertydetail / supplierdetail / lockdetail / gatewaydetail / ownerpayout / roomdetail / staffdetail / tenancy / bills(UtilityBills) / agreementtemplate / account(bukkuid) / creditplan / meterdetail / pricingplan / pricingplanaddon / pricingplanlogs 见 [docs/db/](./db/) 内对应 `import-*.md` 及下方「流程总览」中的 step-by-step 链接。
- 库表设计草稿见 [db/db.md](./db/db.md)。**导入约定（0087 后）**：Wix 导出的 `_id` 直接写入 `id`；reference 列直接写入对应 `_id`（FK）；并同步 Junction；见 [db/import-wixid-to-fk-junction-rule.md](./db/import-wixid-to-fk-junction-rule.md)。
- 建表/改表 SQL：`src/db/migrations/`（如 `0001_init.sql`、`0002_clientdetail_subtable_json_columns.sql`），按项目约定执行。

### Wix reference → id 约定（Migration 0087 后）

- **0087 后：** 所有表 `id` = Wix CMS 的 `_id`（UUID 同格式）。已删除 `wix_id`、`*_wixid` 列。
- **FK：** 一律用 `client_id`、`property_id` 等 `_id` 列；Wix 导出的 reference 值直接写入对应 `_id`。
- **下次 import：** CSV 的 `_id` 直接写入 `id`；reference 列（如 client、property）直接写入 `client_id`、`property_id`。详见 Cursor 规则 `mysql-fk-use-id-only.mdc`。

### SaaS 户口层级（总户口 / 子户口 / 租客）与 CNYIoT

- **总户口** = 平台方；**子户口** = Client（operatordetail）= 我们的客户，在 CNYIoT 对应一个房东账号，可登入、管理多电表；**租客** = tenantdetail = client 的租客（不是我们的 tenant）。Client 不是我们的 tenant；租客支付成功后可用现有 API 对该 client 下电表充值。创建 client/租客的导入见 import-operatordetail、import-tenantdetail；在 CNYIoT 创建租客（addUser/link2User）的 wrapper 与 step-by-step 尚未做。详见 [docs/saas-account-model-and-cnyiot.md](./saas-account-model-and-cnyiot.md)。**电表分组与账单规则**（parent+child/sharedUsage、AUTO/MANUAL、Prepaid/Postpaid、Percentage/Divide equally/Room，与 tenancy 无关，12 种组合）见 [meter-billing-spec.md](./meter-billing-spec.md)。

### client 关联与 FK 约定

- **所有关联 client 的外键一律使用 `client_id` → `operatordetail(id)`**。
- **0087 后：** `operatordetail.id` = Wix _id；CSV 导入时 `client_id` = CSV 的 client 列（Wix reference 值）直接写入。

### 数据导入与迁移流程总览（按执行顺序）

| 阶段 | 迁移 / 建表 | 清空脚本 | 导入脚本 | CSV 示例 | 分步文档 |
|------|-------------|----------|----------|----------|----------|
| OperatorDetail + 子表 | 0001, 0002 | clear-client-and-subtables.js / clear-and-import-operatordetail.js | import-operatordetail.js | operatordetail.csv | [import-operatordetail.md](./db/import-operatordetail.md) |
| SupplierDetail | 0003, 0004 | truncate-supplierdetail.js | import-supplierdetail.js | SupplierDetail.csv | [import-supplierdetail.md](./db/import-supplierdetail.md) |
| LockDetail / GatewayDetail | 0005 | truncate-lockdetail.js, truncate-gatewaydetail.js | import-lockdetail.js, import-gatewaydetail.js | LockDetail.csv, GatewayDetail.csv | [import-lockdetail-gatewaydetail-stepbystep.md](./db/import-lockdetail-gatewaydetail-stepbystep.md) |
| OwnerPayout / RoomDetail | 0006, 0007, 0008(建表) | truncate-ownerpayout.js, truncate-roomdetail.js | import-ownerpayout.js, import-roomdetail.js | OwnerPayout.csv, RoomDetail.csv | [import-ownerpayout-roomdetail-stepbystep.md](./db/import-ownerpayout-roomdetail-stepbystep.md) |
| StaffDetail / Tenancy | 0009, 0010, 0011(建表) | truncate-staffdetail.js, truncate-tenancy.js | import-staffdetail.js, import-tenancy.js | StaffDetail.csv, Tenancy.csv | [import-staffdetail-tenancy-stepbystep.md](./db/import-staffdetail-tenancy-stepbystep.md) |
| Bills / AgreementTemplate | 0012, 0013(建表), 0014 | truncate-bills.js, truncate-agreementtemplate.js | import-bills.js, import-agreementtemplate.js | UtilityBills.csv, agreementtemplate.csv | [import-utilitybills-agreementtemplate-stepbystep.md](./db/import-utilitybills-agreementtemplate-stepbystep.md) |
| Account / CreditPlan / MeterDetail (bukkuid 等) | 0015, 0016, 0017 | truncate-account.js, truncate-creditplan.js, truncate-meterdetail.js | import-account.js, import-creditplan.js, import-meterdetail.js | bukkuid.csv, creditplan.csv, meterdetail.csv | 见 [docs/db/](./db/) 脚本速查 |
| PricingPlan / Addon / Logs | 0018 | truncate-pricingplanlogs.js → truncate-pricingplan.js → truncate-pricingplanaddon.js | import-pricingplan.js, import-pricingplanaddon.js, import-pricingplanlogs.js | pricingplan.csv, pricingplanaddon.csv, pricingplanlogs.csv | [import-pricingplan-stepbystep.md](./db/import-pricingplan-stepbystep.md) |
| RentalCollection（发票/租金） | 0039, 0040, 0041, 0042 | truncate-rentalcollection.js | import-rentalcollection.js | rentalcollection.csv | [rentalcollection-import-steps-powershell.md](./db/rentalcollection-import-steps-powershell.md)、[rentalcollection-import-columns.md](./db/rentalcollection-import-columns.md) |

**迁移文件列表（顺序）**：`0001_init.sql` → … → `0077` → **`0087_wixid_to_id_replace_and_drop_wixid_columns.sql`**（记录用；实际执行 `node scripts/migrate-wixid-to-id.js`：id=wix_id、删所有 *_wixid 列）。**0225**（`propertydetail.premises_type` / `security_system`，Coliving ↔ Cleanlemons 物业字段）：`node scripts/run-migration.js src/db/migrations/0225_propertydetail_premises_security.sql`。**0226**（清洁 tenant 价 + Cleaning Services account）：`node scripts/run-migration.js src/db/migrations/0226_cleaning_tenant_price_and_account.sql`。执行方式：`node scripts/run-migration.js src/db/migrations/xxxx_*.sql` 或一次性执行全部见 [docs/db/run-all-migrations-paste.md](./db/run-all-migrations-paste.md)。

### 脚本 scripts 速查

| 脚本 | 用途 |
|------|------|
| `clear-and-import-operatordetail.js [csv]` | 清空 operatordetail + 4 子表后导入 CSV（默认 `./operatordetail.csv`） |
| `clear-client-and-subtables.js` | 仅清空 operatordetail + client_integration / client_profile / client_pricingplan_detail / client_credit |
| `import-operatordetail.js [csv]` | 仅导入 operatordetail + 子表，不清空 |
| `verify-and-sync-client-subtables.js` | 检查行数 + 从 operatordetail 四列重新同步到 4 张子表 |
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
| `import-rentalcollection.js [csv_path]` | 导入 rentalcollection.csv：0087 后 CSV _id→id、reference 直接写入 _id 列（见 [rentalcollection-import-columns.md](./db/rentalcollection-import-columns.md)） |
| `run-migration.js [path]` | 执行 migrations 目录下 SQL；可传路径如 `src/db/migrations/0019_create_api_user.sql`、`0069_clientdetail_bukku_saas_contact_id.sql`、…、`0093_saasadmin_table.sql`、`0094_pricingplanlogs_remark.sql` |
| `run-0069-bukku-contact-id.sh` | 執行 0069：operatordetail 新增 bukku_saas_contact_id（平台 Bukku 開單用） |
| `migrate-account-json-to-account-client.js` | 將 account.account_json 內所有 client 對應遷移到 account_client 表 |
| `migrate-wixid-to-id.js` | 0087：id=wix_id、删所有 *_wixid 列（已执行，仅记录） |
| `check-agreement-columns.js` | 检查 agreement 表是否已有 0053/0054/0055 列（hash_draft、hash_final、version、*_signed_ip、columns_locked）；缺则 exit 1 |
| `insert-api-user.js [username]` | 新增一条 `api_user`（token 自动生成），例：`node scripts/insert-api-user.js saas_wix` |
| `find-unused-db-columns.js` | 检测 src/、scripts/ 中未引用的 DB 列，输出见 [unused-columns-report.md](./db/unused-columns-report.md)；`node scripts/find-unused-db-columns.js` |

---

## Bukku API wrapper 一览

**认证：** Bearer Token + `Company-Subdomain` header；每个 client 自己的 token/subdomain（来自 operatordetail），不 refresh。

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
- **程序调用：** `lock.wrapper`：`listAllLocks`、`listLockPasscodes`、`addPasscode`、`changePasscode`、**`deletePasscode`**（`/keyboardPwd/delete`，与租约到期/终止/换房删旧 PIN 共用）、`remoteUnlock` 等。`ttlock.getValidTTLockToken(clientId)`、`ttlock.ensureTTLockSubuser(clientId)`。**锁列表响应字段：** 官方文档含 **`hasGateway`**（是否已绑网关）；**不含** `gatewayId`。Smart Door 合并逻辑须读 `hasGateway`，见上文「Smart Door Setting 页」。
- **子账号：** 平台可为每个 client 开 TTLock 子账号。**Username 与 password 均由我们 SaaS 设定**（非 TTLock 随机）：username=该 client 的 subdomain，password=我们设定的默认密码，存 client_integration。详见 [docs/ttlock-subuser.md](./ttlock-subuser.md)。

---

## CNYIoT API wrapper（统一平台主账号）

- **认证：** **用量 / 抄表 / 充值** 一律用 **平台主账号**（env `CNYIOT_LOGIN_NAME`、`CNYIOT_LOGIN_PSW`）；**client 不需要绑定 CNYIoT**。apiKey + loginID 按 platform 级别缓存在 `cnyiottokens`，24h 失效后自动重登。apiKey 用 env `CNYIOT_AES_KEY` AES-ECB 加密后传参。**直连官方 API**：base `https://www.openapi.cnyiot.com/api.ashx`；仅可覆盖 **`CNYIOT_BASE_URL`**（已移除 `CNYIOT_PROXY_BASE`）。`CNYIOT_API_ID` 默认 coliman。5002 自动清 token 重试。
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
- **Company Setting 集成（Accounting / Meter / Smart Door）：** `getOnboardStatus` 只统计 `client_integration.enabled = 1` 的集成，故 disconnect（设 enabled=0）后再次拉取会得到对应 false。**Accounting**：返回 `accountingProvider`（xero/bukku/sql/autocount 或 null）；已连时打开 Manage 弹窗（Bukku/AutoCount/Xero 等）；`getBukkuCredentials`/`getAutoCountCredentials` 预填；断开各调 `bukkuDisconnect`/`autocountDisconnect`/`xeroDisconnect`。**Meter (CNYIOT)**：**用量 / 抄表 / 充值** 一律用平台主账号，**client 不需要绑定 CNYIoT**；若需创建子账号或 Connect to old account，contact/subdomain 从 client_profile 取，详见 readme。**Smart Door (TTLock)**：选「Connect to old account」时直接 `ttlockConnect({ mode: 'existing' })`。后端 API：`getCnyiotCredentials`、`cnyiotConnect`、`cnyiotDisconnect`、`getTtlockCredentials`、`ttlockConnect`、`ttlockDisconnect`。详见 [docs/readme/index.md#company-setting-页面ecs-迁移](./readme/index.md#company-setting-页面ecs-迁移)。
- **Lists：** 仅 POST，body 为 `{ lists: string[], params?: array }`，lists 取值见 validator 内 `listNames`。
- **Files：** POST 为 multipart（字段名 `file`），使用 multer + form-data 转发到 Bukku。
- **Locations：** Bukku 单条接口为 `/location/{id}`（单数），列表为 `/locations`。
- **Tags / Tag groups：** 子路径 `/tags/groups` 挂在 tags 路由下。

### Access 门禁（Node API）

- **API：** `POST /api/access/context`（body: `{ email }`）或 `GET /api/access/context?email=xxx`。返回 access context（staff、client、plan、capability、credit、expired）。`capability.accounting` = 套餐是否允许 Accounting；`capability.accountProvider` = 已接会计系统 provider（有值=已 onboard）；**`capability.accountingReady`** = 已 onboard 且 Account Setting 页所有 item 已 sync；`capability.accountingSyncedTotal` / `accountingSyncedMapped` = 模板总数 / 已映射数（可显示「3/5 synced」）。Portal Next.js 用当前用户 email 调此接口。
- **门禁拒绝统一约定：** 拒绝时文案：NO_PERMISSION → "You don't have permission"，其余 → "You don't have account yet"；无 credit 或无 permission 时相关入口 disable。逻辑在 Portal Next.js 中实现。
- **前端显示 "You don't have account yet"：** 表示 `accessCtx.ok === false`，真实原因在 `accessCtx.reason`。常见为 **NO_STAFF**（MySQL staffdetail 无该 email）。
- **代码：** `src/modules/access/access.service.js`、`src/modules/access/access.routes.js`。数据来自 MySQL：staffdetail、operatordetail、client_credit、client_pricingplan_detail。

### API User / Token（Open API 第三方）

- **用途：** 给第三方 Open API 用。在表里加一条记录 = 新增一个 API 用户：**username 手动输入**，**token 系统自动生成**；密码在该表上单独 **create / edit / delete / modify**，每用户独立（**不建议使用 ECS 登入密码**，以免泄露服务器权限）。
- **表：** `api_user`（id, username, password_hash, token, status, created_at, updated_at）。建表：`0019_create_api_user.sql`，执行 `node scripts/run-migration.js src/db/migrations/0019_create_api_user.sql`。
- **第三方/API 调用（双重认证）：** 需要**两个**请求头：**`Authorization: Bearer <token>`**（表里 `token` 列）+ **`X-API-Username: <username>`**（表里 `username` 列）。挂 `apiAuth` 的路由会校验 token 有效且对应用户的 username 与请求头一致。新增用户：`node scripts/insert-api-user.js <username>`。
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

### Billing 计费（Node API）

- **API：** 所有接口需传 `email`（POST body 或 GET query）以解析 access context；需 staff 具 billing 或 admin 权限。
  - `GET` / `POST` `/api/billing/my-info`：当前 client 的计费信息（currency、title、plan、credit、expired、pricingplandetail）。
  - `GET` / `POST` `/api/billing/credit-statements`：分页流水，query/body 可选 `page`、`pageSize`、`sort`（`new`|`old`|`amountAsc`|`amountDesc`）、`filterType`（`Topup`|`Spending`）、`search`；返回 `{ items, total, page, pageSize }`。**注意：** 流水数据依赖 MySQL 的 creditlogs 表，表名/字段确认后需在 `billing.service.js` 内实现查询。
  - `GET` / `POST` `/api/billing/statement-items`：合并 creditlogs + pricingplanlogs 的 Event Log 流水，query/body 可选 `page`、`pageSize`、`sort`（`new`|`old`|`amountAsc`|`amountDesc`）、`filterType`（`Topup`|`Spending`|`creditOnly`|`planOnly`）、`search`；返回 `{ items, total, page, pageSize }`。
  - `POST` `/api/billing/statement-export`：导出流水为 Excel。Body 可选 `sort`、`filterType`、`search`（与当前 Event Log 筛选一致）。Node 用 xlsx 生成文件、存入 downloadStore，返回 **`{ downloadUrl }`**（一次性 `/api/download/:token`）。Portal 前端用 downloadUrl 触发下载。
  - `POST` `/api/billing/clear-cache`：清空当前 client 的计费缓存。
- **Pricing plan 支付：** 访客在 Portal 选 plan 后调 `POST /api/billing/checkout/confirm`。**金额 &lt; 1000**：返回 Stripe Checkout `url`，跳转支付后 webhook 自动更新 client plan。**金额 ≥ 1000**：不创建 Stripe，返回 `provider: 'manual'`；后端写入 **help/ticket**（mode=`billing_manual`）。Topup 金额 &gt; 1000 时走 manual 工单（mode=`topup_manual`）。阈值见 `checkout.service.js` 中 `PRICING_PLAN_STRIPE_MAX_AMOUNT`（默认 1000）。
- **平台 SaaS Bukku 開單（topup / pricing plan）：** 手動或 Stripe 成功後會在**平台自家 Bukku** 開 cash invoice；contact 用該 client 的 **operatordetail.bukku_saas_contact_id**（insert operatordetail 時會建立 Bukku contact 並寫回；若無則 `ensureClientBukkuContact` 會補建）。開單 item description 含 client name、when、payment method、amount、currency、credit before/after（topup）或 plan（pricing plan）。env：`BUKKU_SAAS_API_KEY`、`BUKKU_SAAS_SUBDOMAIN`、`BUKKU_SAAS_DEFAULT_CONTACT_ID`（fallback）、`BUKKU_SAAS_ACCOUNT`/`PAYMENT_BANK`/`PAYMENT_STRIPE` 等。Migration **0069** 新增 operatordetail.bukku_saas_contact_id。
- **Indoor-admin（SaaS Admin 手動開戶/續費）：** 僅 **saasadmin 表** 內邮箱或具 access context 的 staff 可調用。`POST /api/billing/indoor-admin/clients`（客戶列表）、`/pending-tickets`（待處理 billing_manual/topup_manual 工單）、`/manual-topup`（寫 creditlogs + 加 client_credit + 平台 Bukku cash invoice）、`/manual-renew`（寫 pricingplanlogs，可帶 **remark**：new_customer|renew|upgrade，migration 0094，再開平台 Bukku invoice）、`/credit-used-stats`（本月 + 近 12 月 credit 使用量，供 Dashboard 圖表）、`/save-cnyiot-sales-user`。Portal Next.js `/saas-admin` 頁面接上述 API，Dashboard 為首頁、Credit Top-up 預設 Payment date 今日、Pending 可「Fill top-up form」預填跳轉。
- **Operator Portal 權限與主帳號：** staff 權限由 `staffdetail.permission_json` 決定，access context 返回 `staff.permission`（admin/profilesetting/usersetting/integration/billing/finance/tenantdetail/propertylisting/marketing/booking）。**admin** = 主帳號全權限。**主帳號（Company Email）** = 註冊/開戶時用的 **operatordetail.email**；開戶時該 email 在 staffdetail 中設為 **is_master** 且全權限，**不可在 Company Setting 編輯**（`companysetting.updateStaff` 對 email = operatordetail.email 的 staff 拋 `MAIN_ACCOUNT_CANNOT_EDIT`）；`getStaffList` 返回 **mainAdminEmail** 供前端標示「主帳號 / Company Email」並禁用編輯。
- **代码：** `src/modules/billing/billing.service.js`、`billing.routes.js`、`checkout.service.js`、`saas-bukku.service.js`、`indoor-admin.service.js`。数据来自 MySQL：operatordetail（含 pricingplandetail、credit、bukku_saas_contact_id）、pricingplan、pricingplanaddon、creditlogs、pricingplanlogs、saasadmin（0093）。
- **Addon 如何记录：** 访客在 Billing 页选择的 addon 写入 `operatordetail.pricingplandetail`（JSON 数组），并同步到子表 `client_pricingplan_detail`（type=`addon`，plan_id=pricingplanaddon.id，qty）。`getMyBillingInfo` 与 `getAccessContext` 均返回当前 client 的 plan + addons（含 title、qty）。**三个 addon 与功能：**（1）**HR Salary** — 尚未实现。（2）**Bank Bulk Transfer System** — 在 Expenses 与 Generate Report 页：无此 addon 时「银行批量」按钮 disable；API `POST /api/bank-bulk-transfer`、`/files` 会校验 addon，无则 403 `ADDON_REQUIRED`。（3）**Extra User** — 在 Company Setting 的 User Setting：最大人数 = `planIncluded + addonQty`，其中 `planIncluded` 由 `billing.service.js` 中的 `PLAN_INCLUDED_USERS` 按 **pricingplan.id** 决定（未配置时默认 1），`addonQty` 来自 Extra User addon 的 qty，总数上限为 10；`getStaffList` 返回 `maxStaffAllowed`，`createStaff` 超限返回 403 `STAFF_LIMIT_REACHED`；前端 `#buttonnewuser` 在达到上限时 disable。Addon 与功能通过 pricingplanaddon 的 **title** 匹配（如 title 含 "bank bulk transfer"、"extra user"）。

### Stripe 支付封装（Client 充值 credit / Tenant 租金 Connect / Tenant 付发票与 Meter）

- **三种场景（全部 Stripe Checkout，跳转 Stripe 页支付；金额与描述服务端固定，付完/取消回同一页）：**（1）**Client 充值 credit**：`POST /api/stripe/create-checkout-credit-topup` 返回 url，跳转支付后 webhook 写入 `client_credit`。（2）**Tenant 付租金**：`POST /api/stripe/create-checkout-rent` 跳转支付；Stripe Connect，按 client credit 是否足够 1% 决定是否 release 到 Connect。（3）**Tenant Dashboard 付发票 / Meter 充值**：`POST /api/tenantdashboard/create-payment`（type=invoice 或 meter）创建 Checkout；webhook 校验 paid + 金额一致后 UPDATE **rentalcollection** 或 **metertransaction**。
- **平台规则：** Processing fees 由 SaaS 吸收；每笔 transaction markup 1%（从 client credit 扣）；client 无/不足 credit 时不 release 租金。
- **环境变量（.env）：** Stripe / Xendit 按「MY Live、MY Sandbox、SG Live、SG Sandbox、Xendit Live、Xendit Sandbox」整理见 [env-saas-payment.md](./env-saas-payment.md)；Stripe 细节与 `client_profile.stripe_sandbox`（迁移 0060）见 [stripe.md](./stripe.md)。
- **API：** `POST /api/stripe/create-checkout-credit-topup`、`create-checkout-rent`（均需 returnUrl、cancelUrl 同一页）、`release-rent`、`GET /api/stripe/credit-balance`、`connect-account`、`config?clientId=`；Tenant 支付走 `POST /api/tenantdashboard/create-payment`。Webhook 事件：`checkout.session.completed`、`account.updated`。
- **数据库：** `client_profile.stripe_connected_account_id`（0029）、`stripe_connect_pending_id`（0056）、`stripe_sandbox`（0060）；rentalcollection（paidat、referenceid、ispaid）；metertransaction（ispaid、referenceid、status）。
- **Payout 入账（Settlement Journal，2026-03 更新）：** `Stripe / Xendit / Billplz` 的 **主流程** 已改为 **provider webhook 驱动**。当 provider 的 payout / settlement 到银行进入终态时：
  - **已接 accounting**：立即尝试开 journal。
  - **未接 accounting**：仍接 webhook、更新本地 payout 状态，但**不开 journal**。
  - **幂等**：同一 `payout_id / settlement_id / payment_order_id` 只允许写一次 journal；重复 webhook 只更新状态，不会 double journal。
  - **终态规则**：Stripe 以 payout 成功事件为准；Xendit 以 `SUCCEEDED` 为 journal 触发点（`ACCEPTED` 不开 journal）；Billplz payment order 以 `completed` 为 journal 触发点，`refunded/cancelled` 不开 journal。
  - **cron 现仅保留 fallback / reconciliation**，不再是 payout journal 主入口。
- **完整说明与流程：** [docs/stripe.md](./stripe.md)、[readme/index.md#stripe-支付封装](./readme/index.md#stripe-支付封装saas)、[readme/index.md#tenant-dashboard-页面](./readme/index.md#tenant-dashboard-页面ecs-迁移)。
- **Payment gateway 模型（当前原则）：** `Stripe` = **Connect Standard**；`Xendit` = **direct**；`Billplz` = **direct**。Tenant payment 应跟随 operator 自己连接的 gateway account，不应偷偷回退到平台账号。

### Payment gateway 與 payment method 設定責任

- **Payment gateway（用 Stripe 還是 Xendit）：** 由 **operator 自己** 在 **Portal → Company → Integrations（Payment）** 設定；一間公司只能選一個。Tenant 付款會跟隨該 operator 自己連接的 payment system。
- **Payment methods（接受哪些付款方式，如 bank transfer、credit card、FPX、PayNow、GrabPay 等）：** 由 **operator 在自己的 payment provider 後台** 設定，**不是** SaaS 平台設定。Stripe 在 **Stripe Dashboard**（Settings → Payment methods）開關；Xendit 在 **Xendit Dashboard** 啟用/申請各渠道。平台發起收款時依該 operator 帳號在 provider 的設定決定可用方式。詳見 [readme/index.md#payment-gateway-與-payment-method-設定責任](./readme/index.md#payment-gateway-與-payment-method-設定責任)。

### 每日定时任务（Cron）

- **接口：** `POST /api/cron/daily`（Header `X-Cron-Secret` = `.env` 的 `CRON_SECRET`），建议每天 00:00 UTC+8 调用一次。
- **Daily 执行顺序（与 `tenancy-cron.routes.js` 一致）：**
  1. **欠租检查** — `runDailyTenancyCheck`：过去到期未付的 rentalcollection → tenancy **TTLock `change` 双锁结束日=昨天**（见 0130）、CNYIoT 断电、`active=0`；queue 分批 500。
  2. **租约日历到期删密码** — `runEndedTenancyPasscodeRemoval`：`DATE(tenancy.end) < 今天(马)`、`status=1` 且仍存 PIN → **`keyboardPwd/delete`** + 清空 `tenancy` 密码列；响应体 **`endedTenancyPasscodes`**（processed/errors）。与 **终止租约** 共用 `removeTenancySmartDoorPasscodes`。
  3. **Demo 账户刷新** — `runDemoAccountRefresh`（`is_demo=1` 的 client）。
  4. **房间可租同步** — `syncRoomAvailableFromTenancy`：按 tenancy 日期更新 roomdetail.available / availablesoon / availablefrom。
  5. **Refund deposit** — 租约 end &lt; 今天且未续约、deposit&gt;0、尚无 refunddeposit 时写入 refunddeposit。
  6. **Pricing plan 到期** — client inactive（status=0）等。
  7. **Core credit 到期日清空** — 写 creditlogs（type=Expired）等。
  8. **每月 1 号 active room 扣费** — 仅当当天为 1 号：每间 10 credit，幂等。
  9. **Stripe fallback/reconciliation** — 处理历史 `stripepayout` 中仍未入账的 pending journal。
  10. **Payex/Xendit fallback/reconciliation** — 拉 settlements；若有历史 pending 则补做 settlement journal。
  11. **门锁电量 &lt; 20%** — `runDailyBatteryCheckAndInsertFeedback` → feedback。
- **详细步骤与说明：** [cron-daily-setup-step-by-step.md](./cron-daily-setup-step-by-step.md)。核心代码：`tenancy-cron.routes.js`、`tenancy-active.service.js`（含 `deletePasscode` 调用链）、`refund-deposit-cron.service.js`、`pricing-plan-expiry-cron.service.js`、`core-credit-expiry-cron.service.js`、`active-room-monthly-cron.service.js`、`demo-refresh-cron.service.js`、`battery-feedback-cron.service.js`、`settlement-journal.service.js`；TTLock 封装：`src/modules/ttlock/wrappers/lock.wrapper.js`（`deletePasscode`）。**注意：** payout webhook 才是 journal 主入口；daily cron 只用于 fallback / reconciliation。

### Agreement 协议上下文（Node API）

- **API：** 所有接口需传 `email`（POST body）以解析 access context；返回协议模板变量与元数据（或 `{ ok: false, reason }`）。
  - `POST` `/api/agreement/tenant-context`：Body `{ email, tenancyId, agreementTemplateId, staffVars? }`，租客↔运营方协议变量。
  - `POST` `/api/agreement/owner-context`：Body `{ email, ownerId, propertyId, clientId, agreementTemplateId, staffVars? }`，业主↔运营方协议变量。
  - `POST` `/api/agreement/owner-tenant-context`：Body `{ email, tenancyId, agreementTemplateId, staffVars? }`，业主↔租客协议变量。
  - `POST` `/api/agreement/owner-tenant-html`：Body 同上，返回替换变量后的 HTML（`{ ok: true, html }` 或错误）。
  - `POST` `/api/agreement/is-data-complete`：Body `{ email, agreementId }`，资料是否齐（可生成 PDF）。
  - `POST` `/api/agreement/prepare-for-signature`：Body `{ email, agreementId }`，资料齐时生成 draft PDF、hash_draft、status=ready_for_signature。
  - `POST` `/api/agreement/try-prepare-draft`：Body `{ email, agreementId }`，Hook 1：资料齐则生成 draft PDF（幂等）。
- **代码：** `src/modules/agreement/agreement.service.js`、`agreement.routes.js`、`google-docs-pdf.js`（Google Docs/Drive 封装）。数据来自 MySQL：agreement、agreementtemplate、tenancy、tenantdetail、roomdetail、propertydetail、operatordetail、ownerdetail；关联一律用 `_id`。
- **闭环：** Agreement 从创建到最终合约已闭环。Tenancy setting 做 tenancy agreement（tenant_operator/owner_tenant），Property/ownersetting 做 management agreement（owner_operator）；创建必带 agreementtemplate_id、默认 pending；manual upload 写 url 则 completed+columns_locked。两段 Hook：① 资料齐 → try-prepare-draft 生成 draft PDF；② 两方签齐 → 签名接口内 afterSignUpdate 自动生成 final PDF、hash_final、completed、columns_locked。两方谁先签均可；第一人签后 status=locked。DB：0053（hash_draft/hash_final/version）、0054（*_signed_ip）、0055（columns_locked）。**完整流程：** [docs/db/agreement-flow-create-to-final.md](./db/agreement-flow-create-to-final.md)；**执行全部 migration：** [docs/db/run-all-migrations-paste.md](./db/run-all-migrations-paste.md)。

### Bank bulk transfer 批量转账（Node API）

- **API：** `POST` `/api/bank-bulk-transfer`。Body `{ email?, bank?, type?, ids? }`。不传 `bank` 时仅返回 `{ banks: [{ label, value }] }`（不校验 email）；传 `bank` + `type` + `ids` 时需传 `email`，返回 `{ success, billerPayments, bulkTransfers, accountNumber, skippedItems? }` 或 `{ success: false }`。另有 `POST /api/bank-bulk-transfer/files`、`POST /api/bank-bulk-transfer/download-url` 返回 Excel 或 zip 下载。`type`：`supplier`（bills）或 `owner`（OwnerPayout）。单次最多 99 条。
- **数据与 Reference：** 数据来自 MySQL：bills（supplierdetail_id → supplierdetail）、propertydetail（water、electric、wifi_id、unitnumber 等）、supplierdetail（utility_type、billercode、bankdetail_id 等）、bankdetail、ownerpayout、ownerdetail、client_profile（accountNumber）。**JomPay Column B Reference 1（户号）** 仅当 **supplierdetail.utility_type** 为 `electric`/`water`/`wifi` 时从 **propertydetail** 取：water→propertydetail.water，electric→propertydetail.electric，wifi→propertydetail.wifi_id（无则 wifidetail）；utility_type 为空视为普通 supplier（走 bank transfer，用 bankdetail）。
- **资料不齐与 errors.txt：** 若某笔缺 Biller Code、缺银行资料、或 utility 缺 Reference，该笔不会放入 JomPay/Bulk Transfer，会写入 **skippedItems**；下载 zip 时若存在 skippedItems 会包含 **errors.txt**，列出未纳入的 item 及原因（如「请填写 propertydetail.wifi_id」）。详见 [cms-field-to-mysql-column.md](./db/cms-field-to-mysql-column.md)。
- **代码：** `src/modules/bankbulktransfer/bankbulktransfer.service.js`、`bankbulktransfer-excel.js`、`bankbulktransfer.routes.js`。

### Tenant Invoice 发票/租金页（ECS 迁移）

- **数据表：** 列表与写操作用 **`rentalcollection`**（FK：client_id、property_id、room_id、tenant_id、type_id、tenancy_id）；类型/物业下拉用 propertydetail、account、tenancy、meter 等。
- **API：** `POST /api/tenantinvoice/properties`、`/types`、`/rental-list`、`/tenancy-list`、`/meter-groups`、`/rental-insert`、`/rental-delete`、`/rental-update`、`/meter-calculation`；均需 body `email`，由 access 解析 client。Topup 用 **backend/saas/billing**（`getCreditPlans`、`startNormalTopup`、`getMyBillingInfo`）。
- **前端：** Portal Next.js 租客门户 / Operator 发票与租金页。**Meter 报告分摊：** #dropdownsharing 仅三选一（Percentage、Divide Equally、Room (Active Only)），与 [meter-billing-spec.md](./meter-billing-spec.md) 及 Meter Setting 一致。
- **导入：** 先 `truncate-rentalcollection.js`（可选），再 `import-rentalcollection.js rentalcollection.csv`（CSV ID→wix_id，*_id 由各表 wix_id 解析）；可选 0041 补回 _id、0042 确保 FK。见 [rentalcollection-import-steps-powershell.md](./db/rentalcollection-import-steps-powershell.md)。

### Expenses 费用页（完成版）

- **数据表：** 全部读写 **`bills`**。列表/筛选/新增/删除/标记已付/批量操作均通过 ECS 的 `/api/expenses/*`，数据来自 MySQL：bills、propertydetail（shortname）、supplierdetail。
- **API 一览：** `POST /api/expenses/list`（列表/分页/limit 缓存）、`/api/expenses/filters`（property/type/supplier 下拉）、`/api/expenses/ids`、`/api/expenses/selected-total`、`/api/expenses/insert`、`/api/expenses/delete`、`/api/expenses/update`、`/api/expenses/bulk-mark-paid`；模板与下载见 `/api/expenses/bulk-template-file`、`/api/expenses/download-template-url`。所有接口需 body `email`，由 access context 解析 client。
- **前端：** Portal Next.js Operator 费用页。银行下载：单次最多 500 条，>99 条时后端自动拆成多文件打成一个 zip（JP01/JP02…、PM01/PM02…、errors.txt）。
- **代码：** `src/modules/expenses/expenses.service.js`、`expenses.routes.js`、`expenses-template-excel.js`。

### Admin 页（admindashboard）

- **数据表：** **feedback**（0038 + 0044 done/remark）、**refunddeposit**（0001 + 0045 done/room_id/tenant_id/client_id）。列表/更新/删除均通过 ECS `/api/admindashboard/*`，按 client_id 鉴权。
- **API 一览：** `POST /api/admindashboard/list`（支持 filterType、search、sort、page、pageSize、limit，与 expenses 一致做 cache + server 分页）、`/api/admindashboard/feedback/update`、`/api/admindashboard/feedback/remove`、`/api/admindashboard/refund/update`、`/api/admindashboard/refund/remove`。所有接口需 body `email`，由 access context 解析 client。
- **前端：** Portal Next.js Operator Admin 页。Topup 与 Billing、Expenses 等共用同一 API：`getMyBillingInfo`、`getCreditPlans`、`startNormalTopup`。
- **代码：** `src/modules/admindashboard/admindashboard.service.js`、`admindashboard.routes.js`。

### Agreement Setting 页（协议模板）

- **数据表：** **agreementtemplate**（id、client_id、title、templateurl、folderurl、html、mode、created_at、updated_at）。列表/新建/更新/删除/生成 HTML 均走 ECS `/api/agreementsetting/*`。
- **API 一览：** `POST /api/agreementsetting/list`（search、sort、page、pageSize、limit）、`/api/agreementsetting/filters`（modes）、`/api/agreementsetting/get`、`/api/agreementsetting/create`、`/api/agreementsetting/update`、`/api/agreementsetting/delete`、`/api/agreementsetting/generate-html`、**`/api/agreementsetting/preview-pdf-download`**（见下）、`/api/agreementsetting/variables-reference`。所有接口需 body `email` + apiAuth（token + X-API-Username），由 access 解析 client。HTML：`generate-html` 使用 **Drive API** 将 Google Doc 导出为 HTML 后写入 `agreementtemplate.html`。
- **Preview PDF（模板预览）：** 保存模板时（Doc + Folder URL）后端用 **Node + Google API** 异步生成预览 PDF → 上传 OSS 并写入 `agreementtemplate.preview_pdf_oss_url`。Operator 点击 Preview 时，后端仅从 **OSS** 流式返回 PDF：`POST /api/agreementsetting/preview-pdf-download`（body: email、id），返回 `application/pdf` 附件；未生成时返回 404 `PREVIEW_NOT_READY`。详见 [agreement-template-preview-node.md](./agreement-template-preview-node.md)。
- **Portal（Next.js）：** Operator **Agreement Setting**（/operator/agreement-setting）每模板行有 **Preview**，调用 `downloadAgreementPreviewPdf(templateId)` → `preview-pdf-download`，触发浏览器下载。**Agreements**（/operator/agreements）列表每条约稿有 **Preview**，用真实变量生成/打开 draft PDF（`getAgreementDraftPdf` → `prepare-for-signature`）。
- **代码：** `src/modules/agreementsetting/agreementsetting.service.js`、`agreementsetting.routes.js`；`src/modules/agreement/agreement.service.js`、`html-to-pdf.js`；路由挂载 `app.use('/api/agreementsetting', apiAuth, agreementsettingRoutes)`。

### Meter Setting 页（电表分组与分摊）

- **Portal 列表「Balance」**：`meterdetail.balance` 与 CNYIOT 一致存的是 **剩余 kWh**，不是 RM。Operator 页展示为 **kWh 为主**；prepaid 时另显示 **≈ RM（rate × kWh）** 作金额参考。例：rate **RM 5/kWh**、充值 **RM 10** → DB **+2 kWh**，正确展示为 **「2 kWh」** 与 **「≈ RM 10.00」**；若仍见 **「RM 2.00」** 是**旧版前端静态资源**，未执行 Next build。**改 `docs/nextjs-migration` 后必须**：仓库根目录 `npm run build:portal`（或 `cd docs/nextjs-migration && npm run build`）再 `pm2 restart portal-next`；**仅 `pm2 restart` 不会更新页面**。
- **数据与 API：** 电表列表/筛选/详情/更新/删除/新增、分组（parent/child/brother）均走 **backend/saas/metersetting**（ECS）。**#dropdownsharing** 仅三选一：Percentage、Divide Equally、Room (Active Only)，与 tenancy 无关；业务规则见 [meter-billing-spec.md](./meter-billing-spec.md)（AUTO/MANUAL、Prepaid/Postpaid、12 种组合）。代码：`src/modules/metersetting/metersetting.service.js`、`metersetting.routes.js`。
- **Top-up / Clear kWh / Sync（CNYIOT）行为约定：**
  - **Operator / Tenant Top-up（充值）**：目标是 **有余额则 Active=true 并通电**（prepaid：kWh 余额；RM 按 `amount / rate` 换算）。
    - **后端步骤**：① CNYIOT `sellByApi` + `sellByApiOk`（operator 走 byMoney）；② **DB 立刻写入** `meterdetail.balance`；prepaid 且 **新余额 > 0** 时 `status = 1`，否则 `status = 0`；③ **prepaid 且新余额 > 0**：`updateMeterStatus(true)` + 若首次 `setRelay Val=2` 失败则 **平台主账号再试一次**，确保从 0 充值后有电。
  - **Operator Clear kWh（清零）**（仅 prepaid）：目标是 **balance=0** 且 **Active=false**（系统断电/关闸）。
    - **后端步骤**：① CNYIOT `clearKwh`；② **DB 立刻写入** `meterdetail.balance=0` 且 `meterdetail.status=0`；③ 下发继电器 **断开**：`setRelay Val=1`（Active OFF）。
  - **Sync Meter（手动同步）**：CNYIOT 在指令刚下发时可能返回 `s=6` / `met_status=等待下发`（设备状态未落地）。
    - **约定**：仅当 `s=3`（在线通电）或 `s=4`（在线断电）这种明确状态时，sync 才会用设备数据覆盖 `balance/status`；否则保留 portal 刚写入 DB 的 `balance/status`，避免 topup/clear 结果被“中间态”覆盖。
    - **Prepaid 且合并后余额 ≤0**：无论此前 UI 是否误显 Active ON，sync 写入 `meterdetail.balance`（合并后的 `balanceUse`）后若 **prepaid** 且 **余额 ≤0**，强制 **`status=0`** 并下发 **`setRelay Val=1` 断电**（与 CNYIOT 读数为 0 一致时关闸）。若 `s=6` 仍保留 portal 正余额，则不会误断。
  - **Meter Active 与 Room 无关**：`meterdetail.status`（Active ON/OFF）只控制该电表的继电器（通电/断电），**不参与** room 是否可租。房间可租由 **tenancy** 决定（`roomdetail.available` / `availablesoon` / `availablefrom` 仅由 tenancy 日期与 cron 同步）；meter 断电 ≠ 房间不可租。
  - **与 `roomdetail.active` 无联动**：topup / clear kWh / `update-status` / sync **不会**调用 Room Setting，也 **不会**把 `roomdetail.active` 设为 0。业务上允许：**房间在 Portal 仍为 Active（上架）**，同时 **电表 Active=OFF（无电）**。

### Owner Setting 页（业主）

- **数据表：** **ownerdetail**、**propertydetail**（owner_id）、**owner_client**、**owner_property**、**agreement**（owner 邀请待签）。列表按「本 client 的业主」一行一个 owner，展示 ownername \| property A, B（仅本 client 下物业）；同人按 email 合并去重。
- **API 一览：** `POST /api/ownersetting/list`（search、page、pageSize、limit）、`/api/ownersetting/filters`、`/api/ownersetting/search-owner`、`/api/ownersetting/property`、`/api/ownersetting/agreement-templates`、`/api/ownersetting/properties-without-owner`、`/api/ownersetting/save-invitation`、`/api/ownersetting/delete-owner`（从物业解绑）、`/api/ownersetting/remove-owner-mapping`（删 owner_client）。所有接口需 body `email` + apiAuth，由 access 解析 client。
- **前端：** Portal Next.js Operator Owner Setting 页。Topup 用同一 API（getMyBillingInfo、getCreditPlans、startNormalTopup）。
- **代码：** `src/modules/ownersetting/ownersetting.service.js`、`ownersetting.routes.js`；路由挂载 `app.use('/api/ownersetting', apiAuth, ownersettingRoutes)`。

### Smart Door Setting 页（门锁/网关与 child lock）

- **数据与 API：** 列表/筛选/详情/更新/新增门锁与网关均走 **`POST /api/smartdoorsetting/*`**（ECS，`smartdoorsetting.routes.js`）。主要路由：`list`、`filters`、`get-lock`、`get-gateway`、`update-lock`、`update-gateway`、`unlock`、`preview-selection`、`insert-smartdoors`、`sync-name`、`sync-status-from-ttlock`（**Refresh status**，合并 TTLock → 已有行）、`delete-lock`、`delete-gateway`、`child-lock-options`。
- **Portal Next.js Operator（`/operator/smart-door`）：** 与 Wix 页等价业务，代码在 `docs/nextjs-migration/app/operator/smart-door/page.tsx`，API 在 `lib/operator-api.ts`。**Sync Lock（顶栏）**：打开弹窗，`preview-selection` 只返回**未入库**设备；弹窗内 Sync 拉列表，Save Selected → `insert-smartdoors`。**Refresh status（列表卡片）**：`syncSmartDoorStatusFromTtlock()` → `sync-status-from-ttlock`，更新已在库锁的电量与是否绑网关、网关在线与连接锁数等。**TTLock `/v3/lock/list`**：以官方字段 **`hasGateway`**（1/0）判断锁是否绑网关；勿依赖列表里的 `gatewayId`（通常不存在）。合并实现：`fetchTtlockLockListAndMergeToDb`、`fetchTtlockGatewayListAndMergeToDb`、`syncSmartDoorStatusFromTtlock`（`smartdoorsetting.service.js`）。
- **Child lock 下拉选项：** 由后端 `getChildLockOptions(excludeLockId)` 提供（`POST /api/smartdoorsetting/child-lock-options`）。后端排除：当前父锁自身、已用于 Property（propertydetail.smartdoor_id）、已用于 Room（roomdetail.smartdoor_id）、**已是其他门锁 child 的锁**（任一 lock 的 childmeter 中已出现的 id，当前父锁除外），保证一个门锁只能当一个父锁的 child。
- **前端 repeater（Wix #repeaterchildsmartdoor / #dropdownchildsmartdoor）：** 每行以 `row._id` 识别；onChange/关闭钮用 `row._id` 更新或删除对应行，避免删除中间行后 index 错位导致选中值丢失。选项在 `applyChildDropdownOptionsToRepeater(dataOverride)` 中统一重算（排除本页其他行已选 doorId），再设 options 与 value。
- **代码：** `src/modules/smartdoorsetting/smartdoorsetting.service.js`、`smartdoorsetting.routes.js`。

### Tenancy Setting 页（租约 / 延租 / 换房 / 终止）

- **数据与 API：** 列表/筛选/延租/换房/终止/取消预订/协议均走 **backend/saas/tenancysetting**（ECS）。路由：`/api/tenancysetting/list`、`/filters`、`/rooms-for-change`、`/change-preview`、**`/extend-options`**、`/extend`、`/change`、`/terminate`、`/cancel-booking`、`/agreement-templates`、`/agreement-insert`；均需 body `email`。
- **房间可租（roomdetail）：** 按 **tenancy 日期** 更新：只认「今天落在 [begin, end] 内」的 tenancy（同一房可有 2025/2026 多笔）；每日 cron 同步 available/availablesoon/availablefrom，extend/change/terminate 后也会单房更新。
- **延租 #datepickerextension：** 可延到**任意一天**（不强制对齐 billing cycle）；最后不足整月的一段按 **prorate** 入 rentalcollection。若同房已有下一笔 booking，最多延到 **下一笔 begin 的前一天**。`POST /extend-options` 返回 `{ paymentCycle, maxExtensionEnd }`（paymentCycle 仅作参考）；`/extend` 会校验 `EXTEND_EXCEEDS_NEXT_BOOKING`。租约 **活跃**（`active=1` 或 null）时 **`extendTenancy`** 会调 **`setTenancyActive`**，把 TTLock **物业+房门**（0130）有效期延到新的 `tenancy.end`。
- **换房 `/change`：** 除 DB/账单外，会 **`ttlockOnChangeRoomBeforeUpdate`**（删旧房门 PIN；换物业则删旧物业门 PIN；父锁同名一并删）→ 更新 `room_id` → **`ttlockOnChangeRoomAfterUpdate`**（新房 `add`、必要时新物业 `add`，再 `setTenancyActive`；欠租 `active=0` 时 **`extendLocksOnly`**，不自动合闸）。详见上文「近期更新」Tenancy + TTLock。
- **终止 `/terminate`：** 在写 `status=0`、`end=昨天` 前调用 **`removeTenancySmartDoorPasscodes`**（TTLock delete + 清空密码列）。
- **Extend 的 Commission：** 不写死 6 个月；按 **client 的 commission 配置** + **本次 extend 的期数（月数）** 决定规则（延 3 个月跟 3 个月 rules、延 6 个月跟 6 个月 rules）；commission 行实现待接 client admin 后生成，首尾段 prorate。详见 [tenancysetting-extend-agreement-summary.md](./tenancysetting-extend-agreement-summary.md)。
- **后端代码：** `src/modules/tenancysetting/tenancysetting.service.js`、`tenancy-active.service.js`。
- **前端与 API：** 详见 [readme/index.md#tenancy-setting-页](./readme/index.md#tenancy-setting-页tenancysetting)。API：getExtendOptions、extendTenancy 等。

### 沟通记录（摘要）

- **架构：** 前端 Next.js（Portal / Operator / SaaS Admin）、后端 Node、数据库 MySQL；图片等用阿里云 OSS。
- **表/列不确定：** 先与维护者确认再写代码。
- **外键统一用 _id：** Node 里一律用 `client_id`、`property_id` 等；Import 时 CSV 的 `_id` 直接写入 `id`。

### 已移除

- `test.routes.js` 已删除；仅上表所列 wrapper 为正确入口。

### Malaysia e-invoice (MyInvois)

- Invoice / Credit note（销售与采购）validator 支持 `myinvois_action`: `NORMAL` | `VALIDATE` | `EXTERNAL`。
- 业务规则（仅开启 e-invoice 且 contact 资料完整才走 MyInvois，否则走 NORMAL）在 service 层实现，不在 wrapper。
