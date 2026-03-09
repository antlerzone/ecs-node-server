# Stripe settlement journal（Stripe 出金 → 銀行 分錄）

## 目的

租客的 meter / rental 進入 Stripe；當 **Stripe payout 到客戶銀行** 時，在客戶的 account system（Bukku / Xero）做一筆 **journal**：**DR Bank, CR Stripe**。

## 資料來源：stripepayout 表

- **stripepayout** 即每個 client 的 settlement 紀錄（一 client 一日一筆，或依你們寫入邏輯）。
- 不做新表；做過分錄後在 **同一張表** 寫回：
  - `accounting_journal_id`：會計系統回傳的 journal doc id
  - `journal_created_at`：分錄建立時間
- Schedule 跑時：撈 `journal_created_at IS NULL`（且 `total_amount_cents > 0`）的列，對每一筆做分錄並更新上述兩欄。

## 會計分錄（只做 journal 部分）

- 一筆 journal：同一金額 **DR Bank、CR Stripe**。
- 科目來自 `account` + `account_client`：`getPaymentDestinationAccountId(clientId, provider, 'bank')` 與 `getPaymentDestinationAccountId(clientId, provider, 'stripe')`。
- **Bukku**：journal entry 兩行（一行 DR Bank、一行 CR Stripe）。
- **Xero**：Manual Journal，LineAmount 負=借方、正=貸方。
- **AutoCount**：Journal Entry API（`/journalEntry`），master + details（accNo, dr, cr）。
- **SQL**：Journal Entry（path 預設 `JournalEntry`，可設 `SQLACCOUNT_JOURNAL_PATH`）；body 為 Date, Description, Lines: [{ AccountCode, Debit, Credit }]。若 SQL 實際 API 路徑或欄位不同，需依 Postman 調整 wrapper。

## 程式入口（給 schedule 用）

- **Service**
  - `getStripePayoutsPendingJournal(clientId?)`：撈待處理的 stripepayout 列（`journal_created_at IS NULL`）。
  - `processPendingStripePayoutJournals(rows)`：對多筆依序呼叫 `createJournalForStripePayoutRow(row)` 並更新表。
- **API**
  - `POST /api/stripe/process-settlement-journals`  
    Body: `{ clientId? }`。不傳 clientId 時處理「全部待處理」、需 admin（x-admin-key）；傳 clientId 時可依 access (email) 或 admin 限定該 client。  
    回傳：`{ ok: true, created, errors }`。

Schedule 可定期呼叫上述 API（帶 admin key、不傳 clientId）即可。

## Migration

- **0066_stripepayout_journal_columns.sql**：在 stripepayout 新增 `accounting_journal_id`、`journal_created_at`。
