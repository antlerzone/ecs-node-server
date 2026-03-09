# account 表：收款/付款用到的类型（Bank / Cash / Stripe / Deposit / Rental）

用 **account.id**（UUID），**不从 env 读**。  
流程：按 **account.title** 在表 `account` 里找到对应一行 → 用该行 **account.id** 在 **account_client**（或 **account.account_json**）里取 client + provider 的 accountid（会计系统里的 id）。

## 按 title 匹配

| 用途 | 匹配的 title（任一词匹配即可） |
|------|--------------------------------|
| **Bank** | Bank, bank |
| **Cash** | Cash, cash |
| **Stripe** | Stripe Current Assets, Stripe, stripe |
| **Deposit** | Deposit, deposit |
| **Rental** | Rent Income, Rental, rental, Platform Collection |
| **Expense**（费用/采购 DR 科目） | Expenses, expense, Platform Collection |
| **Management Fees**（管理费，开给屋主） | Management Fees, Management Fee, management fees |
| **Owner Payout**（屋主净支付，开 bill 给屋主） | Owner Payout, owner payout |
| **Platform Collection**（支付方式：用平台收款/付款） | Platform Collection, platform collection |

代码里用 `getAccountIdByPaymentType('bank'|'cash'|...|'expense'|'management_fees'|'owner_payout'|'platform_collection')` 查 `account.id`，再用 `getAccountMapping(clientId, account.id, provider)` 得到会计系统的 accountid（来自 account_client 或 account_json）。  
- Expense：Expenses 页 #buttonpay / #buttonbulkpaid 时 cash purchase 的 DR 方（CR 方用 Bank/Cash）。  
- Management Fees / Owner Payout：Generate Report 页 #buttonpay / #buttonbulkpaid 时 cash invoice（管理费给屋主）与 cash bill（净支付给屋主）的科目。  
- Platform Collection：**Liability**。Generate Report 支付屋主时：从 Bank/Cash 支付给屋主，Platform Collection 减少（DR）。#dropdownpaymentmethod 只有 Bank/Cash 两选项；Platform Collection 在代码里固定作为 DR 方（负债减少），Bank/Cash 为 CR 方（资产减少）。
