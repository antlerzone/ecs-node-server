# Settlement / Payout 與會計入賬

## 1. 目前程式邏輯（Xendit）

- **Split**：97% 給 operator，3% 留平台；Xendit 從 3% 扣手續費，**約 1% 留在 SaaS 平台**。
- **Credit**：Platform 模式**不扣** operator credit，全在 Xendit 上分完。

---

## 2. 拿到 settlement / payout 後，會計怎麼做？

概念：**錢從「金流帳戶」進到「銀行」→ 做一筆分錄：借 Bank、貸 金流（Stripe / Xendit）。**

### Stripe（已實作）

| 步驟 | 說明 |
|------|------|
| **Settlement 來源** | 我們 release 到 Connect 時寫入 `stripepayout`（每 client 每 payout 日一筆，金額 = 該日轉給該 operator 的總額）。 |
| **何時做帳** | Cron daily 撈 `journal_created_at IS NULL` 的 stripepayout，逐筆做分錄。 |
| **分錄** | **借：Bank（銀行） / 貸：Stripe**，金額 = 該筆 payout，描述含 settlement id。 |
| **會計系統** | 用該 **operator (client)** 的會計（Bukku / Xero / AutoCount / SQL），`getPaymentDestinationAccountId(clientId, provider, 'bank')` 與 `'stripe'` 取得 Bank / Stripe 科目，寫入一筆 Journal。 |
| **寫回** | 分錄成功後更新 `stripepayout.accounting_journal_id`、`journal_created_at`，避免重複入帳。 |

也就是：**拿到 Stripe 的 payout（我們已有 stripepayout 記錄）→ 在該 operator 的 accounting 做「DR Bank, CR Stripe」。**

### Xendit（已實作）

Settlement 在會計裡就是一筆 **Journal**。Xendit 和 Stripe 的差別是：Xendit 的 payout 會帶出「手續費」，所以分錄要**把費用也記進去**：

| 項目 | Stripe（目前） | Xendit（已做） |
|------|----------------|----------------|
| **分錄** | DR Bank / CR Stripe（一筆兩欄） | **DR Bank**（實收淨額）<br>**DR Processing fees**（手續費，若 fee > 0）<br>**CR Xendit**（結算總額） |
| **概念** | 錢從 Stripe 進銀行，一筆對一筆 | 結算總額 = 銀行實收 + 手續費；銀行與費用同時入帳 |

也就是：**Xendit payout 時，用「結算總額」貸 Xendit，借項拆成「進銀行的」與「手續費」**，例如：

- 結算總額 1000、手續費 30、實收 970 → **DR Bank 970、DR Processing fees 30、CR Xendit 1000**。

| 項目 | 說明 |
|------|------|
| **Settlement 來源** | Cron 已呼叫 `fetchAndSaveSettlementsForAllClients()`，存進 `payex_settlement`；`payex/settlement-journal.service.js` 依 gross_amount、net_amount、mdr 計算 net 與 fee。 |
| **何時做帳** | Daily cron 在 fetch 後呼叫 `getPayexSettlementsPendingJournal()` → `processPendingPayexSettlementJournals()`，對 `bukku_journal_id IS NULL` 的列逐筆做分錄並寫回 `bukku_journal_id`。 |
| **科目 ID 從哪來** | 與 Stripe 相同：`getPaymentDestinationAccountId(clientId, provider, 'bank' \| 'xendit' \| 'processing_fee')`。這些會到 **account 表** 依 title 對應（Bank、Payex Current Assets/Xendit、Processing Fee），再從 **account_client** 取該 client + 該會計系統的 `accountid`（Bukku account_id、Xero AccountCode 等）。Operator 需在 **Accounting 設定頁**（portal operator/accounting）把這些 template 對應到自己的會計科目。 |
| **若 fee = 0** | 當 net = gross（例如尚未有 net 資料）時只做兩欄：DR Bank（gross）、CR Xendit（gross）；不要求 Processing Fee 對應。 |

---

## 3. 會計科目與 Accounting 設定頁

- **Account 表**：存的是**模板（template）**科目，例如 Bank、Stripe Current Assets、Payex Current Assets、Processing Fee、Rent Income、Expenses 等。每筆一列，有 `id`、`title`、`type`。
- **account_client**：每個 operator (client) 把自己的會計系統（Bukku / Xero / AutoCount / SQL）的**實際科目代碼**對應到這些 template：`account_id` = account.id，`client_id`，`system`，`accountid` = 該系統的 account 代碼。
- **getPaymentDestinationAccountId(clientId, provider, method)**：依 `method`（'bank' | 'stripe' | 'xendit' | 'processing_fee' 等）從 account 表找到對應 title 的 `account.id`，再從 account_client 取該 client + provider 的 `accountid`，即為寫 Journal 時用的科目 ID／代碼。

**Accounting 設定頁**（https://portal.colivingjb.com/operator/accounting）：列表中的 **item 就是上述 template**（來自 account 表）。Operator 在頁面上為每個 template 填寫「Bukku Account ID」等，即寫入 account_client；Settlement journal cron 做分錄時就會用這些對應到的 account ID。

---

## 4. Processing fees 有沒有幫顧客寫進會計？

**目前：沒有。**

- 我們扣 processing fee（Stripe 手續費+1% 或 Xendit operator 模式 1%+Xendit 費）時，只會：
  - 扣 **credit**（`deductClientCredit`）
  - 寫 **creditlogs**（type `RentRelease` / `PayexFee`，含金額、remark）
- **沒有**在顧客的會計系統（Bukku/Xero/AutoCount/SQL）裡自動產生「手續費」分錄。

所以顧客在 Billing 流水看得到扣款，但**會計系統裡不會自動多一筆 processing fee 的入帳**；若要自己記帳，要手動依 creditlogs 做。

---

## 5. 若要「幫顧客寫進去 accounting」可怎麼做？

在**每次扣 processing fee 並寫 creditlog 之後**，多一步：在該 operator (client) 的會計裡產生一筆 **費用分錄**，例如：

| 分錄概念 | 借方 | 貸方 |
|----------|------|------|
| 手續費支出、從平台餘額扣 | **Processing fee expense**（或「Payment gateway 手續費」） | **Prepaid / Platform credit**（平台餘額減少） |

需要：

1. **科目對應**：在 account 或設定裡，為每個 client 的會計系統提供：
   - 手續費費用科目（如 `processing_fee_expense` / `payment_gateway_fee`）
   - 平台餘額／預付科目（如 `prepaid_platform` / `platform_credit`），與我們扣 credit 對應
2. **呼叫時機**：
   - **Stripe**：在 `releaseRentToClient` 裡，`insertRentReleaseCreditlog` 成功後，呼叫一個新函式如 `createProcessingFeeJournal(clientId, amount, currency, creditlogId, { source: 'stripe', ... })`。
   - **Xendit（operator 模式）**：在 `deductPayexFeeAndLog` 寫完 creditlog 後，呼叫同一個 `createProcessingFeeJournal(..., { source: 'payex' })`。
3. **實作**：在 `rentalcollection-invoice` 或獨立的 `processing-fee-journal.service.js` 裡，依 `resolveClientAccounting(clientId)` 取得該 client 的會計 provider，用現有 `getPaymentDestinationAccountId` 或新欄位取得「手續費科目」「平台餘額科目」，然後呼叫 Bukku/Xero/AutoCount/SQL 的 create journal API，寫一筆 **DR 手續費費用、CR 平台餘額**，並可把 `creditlog_id` 寫進描述或 reference，方便對帳。

這樣就能在扣 processing fees 的同時，**幫顧客把這筆費用寫進他們的 accounting**。

---

## 6. 總結

- **是的，目前程式是 97% / 3%，約 1% 留在 SaaS。**
- **Settlement payout 入帳**：拿到 payout 就做 **借 Bank、貸 金流（Stripe/Xendit）**；Stripe 已實作，Xendit 待有穩定資料後對齊。
- **Processing fees**：目前**沒有**自動寫入顧客會計；若要幫顧客寫進去，需補「手續費分錄」（DR 手續費費用、CR 平台餘額）及對應科目與呼叫點（如上節）。
