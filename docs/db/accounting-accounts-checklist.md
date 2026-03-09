# Accounting：Invoice / Purchase / Bills / Expenses 所需科目檢查清單

本文列出所有會計相關開單／採購／費用流程，以及各自需要的 **account 表科目**（含 `account_client` 對應）。

---

## 一、流程與所需科目對照

| 流程 | 檔案／位置 | 用途 | 所需 account (title) | 備註 |
|------|------------|------|----------------------|------|
| **1. 平台 SaaS Bukku** | `billing/saas-bukku.service.js` | Topup / Pricing plan 開 cash invoice | 不讀 account 表，用 env：`BUKKU_SAAS_ACCOUNT`(70)、`BUKKU_SAAS_PAYMENT_BANK`(3)、`BUKKU_SAAS_PAYMENT_STRIPE`(71) | 平台自家 Bukku，與客戶會計分開 |
| **2. Rental collection → Credit Invoice** | `rentalcollection-invoice/rentalcollection-invoice.service.js` | 租金／押金等每筆開 credit invoice | `rentalcollection.type_id` → account.id → **account_client** 對應到系統 accountId | 收入科目依 type_id（Rent Income、Deposit 等） |
| **3. Rental collection → Receipt** | 同上 | 租客繳款入賬 | **Bank / Cash / Stripe / Deposit**（由 `getPaymentDestinationAccountId` 依付款方式取） | 需在 account 表有對應 title，並在 account_client 有 mapping |
| **4. Generate Report（業主出款）** | `generatereport/generatereport-accounting.service.js` | 管理費發票 + 業主淨付款 bill | **Management Fees**（收入）、**Platform Collection**（負債）、**Bank / Cash**（付款科目） | 缺一不可，否則開單失敗 |
| **5. Expenses / Bills 付款** | `expenses/expenses-purchase.service.js` | 單筆／批量 bills 標已付時開 cash purchase | **Expenses**（費用科目）、**Bank / Cash**（付款科目） | 供應商為 contact |
| **6. Settlement Journal（Stripe 出金）** | `stripe/settlement-journal.service.js` | Stripe payout → 分錄 DR Bank, CR Stripe | **Bank**、**Stripe Current Assets**（或 Stripe） | 兩邊都要有 account_client mapping |
| **7. Meter topup cash invoice** | `rentalcollection-invoice` | 租客繳電表費後開即收發票 | `type_id` = Deposit 對應的 account（TOPUP_AIRCOND）→ getAccountMapping | 依 type_id 與 account_client |
| **8. Refund deposit** | `rentalcollection-invoice` | 退押金 | **Deposit**（付款來源）、必要時 **Bank** | getPaymentDestinationAccountId('deposit' / 'bank') |

---

## 二、account 表必備 title（與 PAYMENT_TYPE_TITLES 對應）

`rentalcollection-invoice.service.js` 內 `PAYMENT_TYPE_TITLES` 會用 **title** 查 account.id，再經 **account_client** 取得各系統的 accountId。

| 關鍵字 (getAccountIdByPaymentType) | 可接受的 title | 0046 種子 | 0070 補充 | 用途 |
|-----------------------------------|-----------------|-----------|-----------|------|
| **bank** | Bank, bank | ✓ Bank | - | 收款／付款用銀行科目 |
| **cash** | Cash, cash | ✗ | ✓ Cash | 收款／付款用現金科目 |
| **stripe** | Stripe Current Assets, Stripe, stripe | ✓ Stripe Current Assets | - | Settlement journal CR、Stripe 相關 |
| **deposit** | Deposit, deposit | ✓ Deposit | - | 押金負債、退押金來源 |
| **rental** | Rent Income, Rental, Platform Collection | ✓ Rent Income | - | 租金收入等 |
| **expense** | Expenses, expense, Platform Collection | ✓ Expenses | - | 費用／bills 採購 DR |
| **management_fees** | Management Fees, Management Fee | ✗ | ✓ Management Fees | Generate Report 管理費發票收入 |
| **platform_collection** | Platform Collection | ✗ | ✓ Platform Collection | Generate Report 管理費收款＋業主出款 DR |

---

## 三、客戶端必須完成的設定

1. **account 表**  
   需有上述所有 title 的列（0046 + 0070 種子會寫入預設範本）。

2. **account_client 表**  
   每個使用會計的 client 需在「Account 設定」頁同步（或手動對應），把 account.id 對應到該客戶 Bukku/Xero/AutoCount/SQL 的 **accountid**（及選填 product_id）。  
   否則 `getAccountMapping` / `getPaymentDestinationAccountId` 會回傳 null，對應流程會失敗並記入 `recordAccountingError`。

3. **聯絡人**  
   - 租客／業主：開 credit invoice 前需在會計系統有 contact（contact-sync）。  
   - 供應商：bills 開 cash purchase 前需有 supplier contact。

---

## 四、檢查是否「都做好了」

- [ ] 已跑 **0046** + **0070** migration，account 表有：Bank, Cash, Rent Income, Deposit, Expenses, Product/Service, Stripe Current Assets, **Cash**, **Management Fees**, **Platform Collection** 等。
- [ ] 各會計 client 已在 Account 設定頁做過同步，**account_client** 有對應 accountid（至少：Bank, Cash, Stripe, Deposit, Expenses, Management Fees, Platform Collection）。
- [ ] 平台 SaaS Bukku 的 .env 已設 `BUKKU_SAAS_ACCOUNT`、`BUKKU_SAAS_PAYMENT_BANK`、`BUKKU_SAAS_PAYMENT_STRIPE`（若要用平台開單）。

完成以上，所有 accounting invoice / purchase / bills / expenses 應開的 Account 才會齊全。

---

## 五、Migration 與執行

- **0046**：預設科目（Bank, Rent Income, Deposit, Expenses, Stripe Current Assets 等）。
- **0070**：補齊 **Cash**、**Management Fees**、**Platform Collection**（若無則 Generate Report 與現金付款會缺科目）。

```bash
node scripts/run-migration.js src/db/migrations/0070_seed_account_cash_management_platform.sql
```
