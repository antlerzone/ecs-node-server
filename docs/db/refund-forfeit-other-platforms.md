# Refund Deposit & Forfeit Deposit 其他平台（Xero / AutoCount / SQL）要怎样办

## 〇、Account 表與 Account Setting 確認（Deposit 與調用時機）

### 1）四平台是否都有 Deposit 這一項？

- **有。** `account` 表是**共用**的，不按平台分表。  
- 種子資料 `0046_seed_account_defaults.sql` 裡有一筆 **title = `Deposit`**（type = liability, bukkuaccounttype = CURRENT_LIABILITY）。  
- Account Setting 頁面用的 `listAccountTemplates` 會列出**所有** account 行（含 Bank、Deposit、Rent Income、Expenses 等），所以 **Bukku / Xero / AutoCount / SQL** 看到的都是同一份 account 表，**Deposit 在四平台都存在**，只是每個 client 要為自己當前的 provider 在 Account Setting 裡**對應**到該系統的 Deposit 賬戶（見下）。

### 2）account_json 能否寫入／滿足需求？

- **可以。**  
- 映射來源有兩個（`getAccountMapping` 在 `rentalcollection-invoice.service.js`）：  
  1. **優先**：`account_client` 表（欄位：`account_id`, `client_id`, `system`, `accountid`, `product_id`）。  
  2. **若無對應 junction 列則回退**：`account.account_json`（JSON 陣列，每項需含 `clientId` 或 `client_id`、`system`（= provider）、`accountid`）。  
- Account Setting 儲存時（`saveBukkuAccount`）會**同時寫入**：  
  - `account_json`（在對應的 account 行上更新陣列），  
  - `account_client`（INSERT/ON DUPLICATE KEY UPDATE）。  
- 因此：**只要透過 Account Setting 儲存，或手動寫入 account_json 且格式正確**，refund / forfeit 讀取時都能拿到 Deposit 的 accountid，**account_json 可以滿足需求**。

### 3）調用時是否可以 Refund Deposit & Forfeit Deposit？

- **可以，前提是該 client 已為「Deposit」配好當前 provider 的賬戶。**  
- 邏輯：  
  - `getPaymentDestinationAccountId(clientId, provider, 'deposit')` 會用 `PAYMENT_TYPE_TITLES.deposit`（`['Deposit','deposit']`）在 account 表查出 Deposit 的 `id`，再依 `clientId` + `provider` 從 **account_client 或 account_json** 取 `accountid`。  
  - **Refund deposit**：`createRefundForRefundDeposit` 內會呼叫上述方法取 Deposit account，再依平台開退款（Bukku/AutoCount/SQL）；若沒有映射則回傳錯誤（例如 "No Xxx Deposit account"）。  
  - **Forfeit deposit**：`createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` 會用同一方式取 Deposit account 做沖賬；若沒有映射則該筆會進 `errors` 且不計入 `created`。  
- 結論：**只要 account 表有 Deposit 行，且該 client 在 account_client 或 account_json 裡有對應 provider 的 Deposit accountid，調用時就可以正常做 Refund Deposit 與 Forfeit Deposit。**

---

## 一、Refund Deposit（退押金）

### 业务含义

- 租客退租，管理员在 Admin Dashboard 将某笔 **refunddeposit** 标记为 done（#buttonmarkasrefund）。
- 会计上：从 **Deposit（负债）** 退还给租客（contact），即「负债减少 + 钱付给租客」。

### 当前实现

| 平台 | 状态 | 说明 |
|------|------|------|
| **Bukku** | ✅ 已实现 | Sales Refund，`deposit_items: [{ account_id: Deposit account, amount }]`，contact = 租客，description = Refund deposit \| room \| tenant \| date。 |
| **Xero** | ✅ 已实现 | 使用 Bank Transaction (Spend Money)：DR Deposit（LineItems.AccountCode = Deposit），CR Bank（BankAccount.Code）；Contact = 租客。 |
| **AutoCount** | ✅ 已实现 | 使用 Payment (Cash Book) API：`createPayment`，master: docDate / payTo(tenantName) / description，details: account = Deposit account code, amount。 |
| **SQL** | ✅ 已实现 | 使用 Payment API：`createPayment`，ContactId(tenant)、Amount、Date、Description、AccountCode = Deposit account。 |

### Xero 与配置

- **Xero**：已用 **Bank Transaction (Spend Money)** 实现退押金：创建一笔 Type=SPEND，Contact=租客，BankAccount=银行户（account_client 的 bank 或 env XERO_DEFAULT_BANK_ACCOUNT_CODE），LineItems 一条 AccountCode=Deposit（负债户），表示从银行付款、同时减少 Deposit 负债。
- **配置**：确保 **account 表** 有 Deposit 与 Bank，且 **account_client** 里为该 client 配置 Xero 的 Deposit 与 Bank 的 Code；若未配 Bank 则用 env `XERO_DEFAULT_BANK_ACCOUNT_CODE`。

---

## 二、Forfeit Deposit（没收押金）

### 业务含义与触发

- **在 Tenancy Setting 点击「终止」并填写没收金额（forfeitAmount）后**，会执行：1）插入一笔 forfeit 类型的 **rentalcollection**；2）**开 credit invoice**（`createInvoicesForRentalRecords`）；3）**做 payment / 收据**（`createReceiptForForfeitDepositRentalCollection` → 从 Deposit 冲账）。即 **invoice + payment 都在 Tenancy Setting 点击时一次执行**。
- 租客违约，退租时押金被没收。系统会：  
  - 插入一笔 **forfeit 类型的 rentalcollection**；  
  - 对该笔开 **credit invoice**（forfeit 收入）；  
  - 再把这笔标记为已付，且 **从 Deposit（负债）** 支付，即「用押金抵没收款」。

### 当前实现

| 平台 | 状态 | 说明 |
|------|------|------|
| **Bukku** | ✅ 完整 | Receipt 的 `deposit_items` 使用 `getPaymentDestinationAccountId(..., 'deposit')`，正确「从 Deposit 出数」。 |
| **Xero** | ✅ 已实现 | `payFromDeposit === true` 时用 `getPaymentDestinationAccountId(clientId, 'xero', 'deposit')` 的 account Code 作为 `Account.Code`，否则用 env 默认银行。 |
| **AutoCount** | ✅ 已实现 | `payFromDeposit === true` 时取 Deposit account，在 createReceipt payload 中传入 `accountCode`；未配置 Deposit 时报错。 |
| **SQL** | ✅ 已实现 | 同上，createReceipt payload 传入 `accountCode`（Deposit）。 |

### 配置

- 各平台在 **account 表** 的 Deposit 类型下，在 **account_client** 中为该 client 配置好对应系统的 Deposit 账户 id/code。

---

## 三、Account Setting Sync 按 Provider 細說（每個 provider 如何「開 account」）

Account Setting 裡的 **Sync** 會依當前 client 的 **provider**（client_integration 的 addonAccount）呼叫對應的 sync：`syncBukkuAccounts` / `syncXeroAccounts` / `syncAutoCountAccounts` / `syncSqlAccounts`。流程都是：**讀取 account 表全部模板（含 Deposit）→ 在該系統 list 現有 account → 依 title 對應；若沒有則在該系統 create → 把該系統的 account id/code 寫入 account_client + account_json**。Deposit 是其中一筆模板（title = `Deposit`），所以 Sync 後會在各 provider 裡有「Deposit」賬戶並寫好映射。

| Provider | Sync 流程（Deposit 如何被開／對應） |
|----------|--------------------------------------|
| **Bukku** | `accountWrapper.list` 取現有 accounts；對每筆 account 模板（含 Deposit）用 `name` + `type` 找現有，沒有則 `accountWrapper.create(name: title, type: bukkuaccounttype)`；Deposit 的 bukkuaccounttype = CURRENT_LIABILITY。把 `existingAccount.id` 寫入 account_client（system=bukku）。 |
| **Xero** | `xeroAccountWrapper.list` 取 Accounts；對每筆模板用 `Name` 對應，沒有則 `create(name, type: BUKKU_TO_XERO_TYPE[bukkuaccounttype], code)`；Deposit 對應 Xero 類型 CURRLIAB。把 `AccountID` 寫入 account_client（system=xero）。 |
| **AutoCount** | `autocountAccountWrapper.listAccounts`；對每筆模板用 name/description 對應 title，沒有則 `createAccount(name, type: bukkuaccounttype, classification: OPERATING)`。把傳回的 id/code 寫入 account_client（system=autocount）。 |
| **SQL** | `sqlaccountAccountWrapper.listAccounts`；對每筆模板用 name/AccountName 對應 title，沒有則 `createAccount(name, type: bukkuaccounttype)`。把傳回的 id/code 寫入 account_client（system=sql）。 |

---

## 四、每個 Provider 如何 Refund Deposit & Forfeit Deposit（細說）

以下「Deposit account」一律來自 **`getPaymentDestinationAccountId(clientId, provider, 'deposit')`**，即 account 表 title=Deposit 的 id 經 account_client（或 account_json）對應到該 provider 的 **accountid**（在 Bukku 為數字 id，Xero/AutoCount/SQL 多為 code 或字串 id）。

### 4.1 Bukku

| 項目 | 說明 |
|------|------|
| **Refund deposit** | 呼叫 **Sales Refund**：`bukkuRefund.createrefund`。Payload：`contact_id`（租客）、`date`、`currency_code`、`exchange_rate`、`description`（Refund deposit \| room \| tenant \| date）、**`deposit_items: [{ account_id: Number(Deposit accountId), amount }]`**。即從 Deposit 負債戶「退」一筆給租客。 |
| **Forfeit deposit** | 在 `createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` 裡，`destKey = 'deposit'`，取 Deposit accountId。呼叫 **Sales Payment**：`bukkuPayment.createPayment`。Payload：`contact_id`、`link_items`（沖 invoice）、**`deposit_items: [{ account_id: Number(Deposit accountId), amount }]`**。即用 Deposit 負債戶來「付」這張沒收押金的 invoice。 |

### 4.2 Xero

| 項目 | 說明 |
|------|------|
| **Refund deposit** | **已實現**。呼叫 **Bank Transaction (Spend Money)**：`xeroBankTransaction.createBankTransaction`。Type=SPEND，Contact=租客，BankAccount=銀行（account_client bank 或 XERO_DEFAULT_BANK_ACCOUNT_CODE），LineItems 一筆 AccountCode=Deposit（負債戶），表示從銀行付款給租客並減少 Deposit 負債（DR Deposit, CR Bank）。 |
| **Forfeit deposit** | 在 `createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` 裡，取 **Deposit account 的 Code**（getPaymentDestinationAccountId 的 accountId 即 Xero 的 Account Code）。呼叫 **Payment**：`xeroPayment.createPayment(req, { Invoice: { InvoiceID }, **Account: { Code: paymentAccountCode }**（= Deposit Code）, Date, Amount, Reference })`。若未配 Deposit 則用不到；有配則從 Deposit 負債戶沖賬。一般收款（非 forfeit）則用 env `XERO_DEFAULT_BANK_ACCOUNT_CODE`。 |

### 4.3 AutoCount

| 項目 | 說明 |
|------|------|
| **Refund deposit** | 呼叫 **Payment (Cash Book)**：`autocountPayment.createPayment`。Payload：`master: { docDate, payTo: tenantName, description: 'Refund deposit \| ...' }`，**`details: [{ account: Deposit accountCode, amount, description }]`**。表示從 Deposit 戶「付款」給租客（退押金）。Deposit account 來自 getPaymentDestinationAccountId(clientId, 'autocount', 'deposit')。 |
| **Forfeit deposit** | 在 `createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` 裡取 Deposit accountCode，在 **Receipt** payload 加上 **`accountCode`**。呼叫 `autocountReceipt.createReceipt(req, { invoiceId, amount, date, reference, **accountCode: Deposit accountCode** })`。即收款單指定從 Deposit 戶沖該 invoice。若 API 實際欄位名不同（如 bankCode），需依官方文件改 payload。 |

### 4.4 SQL

| 項目 | 說明 |
|------|------|
| **Refund deposit** | 呼叫 **Payment**：`sqlPayment.createPayment`。Payload：`ContactId`（租客）、`Amount`、`Date`、`Description`、**`AccountCode: Deposit accountCode`**（付款來源 = Deposit）。Deposit 來自 getPaymentDestinationAccountId(clientId, 'sql', 'deposit')。 |
| **Forfeit deposit** | 在 `createReceiptForPaidRentalCollection(..., { payFromDeposit: true })` 裡取 Deposit accountCode，在 **Receipt** payload 加上 **`accountCode`**。呼叫 `sqlReceipt.createReceipt(req, { invoiceId, amount, date, reference, **accountCode: Deposit accountCode** })`。即收款單從 Deposit 戶沖賬。若 API 實際欄位名不同，需依官方文件調整。 |

---

## 五、小结

- **Sync**：每個 provider 的 sync 都會對 account 表每一行（含 **Deposit**）在該系統 list → 依 title 對應 → 沒有則 create → 寫入 account_client（+ account_json），所以按一次 Sync 就會在該 provider 開好 Deposit 並寫好映射。
- **Refund deposit**：四平台均已實現：Bukku（Sales Refund）、Xero（Bank Transaction SPEND）、AutoCount/SQL（Payment）。
- **Forfeit deposit**：四平台皆為「收據/付款單」指定從 **Deposit** 出數：Bukku 用 deposit_items；Xero 用 Payment 的 Account.Code；AutoCount/SQL 用 Receipt 的 accountCode。
- 以上都依賴 **account 表有 Deposit 行**，且 **Sync 或手動儲存** 後 **account_client（或 account_json）** 有該 client + provider 的 Deposit accountid。
