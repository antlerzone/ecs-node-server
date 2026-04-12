# Coliving SaaS 物业管理平台 — 使用教程

本教程说明如何理解与使用本系统（前端 Wix / 后端 Node / 数据库 MySQL），涵盖架构、角色、日常操作与定时任务。

---

## 一、系统概览

### 1.1 这是什么？

- **Coliving SaaS 物业管理后端**：供物业管理公司（Operator）使用的多租户平台。
- **核心能力**：租约与房间、租金与发票、电表/门锁、会计对接（Xero/Bukku/AutoCount/SQL）、Stripe 支付、业主/租客门户等。
- **架构**：前端在 Wix，后端在 Node（ECS），数据在 MySQL；图片/文件用阿里云 OSS。

### 1.2 架构图（概念）

```
┌─────────────┐     HTTPS      ┌─────────────────┐     MySQL     ┌──────────┐
│  Wix 前端   │ ◄─────────────► │  Node 后端 (ECS) │ ◄───────────► │   MySQL  │
│ (各 client  │   token+username │  Express API     │               │  数据库   │
│  subdomain) │                 │  clientresolver  │               └──────────┘
└─────────────┘                 └────────┬────────┘
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
              ┌──────────┐         ┌──────────┐          ┌──────────┐
              │  Stripe   │         │  Bukku   │          │  OSS     │
              │  支付     │         │  会计等  │          │  存储    │
              └──────────┘         └──────────┘          └──────────┘
```

- **图 1**：Wix 用 Secret Manager 的 `ecs_token`、`ecs_username`、`ecs_base_url` 调 ECS；ECS 从 host/header 解析当前 client，再读写 MySQL 与第三方。

### 1.3 三种使用角色（简要）

| 角色 | 入口 | 主要功能 |
|------|------|----------|
| **Operator（运营/员工）** | Wix 各 client 子域名 / 或 Portal `/operator` | 公司设置、物业/房间、租约、发票、费用、Admin、Billing、门锁/电表设置等 |
| **Tenant（租客）** | Tenant Dashboard / Portal 租客入口 | 个人资料、签约、付租金/发票、电表用量与充值、门锁、反馈 |
| **Owner（业主）** | Owner Portal | 查看物业与报表、协议等 |

---

## 二、环境与部署（给开发/运维）

### 2.1 后端运行

- **安装**：`npm install`
- **启动**：`npm run dev`（开发）或 `npm start`（生产，`node server.js`）
- **环境变量**：见项目根目录 `.env.example` 或文档，必含 MySQL、Stripe、CRON_SECRET、API 认证等。

### 2.2 Wix 调用 ECS（双重认证）

- 在 Wix **Secret Manager** 配置：
  - `ecs_token`：API 用户 token（与 `api_user` 表一致）
  - `ecs_username`：API 用户名
  - `ecs_base_url`：ECS 根地址（如 `https://api.example.com`）
- 每次请求需同时带：
  - `Authorization: Bearer <ecs_token>`
  - `X-API-Username: <ecs_username>`
- **图 2**：Wix JSW 用 `getSecret('ecs_token')` 等取凭证，再 `fetch(baseUrl + path, { headers })` 调 ECS。

### 2.3 数据库迁移

- 迁移文件在 `src/db/migrations/`。
- 执行单条：`node scripts/run-migration.js src/db/migrations/0093_saasadmin_table.sql`
- 执行全部：见 `docs/db/run-all-migrations-paste.md`。

### 2.4 每日定时任务（Cron）

- **接口**：`POST /api/cron/daily`
- **请求头**：`X-Cron-Secret: <CRON_SECRET>`（与 .env 一致）
- **建议**：每天 00:00（UTC+8）用系统 cron 或云函数调用一次。
- **图 3**：Cron 依次执行 8 步（见下一节）。

---

## 三、每日 Cron 做什么（8 步）

| 步骤 | 名称 | 说明 |
|-----|------|------|
| 1 | 欠租检查 | 过去到期未付的租金 → 对应 tenancy 锁门、断电、active=0 |
| 2 | 房间可租同步 | 按 tenancy 日期更新 roomdetail.available / availablesoon / availablefrom |
| 3 | Refund deposit | 租约 end 已过且未续约、deposit>0 → 写入 refunddeposit，Admin 可见并处理 |
| 4 | Pricing plan 到期 | client 方案过期未续 → client 设为 inactive |
| 5 | Core credit 到期清空 | 到期 core credit 移除并写 creditlogs（含到期日） |
| 6 | 每月 1 号 active room 扣费 | 每间 active 房扣 10 credit，幂等同月不重复 |
| 7 | Stripe 入账 | 对未入账的 stripepayout 做会计分录（DR Bank / CR Stripe） |
| 8 | 门锁电量 <20% | 写入 feedback 表 |

- 详细步骤与逻辑见 `docs/cron-daily-setup-step-by-step.md`。

---

## 四、Operator 日常使用（Wix 或 Portal）

### 4.1 登录与门禁

- Operator 为 **staff**，用 Wix 登录或 Portal `/operator` 登录。
- 后端通过 `POST /api/access/context`（带 email）返回：staff、client、plan、credit、capability（含 permission）。
- **门控**：
  - 公司 Profile 未填好前，Admin Dashboard 仅 Profile / User Setting / Integration / Topup 可点；#buttonadmin、#buttonagreementlist 填好后才启用。
  - 各页按 permission 显示/隐藏入口（如 billing、propertylisting、tenantdetail、finance 等）。

### 4.2 公司设置（Company Setting）

- 填写公司资料（client.title 等）、User Setting（员工列表）、Integration（会计 Xero/Bukku/AutoCount/SQL、Meter CNYIOT、Smart Door TTLock）。
- **主账号**：clientdetail.email = Company Email，在 Staff 列表中不可编辑，具全权限。

### 4.3 物业 / 房间 / 租约

- **Property Setting**：物业列表、详情、车位、业主协议。
- **Room Setting**：房间列表、可租状态、关联电表/门锁。
- **Tenancy Setting**：租约列表、延租、换房、终止、取消预订、协议（tenant_operator / owner_tenant / owner_operator）。

### 4.4 发票与租金（Tenant Invoice）

- 列表与筛选、新增/编辑/删除 rentalcollection；Meter 组与用量、分摊方式（Percentage / Divide Equally / Room）。
- Topup 与 Billing 共用 backend/saas/topup；金额 >1000 走 manual 工单。

### 4.5 费用（Expenses）

- 列表、筛选、新增/删除、标记已付、批量上传、银行批量（JomPay/Bulk Transfer）；单次最多 99 条，>99 自动拆成多文件 zip。

### 4.6 Admin Dashboard

- Feedback 列表与详情、Refund 列表；Refund 可编辑退款金额（≤ 原金额），差额作 forfeit，Mark as refund 时写会计 journal。

### 4.7 Billing 与 Credit

- 方案与 addon、Credit 余额、流水（credit-statements、statement-items）、导出 Excel；Stripe Checkout 付方案/充值；金额 ≥1000 走 manual 工单。

---

## 五、Tenant 使用（租客）

- **Profile 优先**：未填好 sectionprofile 前只启用 #buttonprofile；完成后才出现待签 agreement。
- **未签合约时**：只启用 #buttonagreement 与 #dropdownproperty；Meter / Smart Door / Payment / Feedback 禁用。
- **租金未还**：当前选中物业若有未付租金，Meter、Smart Door 禁用。
- **功能**：付租金（Stripe Checkout）、付发票、电表用量与充值、门锁、上传 feedback/NRIC 到 OSS。

---

## 六、Stripe 支付（三种场景）

1. **Client 充值 credit**：`POST /api/stripe/create-checkout-credit-topup` → 跳转 Stripe 支付 → webhook 写 client_credit。
2. **Tenant 付租金**：Stripe Connect；平台先收，按 client credit 是否足够 1% 决定是否 release 到 Connect。
3. **Tenant 付发票 / Meter 充值**：`POST /api/tenantdashboard/create-payment`（type=invoice 或 meter）→ Checkout → webhook 更新 rentalcollection 或 metertransaction。

---

## 七、会计对接（四系统）

- 每个 client 仅对接一个会计系统：**Xero / Bukku / AutoCount / SQL**。
- 六类流程已封圈：Meter invoice+receipt、Rental collection、Expenses、Owner payout、Refund deposit、Forfeit deposit。
- Account 设定页只写 **account_client**（科目映射）；account 表为全站科目范本。

---

## 八、数据导入（简要）

- 主表与子表：clientdetail + 4 子表见 `docs/db/import-operatordetail.md`。
- 其他表：tenantdetail、ownerdetail、propertydetail、roomdetail、tenancy、bills、agreementtemplate、account、creditplan、meterdetail、pricingplan、rentalcollection 等，见 `docs/index.md` 脚本速查与流程总览。
- **0087 后**：CSV 的 `_id` 直接写入 `id`；reference 列直接写入对应 `_id`；新 insert 由后端 `randomUUID()` 生成。

---

## 九、文档与脚本速查

- **文档入口**：`docs/index.md`（含文档目录、Stripe、Cron、门禁、各页说明）。
- **脚本**：`clear-and-import-operatordetail.js`、`import-rentalcollection.js`、`run-migration.js`、`insert-api-user.js` 等，见 `docs/index.md` 表格。
- **Wix JSW**：`docs/wix/jsw/`；**Wix 前端**：`docs/wix/frontend/`（各 *-page-full.js）。

---

*本教程基于当前代码与文档整理，具体字段与 API 以代码与 `docs/index.md` 为准。*
