# Tenant 前端：元素接線檢查 & Wix 功能對比

## 1) 前端所有 element 接線檢查（Next.js Tenant Portal）

以下確認每個互動元素都有對應的 API 或導航調用。

### Layout & Sidebar (`app/tenant/layout.tsx`, `components/tenant/sidebar.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `useAuth("tenant")` | ✅ | 未登入會導向 `/login` |
| 導航連結 Dashboard / Meter / Payment / Smart Door / Agreement / Profile / Feedback / Approvals | ✅ | 皆為 `<Link href="...">` 正確路由 |
| Active Room 下拉 | ✅ | 來自 `useTenantOptional().tenancies`，顯示首筆 room/property |
| 用戶名 / Room（側欄底部） | ✅ | 來自 `tenant.fullname` / `tenant.email`、`activeRoom` |
| Logout（LogOut icon） | ✅ | 連到 `/portal`（portal 頁再 logout 清 session） |

### Dashboard (`app/tenant/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()` | ✅ | 載入 tenant + tenancies |
| 歡迎語 + 房間數 / 房間標籤 | ✅ | 來自 `tenant.fullname`、`tenancies.length`、`roomLabels` |
| Action Required 連結（Sign Agreement / Payments） | ✅ | `Link` 到 `/tenant/agreement`、`/tenant/payment`，依 `hasPendingAgreement` 顯示 |
| Meter 區塊「Top-up Now」 | ✅ | `Link` 到 `/tenant/meter` |
| Tenancy Period + Progress | ✅ | 來自 `firstTenancy.begin/end`、計算 progress |
| Loading / Error / No tenant 狀態 | ✅ | 有對應 UI |

### Profile (`app/tenant/profile/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()` + `banks()` | ✅ | 載入資料與銀行列表 |
| 頭像 initials | ✅ | `(name \|\| email).slice(0,2)` |
| Full Name, NRIC, Email(只讀), Phone, Address | ✅ | 雙向綁定 + `handleSaveProfile` 調 `updateProfile` |
| Bank 下拉、Account Number、Account Holder | ✅ | 同上，一併寫入 `updateProfile` |
| 「Save Changes」/「Save Bank Details」 | ✅ | 皆呼叫 `handleSaveProfile` |
| Share Profile for Bank Details 按鈕 + Dialog | ✅ | 複製連結、關閉 |
| Change Password | ⚠️ 僅 UI | 無後端介面 |
| Language 下拉 | ⚠️ 僅 UI | 未持久化到後端 |

### Agreement (`app/tenant/agreement/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()` | ✅ | 取 tenancies + agreements |
| 選擇 tenancy（按鈕列表） | ✅ | `setSelectedTenancyId` → 觸發 `agreementHtml(tenancyId)` |
| 協議 HTML 預覽 | ✅ | `agreementHtmlContent` 來自 API |
| 「Sign Agreement」按鈕 | ✅ | `agreementUpdateSign(agreementId, "signed", "completed")`，成功後重拉 init |
| Past Agreements 列表 | ✅ | 來自 tenancies 中已簽（有 tenantsign）的 agreements |

### Payment (`app/tenant/payment/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()`、`rentalList(tenancyId)` | ✅ | 依所選 tenancy 拉發票列表 |
| Tenancy 切換（多個時） | ✅ | 按鈕切換 `selectedTenancyId`，重拉 rental list |
| Outstanding 總額 + 未付筆數 | ✅ | 從 `items` 計算 unpaid |
| 「Pay Now」 | ✅ | `createPayment({ type: 'invoice', ... })`，成功則 redirect 到 Stripe |
| Rental History 列表（排序） | ✅ | Sort latest/oldest，每條顯示 Invoice/Download 連結（`invoiceurl`/`receipturl`） |

### Meter (`app/tenant/meter/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()`、`room(roomId)` | ✅ | 依所選 tenancy 的 room 取 meter 餘額與 rate |
| Tenancy 切換 | ✅ | 同上 |
| Current Balance / Electricity Rate | ✅ | 來自 `roomData.meter` |
| Quick Top-up 金額按鈕 | ✅ | `setSelected(amt)`，postpaid 時 disable |
| 「Confirm Payment」 | ✅ | `createPayment({ type: 'meter', amount: selected })`，redirect Stripe |
| Usage Trends 圖表 | ⚠️ 僅 UI | 靜態 mock 資料，未調 `getUsageSummary` / 日期範圍 |

### Feedback (`app/tenant/feedback/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()` | ✅ | 取 tenancies，選 tenancy |
| Category 選擇 | ✅ | 僅前端，一併拼進 description |
| Subject / Details 輸入 | ✅ | 必填 Details，拼進 `description` |
| 「Submit Request」 | ✅ | `feedback({ tenancyId, description })` |
| 後端支援 photo/video | ✅ | API 與後端皆支援，**前端尚未做上傳 UI** |

### Approval (`app/tenant/approval/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()` | ✅ | 取 tenancies（含 client） |
| 待處理列表（mock） | ⚠️ 僅 UI | 靜態 pendingApprovals，非後端「待審核」列表 |
| 點擊項目開 Dialog | ✅ | 顯示詳情、Accept/Decline |
| 「Accept」/「Decline」 | ✅ | `tenantApprove(clientId)` / `tenantReject(clientId)`，多 client 時可選 |

### Smart Door (`app/tenant/smart-door/page.tsx`)

| Element | 是否接好 | 說明 |
|--------|----------|------|
| `tenantInit()`、`propertyWithSmartdoor(propertyId, roomId)` | ✅ | 載入門鎖資訊，多 tenancy 可切換 |
| 「Tap to Unlock」/ Remote Unlock | ✅ | 呼叫 `tenantTtlockUnlock(tenancyId)`，成功/失敗狀態與錯誤提示 |
| Access PIN 顯示 | ✅ | `tenantTtlockPasscode(tenancyId)` 拉當前 PIN，6 位顯示 |
| Change PIN / Generate Guest PIN | ✅ | `tenantTtlockPasscodeSave(tenancyId, newPassword)`，Change 用 prompt、Guest 隨機 6 位 |
| Access History | ⚠️ 僅 UI | 靜態列表，後端無此 API |

---

## 2) Wix Tenant Dashboard vs Next.js Tenant Portal 功能對比表

| 功能 / 區塊 | Wix 前端 (tenant-dashboard-page-full.js) | Next.js (app/tenant/*) | 狀態 | 備註 |
|-------------|------------------------------------------|------------------------|------|------|
| **登入 / 身份** | wixUsers.currentUser.getEmail() → init | getMember() + tenantInit()（layout useAuth） | ✅ 已對齊 | 皆以 email 辨識，Next 經 portal 登入 |
| **Init** | tenantDashboardInit() | tenantInit() | ✅ 已對齊 | 同 ECS /api/tenantdashboard/init |
| **Dashboard 首屏** | #dropdownproperty、#repeatertenantdashboard、#texttenantname、#textvaliddate | 首頁 welcome + 房間標籤 + 待辦連結 + 首筆租約進度 | ✅ 已對齊 | Next 無 property 下拉，改為多房間標籤與連結 |
| **依物業篩選** | #dropdownproperty → 篩選 tenancies、renderValidDate、applyTenantProfileGate | 多 tenancy 時各子頁用 tab/按鈕切換 tenancy | ✅ 已對齊 | 行為不同但功能覆蓋 |
| **待辦 / 入口按鈕** | #buttonmeter, #buttonagreement, #buttonsmartdoor, #buttonpayment, #buttonprofile, #buttonfeedback | Sidebar 導航 + Dashboard 行動卡 | ✅ 已對齊 | |
| **Approval 列表項** | repeater 每項 #buttonapprove / #buttonreject | approval 頁 mock 列表 + Dialog Accept/Decline | ⚠️ 部分 | 列表來源為 mock；Approve/Reject API 已接 |
| **Meter 區** | getRoomWithMeter、#dropdowntopup、#buttontopupmeter、#textmeterbalance、#textmeterrate、datepicker + getUsageSummary + #htmlmeterreport | room()、金額按鈕、Confirm Payment、balance/rate、靜態圖表 | ⚠️ 部分 | 充值與餘額/費率已接；**用量報表與日期範圍、圖表未接** |
| **Agreement 區** | getAgreementHtml、#htmlagreement、#signatureinputagreement、#buttonagree、updateAgreementTenantSign | agreementHtml()、agreementUpdateSign()、選 tenancy、預覽、簽署 | ✅ 已對齊 | Next 無簽名板，以「signed」字串送出（可之後接簽名元件） |
| **Payment 區** | getRentalList、#repeaterpayment、#checkboxpayment、#buttonpaynow、最多 10 筆、Invoice/Receipt 連結 | rentalList()、列表、Pay Now、invoiceurl/receipturl | ✅ 已對齊 | Next 無勾選多筆，改為「全部未付一次 Pay」；可之後加勾選 |
| **Smart Door** | getPropertyWithSmartdoor、remoteUnlock、createTenantPasscode、updateTenantPasscode、#inputdoorpin、#buttonbluetooth | propertyWithSmartdoor()、tenantTtlockUnlock()、tenantTtlockPasscode()、tenantTtlockPasscodeSave()、Tap to Unlock、PIN 顯示與變更/產生 | ✅ 已對齊 | 遠端開鎖、當前 PIN、變更 PIN、產生客用 PIN 皆接 ECS tenantdashboard TTLock 接口 |
| **Profile** | getBanks、updateTenantProfile、fullname/email/phone/address/nric、dropdownbankname、bank account、entity_type/reg_no_type/tax_id、NRIC 正反面上傳 (getUploadCreds + HTML Embed) | banks()、updateProfile()、基本欄位+銀行、Share 連結 | ⚠️ 部分 | **缺：entity_type、reg_no_type、tax_id_no、NRIC 上傳** |
| **Feedback** | submitFeedback、#inputdescriptionfeedback、#htmluploadbuttonfeedback (photo/video) | feedback()、description、category/title | ⚠️ 部分 | **缺：photo/video 上傳 UI**（後端與 tenant-api 已支援） |
| **WhatsApp 聯絡** | #buttonwhatsap → tenancy.client.contact → wasap.my | 無 | ❌ 少功能 | 可加「聯絡 Operator」連結或按鈕 |
| **Profile Gate** | applyTenantProfileGate：資料未齊只開 Profile/Feedback；未簽約不開 Payment；欠租不開 Meter/Smart Door | TenantProvider + ProfileGate：訪客僅 /profile、未填姓名/電話→Meter/Smart Door 導向 profile、未簽約→導向 agreement、欠款→導向 payment | ✅ 已對齊 | |
| **Email 更換** | 未見雙重驗證 | requestEmailChange + confirmEmailChange（驗證碼寄新 email，輸入 code 才更新） | 🟢 多功能 | Next 獨有：換 email 必須驗證碼雙重驗證 |
| **syncTenantForClient** | 有呼叫 | 未在 Next 使用 | ⚠️ 可選 | 若業務需「同步租客到 client」可補 |
| **getUploadCreds** | Profile NRIC、Feedback 上傳 | 未用 | ❌ 少功能 | 需 OSS 上傳元件 + 回傳 URL 給 profile/feedback |

---

## 3) Wix vs Next 一覽表（有無 / 少功能 / 多功能）

| 功能 | Wix 有 | Next 有 | 狀態 | 說明 |
|------|--------|--------|------|------|
| 登入 / 身份 (email) | ✅ | ✅ | ✅ 已對齊 | portal 登入 → getMember + tenantInit |
| Init 一次快取 (TenantProvider) | 每次 section 可能重拉 | ✅ | 🟢 多功能 | Next 只拉一次，各頁讀 context |
| Dashboard 首屏、待辦、租期進度 | ✅ | ✅ | ✅ 已對齊 | 來自 context |
| 側欄：房間 / 用戶名動態 | ✅ | ✅ | ✅ 已對齊 | useTenantOptional |
| Profile Gate（訪客僅 profile、未填資料/未簽約/欠款鎖 Meter & Smart Door） | ✅ | ✅ | ✅ 已對齊 | ProfileGate 導向 |
| Profile：姓名/電話/銀行/儲存 | ✅ | ✅ | ✅ 已對齊 | updateProfile |
| Profile：更換 Email 雙重驗證 | ❌ | ✅ | 🟢 多功能 | 驗證碼寄新 email，輸入 code 才更新 |
| Profile：entity_type / tax_id / NRIC 上傳 | ✅ | ❌ | ❌ 少功能 | Next 僅 UI 欄位，未接後端/OSS |
| Profile：Change Password / Language | 僅 UI 或未見 | 僅 UI | ⚠️ 同級 | 皆無後端 |
| Agreement：預覽、簽署 | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** agreementHtml、agreementUpdateSign |
| Payment：發票列表、Pay Now | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** rentalList、createPayment |
| Meter：餘額/費率/充值 | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** room()、createPayment |
| Meter：用量報表/圖表 (getUsageSummary) | ✅ | ❌ | ❌ 少功能 | Next 無此 API 接線 |
| Smart Door：遠端開鎖、PIN 顯示與變更/產生 | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** tenantTtlockUnlock/Passcode/PasscodeSave |
| Smart Door：Access History | 靜態或無 | 靜態 | ⚠️ 同級 | 後端無 API |
| Feedback：文字提交 | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** feedback() |
| Feedback：photo/video 上傳 | ✅ | ❌ | ❌ 少功能 | 需 OSS + 上傳 UI |
| Approval：Accept/Decline API | ✅ | ⚠️ | ⚠️ 視頁面 | 後端已接；**若頁面為替換版需接回** tenantApprove/Reject |
| Approval：待審列表來源 | 後端或 repeater | mock | ❌ 少功能 | Next 列表為假資料 |
| WhatsApp 聯絡 (tenancy.client.contact) | ✅ | ⚠️ | ❌ 少功能 | Profile 有「Contact Operator」但為固定連結；可改為用 tenancy.client.contact |
| getUploadCreds（NRIC/Feedback 上傳） | ✅ | ❌ | ❌ 少功能 | 需 OSS 上傳元件 |
| syncTenantForClient | ✅ | ❌ | ⚠️ 可選 | 業務需要時可補 |

**說明**：若你曾用 zip **替換過** `app/tenant` 下的頁面，Payment / Meter / Agreement / Feedback / Approval / Smart Door 可能變成靜態 mock，需在該頁接回 `useTenant()` + 對應 API（rentalList、createPayment、room、agreementHtml、feedback、tenantApprove/Reject、tenantTtlockUnlock 等）。後端與 `lib/tenant-api.ts` 均已支援。

---

## 4) 總結

- **已完整對齊**：Init、TenantProvider 快取、Dashboard、側欄動態、Profile Gate、Profile 基本+銀行+**Email 雙重驗證**、後端 Agreement/Payment/Meter/Feedback/Approval/Smart Door API。
- **多功能**：Init 只拉一次（快）、**Email 更換必須驗證碼**。
- **少功能**：Profile entity/tax/NRIC 上傳、Feedback photo/video 上傳、Meter 用量圖表、Approval 列表來自後端、WhatsApp 用 tenancy.contact、getUploadCreds。
- **視目前頁面是否接線**：Agreement、Payment、Meter、Smart Door、Feedback、Approval 的「列表/按鈕」若為替換版靜態頁，需在該頁接回 useTenant + 上述 API。
