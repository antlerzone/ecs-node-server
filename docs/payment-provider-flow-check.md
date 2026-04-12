# Payment provider 流程檢查清單

最後檢查：Connecting → Payment（實際收款）→ Call API → Settlement → Disconnect，Stripe 與 Xendit 是否一致且完整。

---

## 1. Connecting（連接）

| 項目 | Stripe | Xendit |
|------|--------|--------|
| **UI 入口** | Company Setting → Payment → 選 Stripe → Connect now | Company Setting → Payment → 選 Xendit → Create account now / Connect sub account |
| **API** | `POST /api/companysetting/stripe-connect-onboard`（回傳 OAuth URL） | `POST /api/companysetting/xendit-create-sub-account` 或 `POST /api/companysetting/payex-connect`（Sub-account ID + API Key） |
| **OAuth 回調** | `GET /api/companysetting/stripe-connect-oauth-return`；完成後寫入 `client_profile.stripe_connected_account_id` | 無跳轉；建立/連接後寫入 `client_integration`（paymentGateway, payex） |
| **狀態查詢** | `POST /api/companysetting/onboard-status` → `stripeConnected`, `stripe_connected_account_id` | 同上 → `payexConfigured`, `payexHasSubAccount`, `payexSubAccountEverCreated` |
| **一戶一帳** | 一個 Stripe Connect 帳號 | 一個 Xendit sub-account（曾 create 過則只能 Connect sub account，不能再次 Create） |

**結論：** 兩邊都有完整連接流程；API、路由、前端呼叫一致。

---

## 2. Payment（實際收款：誰用哪個 gateway）

| 場景 | 是否依 client 的 payment gateway | 實作位置 |
|------|-----------------------------------|----------|
| **Operator 儲值 (Credit Topup)** | ✅ 是 | `topup.service.js`：`getClientPaymentGateway(clientId)` → `payex` 則 `payex.createPayment()`，否則 Stripe `createCheckoutSession()` |
| **租客繳租金/帳單 (Tenant Invoice)** | ✅ 是 | `tenantdashboard.routes.js` create-payment：`getClientPaymentGateway(clientId)` → Payex 或 Stripe |
| **租客繳電表 (Tenant Meter)** | ✅ 是 | 同上，同一 create-payment 流程 |
| **SaaS 方案購買 (Pricing Plan)** | ❌ 僅 Stripe | `checkout.service.js`：`confirmPricingPlan` 僅呼叫 `createCheckoutSession`（平台收款，非 operator gateway） |

**結論：** 與「operator 收款」相關的 Topup、租客租金/電表皆依 client 的 gateway；Pricing Plan 為平台 Stripe，不經 operator 的 Stripe/Xendit 選擇。

---

## 3. Call API（前端/其他服務呼叫的 API）

| 用途 | Stripe | Xendit (Payex) |
|------|--------|----------------|
| **取得連線狀態** | `onboard-status`（同上） | 同上 |
| **取得前端用 config** | `GET /api/stripe/config?clientId=`（publishableKey, useSandbox） | `GET /api/payex/config?clientId=`（configured） |
| **建立 Topup 付款** | 經 topup 內部 → `createCheckoutSession`，回傳 `url` | 經 topup 內部 → `payex.createPayment`，回傳 `url` |
| **建立租客付款 (租金/電表)** | 經 tenantdashboard create-payment → Stripe Checkout | 經 tenantdashboard create-payment → Payex createPayment |
| **Release 租金 (Stripe)** | `POST /api/stripe/release-rent`（body: paymentIntentId, clientId） | N/A（Xendit 無 hold→release，callback 內一次完成） |

**結論：** 兩邊都有對應的 config、建立付款；Stripe 多一個 release-rent，Xendit 在 callback 內完成結算。

---

## 4. Settlement（結算 / 入帳 / 釋放）

| 項目 | Stripe | Xendit |
|------|--------|--------|
| **Webhook/Callback** | `POST /api/stripe/webhook`（checkout.session.completed, payment_intent.succeeded, account.updated） | `POST /api/payex/callback`（invoice status PAID） |
| **Topup 入帳** | Webhook → `handleCheckoutSessionCompleted` / `handlePaymentIntentSucceeded` → `addClientCredit` | Callback → metadata type Topup → 更新 creditlogs is_paid，`addClientCredit` |
| **租金入 operator** | Webhook → rent 類型 → `releaseRentToClient`（扣 credit 手續費+1%，Transfer 到 Connect） | Callback → rental_ids → 更新 rentalcollection is_paid，`transferFeeToOperatorIfPlatform`，`applyPayexFeeDeduction` |
| **租客帳單/電表** | 同上（Checkout metadata 區分 TenantInvoice / TenantMeter） | Callback 依 metadata 處理 TenantInvoice、TenantMeter |

**結論：** 兩邊都有完整 webhook/callback、入帳與扣費；Stripe 有「release」步驟，Xendit 在 callback 內一次完成轉帳與扣費。

---

## 5. Disconnect（斷開）

| 項目 | Stripe | Xendit |
|------|--------|--------|
| **API** | `POST /api/companysetting/stripe-disconnect` | `POST /api/companysetting/payex-disconnect` |
| **後端行為** | 清空 `client_profile.stripe_connected_account_id`, `stripe_connect_pending_id` | `client_integration` 該列 `enabled=0`，保留 `values_json` 內 `xendit_sub_account_ever_created`、`xendit_sub_account_id`（僅能再 Connect sub account） |
| **前端** | Company 頁 Manage → Disconnect | 同上，呼叫 payex-disconnect |

**結論：** 兩邊都有對應的 disconnect API 與前端；Xendit 斷開後仍限制只能「Connect sub account」。

---

## 6. 路由掛載（server.js）

- `/api/companysetting` → companysettingRoutes（onboard-status, stripe-connect-onboard, stripe-disconnect, payex-connect, payex-disconnect, xendit-create-sub-account）
- `/api/stripe` → stripeRoutes（create-checkout-*, release-rent, config, webhook）
- `/api/payex` → payexRoutes（callback, config, credentials）

**結論：** 路由齊全。

---

## 7. 差異與注意點

1. **Pricing Plan 購買**：僅走 Stripe（平台），不依 operator 的 payment gateway；若未來要支援 Xendit 需在 checkout.service 分支。
2. **Stripe release-rent**：僅 Stripe 有「先 hold 再 release」；Xendit 款項經 split 直接到 operator，callback 只做入帳與扣費。
3. **一戶一 Xendit sub-account**：後端 `xenditCreateSubAccount` 會檢查 `xendit_sub_account_ever_created` / 已有 sub_account_id，阻擋重複建立；前端依 `payexSubAccountEverCreated` 只顯示「Connect sub account」。

---

## 8. 總結

| 階段 | Stripe | Xendit | 一致/完整 |
|------|--------|--------|-----------|
| Connecting | ✅ | ✅ | ✅ |
| Payment（Topup / 租客租金・電表） | ✅ | ✅ | ✅（依 client gateway） |
| Call API（config、建立付款、release） | ✅ | ✅（無 release） | ✅ |
| Settlement（webhook/callback、入帳、扣費） | ✅ | ✅ | ✅ |
| Disconnect | ✅ | ✅ | ✅ |

整體：**兩邊流程已對齊且完整**；唯一刻意差異為 Pricing Plan 僅 Stripe、以及 Xendit 無 release 步驟（設計如此）。

---

## 9. Settlement：Processing fee + 1%（Xendit Platform 改為 split 直接分帳）

| 項目 | Stripe | Xendit (Platform) | Xendit (Operator 自管 key) |
|------|--------|-------------------|----------------------------|
| **分帳方式** | 平台收款 → 扣 credit（手續費+1%）→ Transfer 到 Connect | **Split 直接分帳**：97% 給 operator，3% 留平台；Xendit 從 3% 扣約 2% 手續費，我們實收約 1%。**不扣 credit** | 款項直入 operator；我們從 credit 扣 1% + Xendit 費 |
| **扣款時機** | `releaseRentToClient` 時 deduct + Transfer | 無（全在 Xendit 上走完） | Callback 時 `applyPayexFeeDeduction` |
| **寫入** | creditlogs | 無 creditlog（platform 模式） | creditlogs type=PayexFee |

**結論：** Platform 模式：租客付 1000 → operator 收 970，SaaS 收約 10（3% 扣掉 Xendit 費），credit 不扣。Operator 模式仍從 credit 扣 1% + Xendit 費。

---

## 10. Cron daily：拿 settlement → 做 accounting

| 項目 | Stripe | Xendit |
|------|--------|--------|
| **Settlement 來源** | 不另外拉 API：`stripepayout` 在「release 到 Connect」時由 `upsertStripePayout` 寫入（每 client 每日一筆） | Cron 內呼叫 `fetchAndSaveSettlementsForAllClients()`，從 Xendit Transaction API 拉並寫入 `payex_settlement`（目前 API 可能回傳空，依 Xendit 文件） |
| **做會計** | 有：`getStripePayoutsPendingJournal` → `processPendingStripePayoutJournals`，對 `journal_created_at IS NULL` 的 stripepayout 做分錄（DR Bank, CR Stripe），寫回 `accounting_journal_id`、`journal_created_at` | **已實作**：`getPayexSettlementsPendingJournal` → `processPendingPayexSettlementJournals`，對 `bukku_journal_id` 為空的 payex_settlement 做分錄（DR Bank, DR Processing fees, CR Xendit），寫回 `bukku_journal_id`；account 表需有 Bank、Xendit、Processing Fees 模板並在 Accounting 設定頁對應 |

**結論：** Stripe 與 Xendit 的「cron daily 拿 settlement 做 accounting」皆已完整；Xendit 分錄為三欄（Bank + Processing fees + Xendit），科目由 `getPaymentDestinationAccountId(..., 'bank'|'xendit'|'processing_fee')` 取得。

---

## 11. 沒有 credit 時是否 hold payout

| 項目 | Stripe | Xendit |
|------|--------|--------|
| **行為** | **Hold payout**：租金付款成功後，若 credit 不足（不足以扣 Stripe fee + 1%），不執行 Transfer 到 Connect；寫入 `stripe_rent_pending_release`。Operator 儲值後 `addClientCredit` 會觸發 `tryReleasePendingRentReleases`，再扣 credit 並 Transfer | **不 hold 款項**：款項經 Xendit split 已進 operator，無法延遲撥款。我們只做「扣 credit」：若不足則寫入 `payex_fee_pending`，等 operator top-up 後 `processPayexPendingFees` 再扣（Stripe top-up 時也會 call `processPayexPendingFees`） |
| **實作** | `releaseRentToClient` 內 `balance < deductCredits` → return `released: false`；`handleCheckoutSessionCompleted` 內 rent 成功但不足時寫入 pending 表 | `applyPayexFeeDeduction` → `deductPayexFeeAndLog` 不足 → `insertPayexFeePending` |

**結論：** Stripe 有「沒有 credit 就 hold payout（不轉到 Connect）」；Xendit 因 split 即時到 operator，只能「事後扣費、不足記 pending、儲值後補扣」。
