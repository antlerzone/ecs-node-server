# Tenant Dashboard：Wix 前端 vs Next.js 對照表

對照依據：**Wix** `docs/wix/frontend/tenant-dashboard-page-full.js`（單一頁多 section）  
vs **Next.js** `docs/nextjs-migration/app/tenant/*`（多頁 + 後端已接好之功能）。

`tenant-invoice-page-full.js` 為 **營運端** 開單/報表頁，非租客前台，此表不納入。

---

| 功能模塊 | Wix 有 | Next.js 有 | 說明 |
|----------|--------|------------|------|
| **Init / 登入** | ✅ init、TENANT、TENANCIES、hasOverduePayment | ✅ tenantInit、TenantProvider、useTenantOptional | 對齊 |
| **Dashboard 主區** | ✅ 物業下拉、repeater 待辦、租約有效日期 | ✅ 首頁、tenancy 切換、action items、租約區間 | 對齊 |
| **待辦：Approval** | ✅ repeater 內 Accept/Reject、getClientsByIds | ✅ 獨立 Approval 頁、tenantApprove/Reject、clientsByIds | 功能同，Next 多一頁 |
| **待辦：Agreement** | ✅ repeater 內「Sign Agreement」跳 agreement section | ✅ Dashboard 可跳 Agreement 頁 + Agreement 頁簽署 | 對齊 |
| **Agreement 頁** | ✅ 依物業列協議、預覽 HTML、Sign → updateAgreementTenantSign | ✅ 依 tenancy、agreementHtml、agreementUpdateSign、過去協議下載 | 對齊 |
| **Meter** | ✅ balance、rate、top-up 金額、postpaid 禁用、createPayment(meter) | ✅ room() 取 balance/rate/canTopup、createPayment(meter)、postpaid 禁用 | 對齊 |
| **Meter：同步電表** | ✅ syncMeterByCmsMeterId（開 meter 時） | ✅ Quick Stats 右上角「Sync」、meterSync(roomId)、POST meter-sync | 對齊 |
| **Meter：用電報表** | ✅ datepicker + getUsageSummary + 圖表 + text 摘要 | ✅ usageSummary(roomId, start, end)、Usage Trends 圖表與 Usage History 表格用 API 數據、Usage Report 彈窗顯示區間總量 | 對齊 |
| **Smart Door** | ✅ getPropertyWithSmartdoor、remoteUnlock、PIN 輸入、Save Password | ✅ propertyWithSmartdoor、tenantTtlockUnlock、tenantTtlockPasscode、tenantTtlockPasscodeSave、Change/Generate PIN | 對齊（Next 多「Generate Guest PIN」） |
| **Payment** | ✅ getRentalList、勾選項、Pay Now → createPayment(invoice)、invoice/receipt 連結 | ✅ rentalList、未付彙總、Pay Now createPayment(invoice)、invoiceurl/receipturl | 對齊 |
| **Profile：基本** | ✅ fullname、phone、bank、updateTenantProfile | ✅ fullname、phone、bank、updateProfile | 對齊 |
| **Profile：entity / reg_no** | ✅ entity_type、reg_no_type 下拉並寫入 updateTenantProfile | ✅ updateProfile 帶 profile: { entity_type, reg_no_type } | 對齊 |
| **Profile：NRIC 上傳** | ✅ getUploadCreds、NRIC 正反面上傳、nricFront/nricback 寫入 profile | ✅ uploadFile → OSS、updateProfile(nricFront, nricback)、POST tenantdashboard/upload | 對齊 |
| **Profile：WhatsApp** | ✅ tenancy.client.contact → wasap.my | ✅ tenancy.client.contact → wasap.my、無號時「No contact」 | 對齊 |
| **Profile：變更 Email** | ❌ 未在 dashboard 內 | ✅ requestEmailChange、confirmEmailChange | **Next 多** |
| **Feedback** | ✅ submitFeedback(tenancyId, roomId, propertyId, clientId, description, photo, video) | ✅ feedback(tenancyId, description) | 對齊（見下） |
| **Feedback：附件** | ✅ getUploadCreds、photo/video 上傳後 URL 傳入 submitFeedback | ✅ uploadFile 上傳、feedback({ photo, video }) 傳入 API | 對齊 |
| **Overdue 門控** | ✅ 有未付時禁用 Meter、Smart Door | ✅ Dashboard 有 overdue 提示；後端 create-payment 不依前端門控 | 邏輯對齊（後端可再強制） |

---

## 總結

| 類型 | 項目 |
|------|------|
| **少功能（Wix 有、Next 未接或未做齊）** | 無（Meter 用電報表已接 usage-summary + 圖表/表格/報表） |
| **多功能（Next 有、Wix 本頁無）** | ① 變更 Email（requestEmailChange + confirmEmailChange）<br>② Approval 獨立頁（Wix 為 dashboard repeater 內）<br>③ Smart Door「Generate Guest PIN」按鈕（Wix 僅改密） |
| **其餘** | 全部模塊（含 Meter 用電報表）已對齊並接好後端。 |
