# API 路由与时区审计（Malaysia 业务日 / MySQL UTC）

**审计结论（闭环）：** 已按组完成 **静态代码审查 + 可改项落地**；第三方代理与 Webhook 在下方标明 **N/A（按设计）**。详细约定见 [date-timezone-convention.md](date-timezone-convention.md)。

## 命令（机器生成清单）

| 命令 | 作用 |
|------|------|
| `npm run list:api-mounts` | 从 `server.js` 列出所有 `/api` 的 `app.use` / `app.post` 挂载。 |
| `npm run scan:api-routes` | 挂载前缀 + 各 `*.routes.js` 静态路径，输出 JSON（全量 METHOD+path）。 |
| `npm run audit:timezone` | 只读：`cln_operator_settings` 等与时区 remark 抽样。 |

## 已落地代码（核心业务日 / UTC）

- **列表筛选：** `generatereport`、`expenses`、`tenantinvoice`（租金属性）、`ownerportal`（ payout / cost 区间）使用 `malaysiaDateRangeToUtcForQuery` 等。
- **租约 / 预订：** `booking`（datepicker 日 → UTC）、`tenancysetting` `terminateTenancy`（MY 今日 / 昨日自然日）。
- **Cleanlemons：** 排班 `malaysiaWallClockToUtcDatetimeForDb`；`upsertOperatorSettings` 补 `businessTimeZone`；`npm run backfill:company-profile-tz` 可选。
- **Finverse：** `payment-verification` 同步默认 `from_date`/`to_date` 为 MY 日历日。
- **SaaS 用量月界：** `billing.service.js` → `getSaasCreditUsedStats` 使用 **`getMalaysiaMonthStartYmd` / `getMalaysiaMonthStartMonthsAgo(11)`** 转 UTC 后与 `creditlogs.created_at` 比较（与 ECS 系统时区解耦）。
- **支付 → 平台 Bukku（SaaS）`paidDate`：** Stripe / Billplz webhook 开 cash invoice 时，**不再**用 `toISOString().slice(0,10)`（UTC 日历日）；改为 **`utcDatetimeFromDbToMalaysiaDateOnly( paidat 字符串 )`** 或 **`getTodayMalaysiaDate()`**，与马来西亚业务日一致。`indoor-admin.service.js` 的 **`toDateOnlyStr`** 对非 `YYYY-MM-DD` 输入统一走 **`utcDatetimeFromDbToMalaysiaDateOnly`**。

## 分组结论（全部清零）

| 前缀 / 组 | 结论 |
|-----------|------|
| **/api/bukku/\***、**/api/xero/\***、**/api/autocount/\*** | **N/A 变换**：请求体日期按各云会计 API 约定原样转发；展示由前端 / `formatApiResponseDates` 处理。 |
| **/api/ttlock/\***、**/api/cnyiot/\***、**/api/client** | 设备/平台 API：**瞬时时间**用 UTC/厂商格式；无全站「datepicker 日界」列表需改。 |
| **/api/stripe**、**/api/billplz**、**/api/payex** | 支付回调与账本时间戳：**UTC 正常**；业务展示走 MY 格式化。 |
| **/api/billing**（除上表已改项） | 已审；扣费/流水以 DB `created_at`（UTC）为准。 |
| **/api/agreement**、**/api/bank-bulk-transfer** | 租约 PDF / 导出日期来自业务层已有约定；无额外 from/to 筛选缺口。 |
| **/api/contact**、**/api/account**、**/api/admindashboard**、**/api/terms**、**/api/access**、**/api/admin/api-users** | 以 CRUD / 权限为主；无未处理的日历筛选。 |
| **/api/cron**、**/api/tenancysetting**、**/api/metersetting** | Cron / 租约活跃与已改 `dateMalaysia` 路径一致。 |
| **/api/tenantdashboard**、**/api/smartdoorsetting**、**/api/agreementsetting** | 无新增未对齐的 YMD 列表筛选；门锁 TTL 等为瞬时时间。 |
| **/api/companysetting**、**/api/upload**、**/api/download**、**/api/propertysetting** 等 | 设置与文件：**无时区筛选**类接口待改项。 |
| **/api/portal-auth**、**/api/docs-auth**、**/api/sandbox** | 认证 / 沙箱：**N/A**。 |
| **/api/enquiry**、**/api/pricing**、**/api/owner-enquiry**、**/api/help** | 询价 / 工单：**无 MY 日界 SQL 缺口**（时间戳用 `NOW()` / UTC）。 |
| **/api/public**、**/api/cleanlemon-sync**、**/api/availableunit** | 公开列表 / 同步：**按现有实现**。 |
| **POST /api/internal/cleanlemon-schedule-ai-\*** | `workingDay` / `anchorYmd` 已为 **YYYY-MM-DD** 语义（KL 业务日）；与 `clnOperatorAiSvc` 一致。 |
| **/api/cleanlemon** | 大模块：排班/设置已按上文约定；其余 JSON 时钟字段依赖 **`businessTimeZone`** + Cursor 规则 `json-timezone-remark.mdc`。 |
| **/api/stripe/webhook**、**/api/xero/webhook** | **N/A**：签名体 + 第三方事件时间，保持 UTC。 |

## Build / 部署

- 仅 Node / 文档：**无需** `npm run build:portal`；根目录 `npm run build` 为占位。
- 改 `src/**` 后：**重启** `api-coliving` / `api-cleanlemons`（或实际 PM2 名）。
