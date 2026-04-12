# Tenant Portal 功能对比表（Wix 旧版 vs Next.js 迁移版）

基于 Wix Tenant Dashboard 前端 + `backend/saas/tenantdashboard.jsw`、`backend/access/ttlockaccess.jsw`、`backend/integration/cnyiotapi` 与 Next.js `app/tenant/*`、`lib/tenant-api.ts`、`contexts/tenant-context.tsx` 的逐项对比。

---

## 1. 页面与入口

| 功能/页面 | Wix 旧版 | Next.js 迁移版 | 备注 |
|----------|----------|----------------|------|
| 主导航 | 单页 section 切换：Dashboard / Meter / Agreement / Smart Door / Payment / Profile / Feedback | 独立路由：Dashboard、Meter、Payment、Smart Door、Agreement、Profile、Feedback、Approvals | Next 多页面，Approvals 独立 |
| 物业/房间选择 | 主区 **Property 下拉**，按物业筛选 repeater 与 valid date | **Sidebar「Active Room」** 展示当前房间/物业，可展开多 tenancy 列表（仅展示，无筛选逻辑） | Wix 有显式 property 下拉；Next 以「当前 tenancy」为主，多 tenancy 仅展示 |
| 「非租客」提示 | 有：`You are not our tenant`，仅 Profile / Feedback 可用 | 无 tenant 时重定向到 `/tenant/profile`（ProfileGate） | 行为等价，文案不同 |
| 默认进入 | 进入后 `switchSection("tenantdashboard")` | 进入 `/tenant` Dashboard | ✅ |

---

## 2. Init / 初始化

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| init | `tenantDashboardInit()` → tenant + tenancies | `tenantInit()`，缓存在 TenantProvider | ✅ |
| 无 tenant 时 | setNoTenantState：禁用 property/meter/agreement/smartdoor/payment，保留 profile、feedback | 无 tenant 时除 profile 外重定向到 profile | ✅ |

---

## 3. Dashboard（主区）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 租客姓名 | `#texttenantname` = TENANT.fullname | 标题 "Welcome back, {fullname}" | ✅ |
| Property 下拉 | 有，按物业筛选 repeater、valid date、rent gate | **无**；用 Sidebar 的 Active Room 展示 | ⚠️ Next 无「按物业筛选」的 dropdown |
| Repeater 内容 | **混合**：① 待审批（approval）→ Approve/Reject；② 待签协议（agreement）→ Sign Agreement | **无** repeater；待办在 Dashboard 用 **Action cards**（Sign Agreement / Unpaid Invoices）链到 Agreement、Payment | 功能等价，入口不同 |
| 待审批行 | client title、Approve、Reject；approve 后 `syncTenantForClient` | 独立 **Approval 页**，Approve/Reject；**未调 syncTenantForClient** | ⚠️ Next 少 approve 后 accounting 同步 |
| 待签协议行 | "Property \| Pending Signing Agreement"、Sign Agreement → 打开签约弹窗 | Dashboard 卡片链到 Agreement 页 | ✅ |
| Valid Date | 当前物业下租约日期范围，≤60 天标红 | **无** 单独 valid date 文案 | ⚠️ Next 可考虑补 |
| 仪表盘 Meter 入口 | 显示首房间 balance（需另请求），Sync 按钮 | 有 balance、Sync，链到 /tenant/meter | ✅ |
| applyTenantProfileGate | 按 profile 完成 / 有无 tenancy / 有无未签协议 控制各按钮 enable | ProfileGate：未完成 profile 或无 tenant 重定向；meter/smartdoor 页检查 profileComplete、hasPendingAgreement、hasOverduePayment | ✅ 逻辑等价 |
| applyRentGateForCurrentProperty | 当前物业有未付租金则禁用 Meter、Smart Door | hasOverduePayment 时重定向到 /tenant/payment | ✅ |

---

## 4. Meter（电表）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 按房间 | 当前选中 property 下 tenancies[0].room | 多 tenancy 时可选 tenancy（Select），再取 room | ✅ |
| getRoomWithMeter / room | 有 | `room(roomId)` | ✅ |
| 同步电表 | `syncMeterByCmsMeterId`（CNYIoT）再 getRoomWithMeter | `meterSync(roomId)` | ✅ |
| 显示 balance / rate / currency | 有，balance&lt;50 标红 | 有，Postpaid 时禁用 topup、按钮文案 "Postpaid Mode" | ✅ |
| Top-up 金额下拉 | RM 10/20/30/40/50/100 | 10/20/50/100/200/500 | 可选值不同，功能一致 |
| createTenantPayment(type: meter) | 有，redirect to Stripe | `createPayment({ type: "meter", ... })` | ✅ |
| 用量报表 | getUsageSummary，日期范围，drawChart + 文本 | usageSummary，日期范围，图表 + 汇总 | ✅ |

---

## 5. Agreement（协议）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 列表来源 | 当前 property 下 tenancies，每 tenancy 取最新 agreement | tenancies 来自 context，按 tenancy 列出 agreements，分 pending / past | ✅ |
| getAgreementHtml | 有 | `agreementHtml(tenancyId, agreementTemplateId)` | ✅ |
| 签约 | 弹窗内 HTML + 签名框，updateAgreementTenantSign(tenantsign 文本) | 弹窗内 HTML + **Canvas 手写签名** → toDataURL，agreementUpdateSign(agreementId, dataUrl) | 实现不同；后端需支持图片签名 |
| 状态 | Pending Signing / Pending Other Party / Complete、View Agreement | Pending / 已签、View | ✅ |
| mode | owner_tenant / tenant_operator，otherSigned = owner 或 operator | 逻辑一致 | ✅ |
| getAgreement(agreementId) | 用于取最新状态、PDF url | agreementGet，用于 View | ✅ |

---

## 6. Smart Door（门锁）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 数据来源 | getPropertyWithSmartdoor(propertyId, roomId)，property.smartdoor + roomSmartdoor，lockIds | propertyWithSmartdoor(propertyId, roomId)；Next 用 **tenantTtlockPasscode(tenancyId)**、**tenantTtlockUnlock(tenancyId)** 等，以 tenancy 为维度 | 接口维度不同，功能等价 |
| 远程开门 | remoteUnlock(tenancyId, tenantId, lockId) 多 lock 循环 | tenantTtlockUnlock(tenancyId) | ✅ |
| PIN 显示/设置 | 从 tenancy.passcodes[0].password，createTenantPasscode / updateTenantPasscode | tenantTtlockPasscode、tenantTtlockPasscodeSave | ✅ |
| 多锁 | 支持 property + room 多个 lockId | 后端以 tenancy 聚合，前端单入口 | ✅ |

---

## 7. Payment（租金/发票）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| getRentalList(tenancyId) | 有 | rentalList(tenancyId) | ✅ |
| 列表字段 | dueDate, amount, isPaid, invoiceurl, receipturl, property | 同 | ✅ |
| 排序 | 未付优先、overdue 优先、再按 dueDate | 同（未付/overdue 优先） | ✅ |
| 多选 + Pay Now | 有，**最多选 10 笔**，createTenantPayment(type: invoice, metadata.invoiceIds) | 多选 + Pay Now，**未限制 10 笔** | ⚠️ Next 未做「最多 10 笔」限制 |
| Total 显示 | 有，"Total: RM xx (max 10 selected)" | 有 Outstanding Balance | 可选补 max 10 提示 |
| Overdue 标红 | 有 | 有（Overdue 状态） | ✅ |
| Invoice/Receipt 链接 | 有 | 有 | ✅ |

---

## 8. Profile（个人资料）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 无 tenant（访客） | 可填表，按钮 "Register"，updateTenantProfile 后 init 刷新 | 无 tenant 时仍可进 profile，依赖后端「按 email 创建/更新」 | ✅ |
| 字段 | fullname, email, phone, address, nric, bank, bankAccount, accountholder, entity_type, reg_no_type, tax_id_no, nricFront, nricback | 同（entity_type/reg_no_type 等） | ✅ |
| getBanks | 有 | fetchBanks / banks() | ✅ |
| NRIC 上传 | getUploadCreds + HTML upload → 得到 url 后写进 payload | uploadFile → 得到 url，写进 updateProfile | ✅ |
| 保存后 syncTenantForClient | 有，对 tenant.account 每项 clientId 调用 | **无** | ⚠️ Next 少 profile 保存后 accounting 同步 |
| 保存后刷新 | tenantDashboardInit，更新 TENANT/TENANCIES | refetch（tenantInit） | ✅ |
| 改密码/邮箱验证 | 无 | 有（Change Password 弹窗、EmailVerificationDialog） | Next 多 |

---

## 9. Feedback（反馈）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| submitFeedback | tenancyId, roomId, propertyId, clientId, description, photo[], video | feedback() 同参 | ✅ |
| 附件 | getUploadCreds + HTML upload，photo[]、video 单条 | uploadFile 多文件，photo 数组、video 单条 | ✅ |
| 描述必填 | 有 | 有 | ✅ |
| 历史列表 | 无 | **feedbackList()** + 展示 Previous Requests、状态、reply | Next 多「历史反馈」 |
| 分类 | 无 | 有 category（General/Maintenance/Billing 等） | Next 多 |

---

## 10. Approvals（待审批）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 数据来源 | tenant.approvalRequest 中 status===pending + getClientsByIds | tenant.approvalRequest + clientsByIds | ✅ |
| Approve | tenantApprove(clientId)，然后 **syncTenantForClient(clientId)** | tenantApprove(clientId)，**未调 syncTenantForClient** | ⚠️ Next 少 approve 后 sync |
| Reject | tenantReject(clientId) | tenantReject(clientId) | ✅ |
| Approve 后刷新 | tenantDashboardInit，重绑 repeater | refetch() | ✅ |

---

## 11. WhatsApp / 联系 Operator

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 按钮 | #buttonwhatsap，取 tenancy.client.contact 电话，跳 wasap.my | **无** 单独 WhatsApp 入口 | ⚠️ Next 可考虑在 Dashboard 或 Sidebar 加「联系 Operator」 |

---

## 12. API 覆盖（tenantdashboard.jsw → tenant-api.ts）

| API | Wix JSW | Next.js tenant-api | 备注 |
|-----|---------|---------------------|------|
| init | ✅ | tenantInit | ✅ |
| getClientsByIds | ✅ | clientsByIds | ✅ |
| getRoomWithMeter | ✅ | room | ✅ |
| getPropertyWithSmartdoor | ✅ | propertyWithSmartdoor | ✅ |
| getBanks | ✅ | banks | ✅ |
| updateTenantProfile | ✅ | updateProfile | ✅ |
| getUploadCreds | ✅ | — | Next 用 uploadFile 走 proxy |
| getAgreementHtml | ✅ | agreementHtml | ✅ |
| updateAgreementTenantSign | ✅ | agreementUpdateSign | ✅ |
| getAgreement | ✅ | agreementGet | ✅ |
| getRentalList | ✅ | rentalList | ✅ |
| tenantApprove | ✅ | tenantApprove | ✅ |
| tenantReject | ✅ | tenantReject | ✅ |
| syncTenantForClient | ✅ | syncTenantForClient | ✅ 已封装，**Approval/Profile 未调用** |
| submitFeedback | ✅ | feedback | ✅ |
| createTenantPayment | ✅ | createPayment | ✅ |
| (TTLock) remoteUnlock / createPasscode / updatePasscode | ttlockaccess.jsw | tenantTtlockUnlock, tenantTtlockPasscode, tenantTtlockPasscodeSave（走 tenantdashboard proxy） | ✅ |
| (CNYIoT) getUsageSummary / syncMeterByCmsMeterId | cnyiotapi | usageSummary, meterSync（走 tenantdashboard） | ✅ |
| feedback-list | — | feedbackList | Next 多 |
| request-email-change / confirm-email-change | — | requestEmailChange, confirmEmailChange | Next 多 |

---

## 13. 建议补全项（少功能/差异）

| 优先级 | 项目 | 说明 |
|--------|------|------|
| 高 | Approval 通过后调用 syncTenantForClient | 与 Wix 一致：若 operator 有 accounting，approve 后同步租客到其系统（find or create） |
| 高 | Profile 保存后调用 syncTenantForClient | 对 tenant.account 每项 clientId 调用 syncTenantForClient（best-effort） |
| 中 | Payment 最多勾选 10 笔 | Wix 限制单次 Pay Now 最多 10 条 invoice，避免超出 Stripe 限制；Next 可加同一限制与提示 |
| 低 | Dashboard 物业下拉 | 多物业时在 Dashboard 提供 property 下拉，筛选当前物业/valid date（或保留现有 Sidebar 房间切换并补 valid date 文案） |
| 低 | Valid Date 展示 | 当前租约起止日，≤60 天标红（可放在 Dashboard 或 Sidebar） |
| 低 | WhatsApp 联系 Operator | 取 tenancy.client.contact，链到 wasap.my 或通用「联系支持」 |

---

## 14. 总结

- **整体**：Next 已覆盖 Wix Tenant Dashboard 绝大部分功能，并多出反馈历史、分类、邮箱/密码等。
- **明确少做/差异**：  
  - **Approval 通过后** 与 **Profile 保存后** 未调 **syncTenantForClient**；  
  - **Payment** 未限制「最多 10 笔」；  
  - **Dashboard** 无物业下拉、无 Valid Date 文案；  
  - **WhatsApp** 联系 operator 入口缺失。  

按上表「建议补全项」实现即可与 Wix 行为对齐并保持现有增强。
