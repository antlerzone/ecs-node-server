# Wix 旧代码 vs Node/ECS 功能对比（缺失项）

根据 Wix 的 **data.js**、**httpfunction**、**jobs.config**、**jobs.js**、**dailyscheduleavailableunitchecking.jsw** 与当前 Node 后端的对比，以下功能在 Node 中**尚未实现或实现方式不同**。

---

## 一、data.js（Data Hooks / 衍生字段 / 业务联动）

### 1. PropertyDetail

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **beforeInsert** 自动算 `shortname` = `apartmentName` + `unitNumber` | ✅ | ⚠️ 仅**批量插入**时在 `propertysetting.service.js` 里用同样公式写入；**单条 update 未**在 `apartmentName`/`unitNumber` 变更时重算 `shortname` |
| **beforeUpdate** 当 `apartmentName` 或 `unitNumber` 变化时重算 `shortname` | ✅ | ❌ `updateProperty` 只更新传入字段，不自动维护 `shortname` |

### 2. RoomDetail

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **beforeInsert** 自动算 `title_fld` = property.shortname + roomName | ✅ | ❌ `insertRooms` 里 `title_fld` 只设为 **roomName**，没有拼 property shortname |
| **beforeUpdate** 当 roomName/property 变化时重算 `title_fld` | ✅ | ❌ `updateRoom` 可传 `title_fld`，但**不会**根据 property shortname + roomName 自动重算 |
| **beforeUpdate** 当 meter 变化时，同步到 MeterDetail：room、property、**title**（= room.title_fld） | ✅ | ⚠️ `updateRoomMeter` 会写 meterdetail 的 `room_id`、`property_id`，**没有**把 room 的 `title_fld` 同步到 meterdetail.title |

### 3. Tenancy

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **afterInsert** 用 RoomDetail.title_fld 回写 Tenancy.title | ✅ | ⚠️ `createBooking` 里用 room 的 title 写入；若 Tenancy 由别处创建，可能没有统一回写 title |
| **afterInsert** 调用 `createCommissionBill(item)` | ✅ | ❌ Node 无「新租约自动生成佣金账单」的等价逻辑（仅有 commission_snapshot 存快照） |
| **afterInsert** 调用 `generateRentalCollections(item)` | ✅ | ✅ Node 有 `generateFromTenancy` / `generateFromTenancyByTenancyId`，在创建/批准租约时生成 RentalCollection |
| **afterUpdate** payment false→true：TTLock 锁门、setRelay 断电、ttlockfreeze=true | ✅ | ❌ Node 无 Tenancy 更新时根据 payment 变化自动锁门/断电/冻结 |
| **afterUpdate** payment true→false：解冻、TTLock 恢复密码、setRelay 通电 | ✅ | ❌ 同上 |
| **afterUpdate** status true→false（租约结束）：锁门、断电、ttlockfreeze=true | ✅ | ❌ 同上 |

### 4. RentalCollection

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **afterInsert** accountingStatus=pending 时入队，串行执行 `processRentalCollectionAccounting` | ✅ | ⚠️ Node 在 `generateFromTenancy` 等处**同步**调用 `createInvoicesForRentalRecords`，无队列、无 `accountingStatus`/recovery |
| **afterUpdate** isPaid false→true 时 `processRentalCollectionPayment`（Bukku 收据） | ✅ | ✅ Node：Stripe webhook 或 `updateRentalRecord` 标记 ispaid 后会调 `createReceiptForPaidRentalCollection` |

### 5. MeterTransaction

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **afterUpdate** isPaid false→true 且 referenceid 以 **MT_**：confirmRecharge、syncSingleMeter、createBukkuCashInvoice | ✅ | ❌ Node 无 MeterTransaction 的「更新后自动 confirmRecharge + 同步 + 开 Bukku 现金 Invoice」的 hook 或等价触发 |
| **afterUpdate** isPaid false→true 且 referenceid 以 **TM_**：processMeterAccounting、rechargeFlow | ✅ | ⚠️ Node：Stripe webhook 会更新 metertransaction ispaid/status 并调 `handleTenantMeterPaymentSuccess`（含会计+充值逻辑）；**Payex 回调**不存在，故 TM_ 若从 Payex 来则无对应处理 |

### 6. createReceiptsForReference(referenceId)

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| 按 referenceId 查 RentalCollection，按 invoiceid 分组金额，createBukkuPayment，回写 receiptUrl | ✅ | ❌ Node 无「按 referenceId 批量建 Bukku 收据」的等价接口（Payex 旧租金 RC_ 回调会用到） |

### 7. Sync to Google Sheets

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| SupplierDetail afterInsert/afterUpdate（title 变更）→ sendSheets supplier | ✅ | ❌ Node 无 SendSheets / Google Sheets 同步 |
| RoomDetail afterInsert/afterUpdate（title_fld 变更）→ sendSheets property | ✅ | ❌ 同上 |

### 8. OwnerDetail / StaffDetail / TenantDetail

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| afterInsert/afterUpdate：enforceLowercaseEmail（把 email 转小写并写回） | ✅ | ❌ Node 无写入时强制 email 小写的逻辑 |

### 9. OwnerPayout

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **afterInsert** accountingStatus=pending → processOwnerPayoutAccounting | ✅ | ⚠️ Node 在报表侧有 `createAccountingForOwnerPayout`，由**前端 #buttonpay/#buttonbulkpaid** 触发，非 DB 插入后自动执行 |
| **afterUpdate** paid false→true → processOwnerPayoutPayment（需 bukkubillId，防重复） | ✅ | ⚠️ 同上，Node 是「用户选日期/方式后点付款」才做会计，无「paid 字段从 false 变 true 时自动跑 payment」的 hook |

### 10. refunddeposit

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **afterUpdate** done false→true → processRefundDepositAccounting | ✅ | ✅ Node：`updateRefundDeposit` 在 API 里把 done 设为 1 后调 `createRefundForRefundDeposit`，效果等价（由接口触发而非 DB hook） |

### 11. Agreement

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| agreement afterInsert/afterUpdate → syncAgreement（PropertyDetail.signagreement / Tenancy.agreements 快照） | ✅ | ⚠️ Node 在 **finalizeAgreementPdf** 回调里更新 property/tenancy 的 signagreement/agreement；**非**每次 agreement 增改都写回快照 |
| 双方签完自动设 pdfGenerating、调 createAgreement 生成 PDF | ✅ | ⚠️ Node 有 `generateFinalPdfAndComplete` 等，由**接口/流程**触发，非 DB hook 检测「双方已签」自动生成 |

### 12. RentalCollection 会计队列与恢复

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| 串行队列 runAccountingQueue、recoverPendingAccounting（启动 3 秒后扫 pending） | ✅ | ❌ Node 无队列、无 pending 恢复；依赖生成时同步开单 |

---

## 二、httpfunction（HTTP 接口）

### 1. Payex

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| get/post **payexReturn**、**payexAccept**、**payexReject**：重定向到 SUCCESS_URL | ✅ | ❌ Node 无 Payex 重定向路由 |
| **post_payexCallback**：解析 reference，按 TM_/TI_、MT_、RC_、PP-、TP- 分支处理 | ✅ | ❌ Node **无 Payex 回调路由**；仅 Stripe 支付流程（TenantInvoice/TenantMeter/Topup/pricingplan） |
| get/post **payexDebug** | ✅ | ❌ 无 |

### 2. 内部/回调接口

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **post_rechargeJob**：body { meterId, amount }，执行 rechargeMeter + getBalance | ✅ | ❌ Node 无此 HTTP job；有 `metersetting.clientTopup`（createPendingTopup + confirmTopup），但无「Payex/内部调用的 rechargeJob」路由 |
| **post_updateOwnerAgreement**：body { id, pdfUrl }，更新 PropertyDetail.signagreement | ✅ | ⚠️ Node 在 `finalizeAgreementPdf` 里按 agreement 更新 property；无「仅按 property id + pdfUrl 直接写 signagreement」的独立接口 |
| **post_updateTenantAgreement**：body { id, pdfUrl }，更新 Tenancy.agreement | ✅ | ⚠️ 同上，通过 finalizeAgreementPdf 更新 tenancy.agreement，无单独「tenancy id + pdfUrl」接口 |
| **post_proxy**：转发到 `https://www.openapi.cnyiot.com/api.ashx?Method=...&api=...&apikey=...`，body 透传 | ✅ | ❌ Node 无 `/proxy` 路由；CNYIoT 通过 env `CNYIOT_BASE_URL` 指向外部代理地址 |

### 3. Stripe Webhook

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| checkout.session.completed / payment_intent.succeeded，TM_/TI_、Topup、pricingplan | ✅ | ✅ Node 有 `stripeWebhookHandler`，处理 TenantInvoice、TenantMeter、Topup、pricingplan 等 |

### 4. Agreement / Owner Report 回调

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **post_updateAgreementResult**：body { id, pdfUrl } → finalizeAgreementPdf | ✅ | ✅ Node 有 `/api/agreement/callback`，调 `finalizeAgreementPdf` |
| **post_updateOwnerReportResult**：body { id, pdfUrl } → finalizeOwnerReportPdf | ✅ | ✅ Node 有 generatereport 路由调 `finalizeOwnerReportPdf` |

---

## 三、Jobs（定时任务）

| 功能 | Wix | Node 现状 |
|------|-----|-----------|
| **dailyCheckTenanciesJob**（02:00 MY）：检查租约/租金、欠租则锁门+断电+ttlockfreeze、按房间更新 available/availablesoon | ✅ | ❌ Node **无**定时任务；无 dailyCheckTenancies 等价逻辑 |
| **fetchPayexSettlementJob**（12:00 MY）：拉取 Payex 结算并写 CMS | ✅ | ❌ 无 Payex、无此 job |
| **createSettlementJournalJob**（12:30 MY）：对无 bukku_journal_id 的 settlement 建 Bukku Journal | ✅ | ❌ 无 Payex settlement、无此 job |

---

## 四、小结：Node 侧尚未覆盖的功能清单

1. **衍生字段 / 自动维护**  
   - Property 的 shortname 在**单条 update** 时未随 apartmentName/unitNumber 重算。  
   - Room 的 title_fld 未在 insert/update 时按「property shortname + roomName」自动计算。  
   - Room 更新时未把 title_fld 同步到 meterdetail.title。

2. **Tenancy 与门锁/电表联动**  
   - 无「payment 或 status 变化时自动锁门/断电/解冻/恢复」的 hook 或等价流程。

3. **佣金账单**  
   - 无新租约创建时自动调用 createCommissionBill 的等价逻辑。

4. **RentalCollection 会计**  
   - 无「pending 队列 + 串行处理 + 启动恢复」；当前为生成时同步开单。

5. **MeterTransaction（MT_/TM_）**  
   - 无基于 DB 更新的「isPaid 变 true 后自动 confirmRecharge + syncSingleMeter + 开 Bukku 现金 Invoice」；TM_ 若走 Payex 则整条 Payex 分支缺失。

6. **Payex 全链路**  
   - 无 Payex 回调、无 Return/Accept/Reject 重定向、无 Payex 结算/Journal 定时任务。

7. **createReceiptsForReference**  
   - 无按 referenceId 批量建 Bukku 收据的接口（旧 Payex 租金回调用）。

8. **Google Sheets**  
   - 无 SupplierDetail / RoomDetail 同步到 SendSheets。

9. **Email 小写**  
   - OwnerDetail / StaffDetail / TenantDetail 写入时未强制 email 转小写。

10. **OwnerPayout 自动会计**  
    - 无「afterInsert/afterUpdate 时自动 processOwnerPayoutAccounting / processOwnerPayoutPayment」；依赖报表页按钮触发。

11. **Agreement 同步与自动 PDF**  
    - 非每次 agreement 增改都写回 property/tenancy 快照；双方签完自动生成 PDF 为接口驱动，非 DB hook。

12. **定时任务**  
    - 无 dailyCheckTenancies、fetchPayexSettlement、createSettlementJournal 的 cron/scheduler。

13. **HTTP 接口**  
    - 无 post_rechargeJob、post_proxy、payexReturn/Accept/Reject/Debug、以及独立的 updateOwnerAgreement/updateTenantAgreement（若需与 Wix 行为完全一致再考虑）。

以上为「Wix 有而 Node 当前没有或实现方式不同」的功能对比，便于你按优先级在 Node 侧补全或明确不迁移的项。
