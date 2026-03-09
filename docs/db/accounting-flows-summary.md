# 會計流程封圈確認（四系統 Xero / Bukku / AutoCount / SQL）

## 1）六類流程是否已封圈

| # | 流程 | Invoice/Bill | Receipt/Payment | 四系統 | 說明 |
|---|------|--------------|-----------------|--------|------|
| 1 | **Meter**（表單充值） | ✅ Cash invoice | ✅ 同單即付（cash invoice 內含 payment） | ✅ 四系統 | Stripe webhook → `handleTenantMeterPaymentSuccess`：開 cash invoice，寫回 metertransaction.invoiceid + invoiceurl。 |
| 2 | **Rental collection**（租金/費用） | ✅ Credit invoice | ✅ Receipt（標記已付後沖賬） | ✅ 四系統 | 插入後 `createInvoicesForRentalRecords` 開 credit；ispaid=1 後 `createReceiptForPaidRentalCollection` 沖賬。寫回 rentalcollection.invoiceid + invoiceurl。 |
| 3 | **Expenses**（費用單） | ✅ Cash purchase (bill) | ✅ 同單即付（purchase 即付款單） | ✅ 四系統 | #buttonpay / #buttonbulkpaid → `createPurchaseForBills`：一筆 bill = 一筆 cash purchase（DR 費用/CR 銀行或現金）。 |
| 4 | **Owner payout**（業主報表付款） | ✅ Management fee cash invoice | ✅ Owner payout cash bill（從 Platform Collection + Bank/Cash） | ✅ 四系統 | #buttonpay / #buttonbulkpaid → `createAccountingForOwnerPayout`：(1) 管理費 cash invoice（從 Platform Collection），(2) 業主淨額 cash bill（DR Platform Collection, CR Bank/Cash）。 |
| 5 | **Refund deposit**（退押金） | — | ✅ Refund（從 Deposit 退給租客） | ✅ 四系統 | #buttonmarkasrefund → `createRefundForRefundDeposit`：Bukku Sales Refund；Xero Bank Transaction SPEND；AutoCount/SQL Payment。 |
| 6 | **Forfeit deposit**（沒收押金） | ✅ Credit invoice | ✅ Receipt from Deposit | ✅ 四系統 | Tenancy Setting 終止 + forfeitAmount → 插入 rentalcollection → `createInvoicesForRentalRecords` + `createReceiptForForfeitDepositRentalCollection`。 |
| 7 | **Stripe settlement**（Stripe 出金→銀行） | — | ✅ Journal DR Bank / CR Stripe | ✅ 四系統 | 依 **stripepayout** 表（journal_created_at IS NULL）做分錄並寫回同表；Schedule 呼叫 `POST /api/stripe/process-settlement-journals`。Bukku/Xero/AutoCount/SQL 皆支援；詳見 `docs/db/stripe-settlement-journal.md`。 |

以上 1–6 在 **Xero、Bukku、AutoCount、SQL** 均有對應實現；7 目前為 Bukku、Xero（前提：account 表 + account_client 已配好各類型賬戶，且 Sync 或手動對應完成）。

---

## 2）ID 與 URL 回傳／寫回（a）

| 流程 | 返回／寫回 ID | 返回／寫回 URL |
|------|----------------|----------------|
| **Meter** | ✅ `invoiceId` 寫入 metertransaction；API 可回傳 meterTransactionId + invoiceId | ✅ `getInvoiceUrl` 寫入 metertransaction.invoiceurl（Xero 有；Bukku 組裝；AutoCount/SQL 多為 null） |
| **Rental collection** | ✅ `invoiceId` 寫入 rentalcollection；receipt 不另回傳 doc id | ✅ `invoiceurl` 寫入 rentalcollection（Xero/Bukku 有；AutoCount/SQL 多為 null） |
| **Expenses** | ✅ `createCashPurchaseForOneBill` 回傳 purchaseId；未寫回 bills 表 | ❌ 會計系統通常不提供 bill 的線上 URL；bills.billurl 為其他來源 |
| **Owner payout** | ⚠️ 會計建立成功回傳 `invoiceCreated` / `billCreated`（boolean），**未**寫回 ownerpayout.bukkuinvoice / bukkubills 的 doc id | ❌ 未回傳會計 doc URL |
| **Refund deposit** | ✅ `createRefundForRefundDeposit` 回傳 `refundId` | ❌ 各系統 Refund  API 多不提供可打開的 URL |
| **Forfeit deposit** | ✅ invoice id 寫入 rentalcollection.invoiceid；receipt 不另回傳 doc id | ✅ invoiceurl 寫入 rentalcollection（同 2） |

結論：  
- **有返回或寫回 id**：Meter、Rental collection、Refund、Forfeit（invoice 部分）均有；Expenses 有 purchaseId 但未寫回 bills；Owner payout 僅回傳 boolean，未回傳/寫回會計 doc id。  
- **有 URL 且會寫回**：Meter、Rental collection（含 Forfeit）在 Xero/Bukku 有 invoiceurl；其餘流程多無會計 doc URL 或未寫回。

若要「全部返回 id、有 url 則返回 url」完全一致，可後續補：  
- Owner payout：會計成功後將 management fee invoice id / payout bill id 寫回 ownerpayout 欄位並在 API 回傳。  
- Expenses：若需追蹤會計單據，可將 purchaseId 寫回 bills 表或回傳給前端。

---

## 3）四系統同步與上線狀態（b）

- **Account Setting Sync**：每個 provider（Bukku / Xero / AutoCount / SQL）的 Sync 會對 account 表每一行（含 Bank、Deposit、Rent Income、Expenses、Management Fees、Platform Collection 等）在該系統 list → 依 title 對應 → 沒有則 create → 寫入 account_client（+ account_json）。  
- **上述六類流程** 均依賴 account 表 + account_client（或 account_json）的對應；四系統的 API 調用均已實現。  
- 因此：在完成 **Account Setting Sync**（或手動對應）且 **client_integration** 配好該 provider 的前提下，**四套 account system（Xero / Bukku / AutoCount / SQL）均可視為已同步並 ready to live**。

---

## 4）小結

- **封圈**：1）Meter invoice + receipt、2）Rental collection invoice + receipt、3）Expenses bill + receipt、4）Owner payout bills + receipt、5）Refund deposit、6）Forfeit deposit 均已實作並支援四系統。  
- **a）ID/URL**：多數流程有返回或寫回 id；有 URL 的（Meter、Rental collection 的 invoice）會寫回；Owner payout 與 Expenses 的 id/url 可再補強。  
- **b）四系統**：Xero / Bukku / AutoCount / SQL 均已對接，依 Sync 與配置即可上線。
