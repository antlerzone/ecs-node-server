# Wix 页面类型约定（Public / Client / Indoor）

三类页面定义与示例，便于开发与沟通时统一用语。

---

## 1. SaaS Client Page（需 permission 的页面）

- **定义：** 需要 **staff permission** 才能进入或操作的功能页，即 **SaaS 的 client 端页面**（客户公司员工使用的后台）。
- **门禁：** 使用 `getAccessContext()`，通过后按 `accessCtx.staff.permission` 控制各页/按钮（见 [ACCESS-DENIED-CONVENTION.md](./jsw/ACCESS-DENIED-CONVENTION.md)）。
- **示例：**  
  Company Setting、Admin Dashboard、Billing、Account Setting、Room/Property/Smart Door/Meter/Agreement/Owner/Contact Setting、Tenancy Setting、Booking、Expenses、Generate Report、Help、Tenant Invoice（员工侧）等。
- **PC-only 页（无 mobile 版）：** Company Setting、Account Setting、Property Setting、Room Setting、Agreement Setting、Contact Setting、Billing、Expenses、Generate Report。这 9 页在移动端打开时用 `#textstatusloading` 显示 "Please open using PC" 并中止初始化。

---

## 2. Client 的顾客页（Public Page）

- **定义：** 面向 **client 的顾客**（租客、业主）的页面，即 client 的「对外」页；在本项目用语中称为 **public page**。另包含**新客户询价/注册页**（Enquiry），无需登录即可浏览方案并提交 demo 注册。
- **示例：**
  - **Owner Dashboard（Owner Portal）** — 业主端
  - **Tenant Dashboard** — 租客端
  - **Enquiry Page** — 新客户公开页：选国家 → 看定价方案/Addon → 填资料提交 demo 注册（client + staff + client_profile，is_demo=1）；不在此页支付，由 Indoor Admin 手動 billing 后设置 client active。前端 `backend/saas/enquiry`，ECS `POST /api/enquiry/*`。  
  上述 Owner/Tenant 页面使用 `getAccessContext()` 做登录/身份校验；Enquiry 页无需登录。

---

## 3. Indoor Admin（SaaS Manual Billing Page）

- **定义：** **SaaS 平台方**内部使用的页面，用于 **手動 billing**（manual topup / manual renew），即 **Indoor Admin** 或 manual billing page。
- **前端：** 调用 `backend/saas/indooradmin` 的 `manualTopup`、`manualRenew`；JSW 见 [velo-backend-saas-indooradmin.jsw.snippet.js](./jsw/velo-backend-saas-indooradmin.jsw.snippet.js)。
- **权限：** API 要求 admin 或 billing（`getAccessContextByEmail(email)` 的 staff permission）。
- **说明：** [billing-indoor-admin-bukku.md](../billing-indoor-admin-bukku.md)。

---

## 汇总

| 类型 | 说明 | 典型页面 |
|------|------|----------|
| **SaaS Client Page** | 需 permission；client 员工后台 | Company Setting、Room Setting、Booking、Billing、Admin Dashboard、Expenses、Tenant Invoice（员工）等 |
| **Public Page（Client 的顾客页）** | Client 的顾客端 / 新客户询价 | Owner Dashboard、Tenant Dashboard、**Enquiry Page** |
| **Indoor Admin** | 平台手動 billing | Saas-indoor-admin（manual topup / manual renew） |
