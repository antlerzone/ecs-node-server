# Credit Invoice & Cash Invoice（四家会计系统）必填 / 校验对照

Rental collection 开单：**credit invoice**（应收、后付）或 **cash invoice**（即收、已付）。下表按各系统 validator / API 整理必填字段。

## 四家是否都有 Credit 与 Cash？

| 系统 | Credit Invoice（应收） | Cash Invoice（即收） |
|------|------------------------|----------------------|
| **Bukku** | ✅ `payment_mode: 'credit'` + term_items | ✅ `payment_mode: 'cash'` + deposit_items |
| **Xero** | ✅ Type ACCREC（Invoice） | ✅ 同 ACCREC + Payment（或线下在 Xero 里录收款） |
| **AutoCount** | ✅ Invoice（debtor + details） | ✅ 同 Invoice（我们这边 ispaid=1 即视为已收；若 API 有 Cash Sale 可单独用） |
| **SQL** | ✅ 销售发票 API | ✅ 同发票（或发票 + 收款单，依他们 API） |

即：**四家都支持 credit；cash 在 Bukku 为独立 cash 单，在 Xero 为 Invoice + Payment，AutoCount/SQL 用同一张发票我们标记已付即可。**

---

## Credit Invoice 必填（应收、后付）

---

## 1) Bukku（Credit Sales）

来源：`src/modules/bukku/validators/invoice.validator.js`（create_invoice_schema）。

| 字段 | 必填 | 说明 |
|------|------|------|
| **payment_mode** | ✅ | 必须 `'credit'`（我们开 credit invoice） |
| **contact_id** | ✅ | 数字，客户/联系人 ID |
| **date** | ✅ | 发票日期，ISO date |
| **currency_code** | ✅ | 例如 `MYR`，当前实现写死 MYR，可改为读 clientdetail.currency |
| **exchange_rate** | ✅ | 数字，我们传 1 |
| **tax_mode** | ✅ | `'inclusive'` 或 `'exclusive'`，我们传 `exclusive` |
| **form_items** | ✅ 至少 1 项 | 每项：**account_id**（必）、**description**（必）、**unit_price**（必）、**quantity**（必）；product_id 可选 |
| **term_items** | ✅（当 payment_mode=credit） | 至少 1 项，**payment_due**（必），即到期日 |
| **status** | ✅ | 如 `'ready'` |

**我们数据来源：**  
从 **account 表** 按 `type_id`（rentalcollection.type_id → account.id）取该 client + provider 的映射：  
`account_client` 或 `account.account_json` → **accountid**、**product_id**。  
即：type → account + product，与你说的一致。

---

## 2) Xero（ACCREC = 应收）

来源：`src/modules/xero/validators/invoice.validator.js`。

| 字段 | 必填 | 说明 |
|------|------|------|
| **Type** | ✅ | 我们固定 `'ACCREC'`（Sales / 应收） |
| **Contact** | ✅ | 至少一个：**ContactID**（UUID）或 **Name** |
| **LineItems** | ✅ 至少 1 项 | 每项：**Description**、**Quantity**、**UnitAmount**、**AccountCode** |
| **Date** | ✅ | 发票日期，ISO date |

| 字段 | 可选 | 说明 |
|------|------|------|
| DueDate | 可选 | 我们传与 Date 一致或 billing 的 dueDate |
| CurrencyCode | 可选 | 3 字元，不传用 tenant 默认 |
| Status | 可选 | 我们传 `AUTHORISED` |

**Contact：** 必须先在 Xero 有 contact（我们通过 ensureContactInAccounting 找/建），再传 ContactID 或 Name。  
**Product：** Xero 行项目用 **AccountCode**（会计科目）即可，不强制 product/service 码；我们来自 account 映射的 accountId。

---

## 3) AutoCount

来源：`src/modules/autocount/validators/invoice.validator.js`（createInvoiceSchema）。

| 字段 | 必填 | 说明 |
|------|------|------|
| **master.docDate** | ✅ | 单据日期 |
| **master.debtorCode** | ✅ | 债务人代码（我们 contact = debtor，用 contactId） |
| **master.debtorName** | ✅ | 债务人名称，我们传 description/title |
| **details** | ✅ 至少 1 项 | 每项：**productCode**（必）、**qty**（必）、**unitPrice**（必）；description 可选 |

**Contact：** 即 debtor；我们 ensureContactInAccounting(role=tenant/owner) 后得到 debtor code，传作 debtorCode。  
**Product：** 行项目必填 **productCode**；我们来自 account 映射的 productId，没有则传 `'GENERAL'`（需在 AutoCount 存在该 product/service code）。

---

## 4) SQL Account

来源：无项目内 validator，以官方 Postman / API 文档为准。  
当前实现传的 payload：`contactId`、`accountId`、`amount`、`description`、`date`。  
若官方要求必填 **currency、payment term、product 等**，需按他们文档在 `createInvoice` 的 payload 里补上。

---

## 小结（Credit Invoice 必有的东西）

| 系统 | Contact | Currency | Product / 行项目 | Payment term / 到期 |
|------|---------|----------|-------------------|----------------------|
| **Bukku** | ✅ contact_id | ✅ currency_code + exchange_rate | ✅ form_items[].account_id；product_id 可选 | ✅ term_items[].payment_due（credit 必填） |
| **Xero** | ✅ Contact (ID 或 Name) | 可选 | ✅ LineItems[].AccountCode | 可选 DueDate |
| **AutoCount** | ✅ master.debtorCode + debtorName | 未在 validator 要求 | ✅ details[].productCode | 未在 validator 要求 |
| **SQL** | 按 API 文档 | 按 API 文档 | 按 API 文档 | 按 API 文档 |

**Bukku：** 从 account 表按 type 拿到 account + product，contact 用 tenant 或 owner，payment term 用 term_items.payment_due（我们已按 billing 日期传）。  
**URL：** AutoCount / SQL 若 API 无返回或未提供公开链接，就不写 invoiceurl，只写 invoiceid；你已说没有 URL 也可以接受。
