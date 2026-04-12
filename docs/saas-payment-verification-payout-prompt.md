# SaaS Payment Verification & Payout — 超级开发 Prompt

可直接交给 **Cursor / GPT / 开发团队** 实现或扩展整个后端（DB schema + API + services）。与现有 Finverse wrapper、多租户 client_id、client_integration 约定一致。

---

## 1. 目标

构建多租户 SaaS 支付基础设施，支持：

- 银行转账付款核销（payment verification）
- 收据 OCR 提取
- 通过 Finverse 同步银行交易
- 自动/人工确认发票付款状态
- 批量转账 / 批量付款（Bulk Payout）
- 由 **Operator 自配 AI 服务商**（平台只做请求路由，不承担 AI 费用）

**SaaS 后端是所有付款状态的唯一事实来源。**

---

## 2. 多租户设计

每个 **Operator（租户，即 client_id）** 必须能：

1. 通过 **Finverse** 连接自己的**对公/对私银行账户**
2. 在后台配置**自己的 AI 服务商**（ChatGPT / Google Gemini / DeepSeek）
3. 使用**自己的 AI API Key / Token**

平台只负责 **AI 请求路由**，不支付 AI 用量。

**存储约定：**

- Finverse：`client_integration`，`key = 'bankData'`，`provider = 'finverse'`，`values_json` 含 `finverse_client_id`、`finverse_client_secret`、`finverse_redirect_uri`、可选 `finverse_login_identity_token`
- AI 配置：`client_integration`，`key = 'aiProvider'`，`provider = 'gemini'|'openai'|'deepseek'`，`values_json` 含 `api_key`（加密存储）、`model`

---

## 3. 付款核销流程

```
Invoice 创建
  → 客户通过银行转账 / PayLah / DuitNow 付款
  → 客户上传付款收据
  → AI OCR 提取付款信息
  → Invoice 状态 = PENDING_VERIFICATION
  → Finverse 同步银行交易到 bank_transactions
  → Payment Matching Engine
  → 匹配成功 → Invoice = PAID
  → 匹配失败 → 进入人工审核（PENDING_REVIEW）
```

---

## 4. 收据 OCR 要求

AI 必须从收据中提取结构化字段，例如：

```json
{
  "amount": 150,
  "currency": "MYR",
  "reference_number": "INV-10234",
  "transaction_id": "983746283",
  "payer_name": "John Tan",
  "transaction_date": "2026-03-16",
  "bank_name": "Maybank"
}
```

关键字段：`amount`、`reference_number`、`transaction_id`。

---

## 5. 付款匹配逻辑

用银行交易匹配发票，优先级：

1. **transaction_id** 一致
2. **reference** 包含发票号（reference_number）
3. **金额** 完全一致
4. **交易日期** 在 ±24 小时内
5. **付款人姓名** 相似度

规则：

- **confidence > 90%** → 标记发票 PAID
- **confidence 60–90%** → 人工审核（PENDING_REVIEW）
- **confidence < 60%** → 忽略（不自动匹配）

---

## 6. 人工审核流程

匹配失败或低置信度时：

- Invoice 状态 = `PENDING_REVIEW`
- Operator 后台需展示：收据图、OCR 结果、候选银行交易
- 操作：**Approve** → 标记 PAID；**Reject** → 标记 REJECTED

---

## 7. 数据库要求

### 7.1 必须持久化的表

- **bank_transactions**  
  字段：id, client_id, finverse_transaction_id（唯一）, bank_account_id, amount, currency, reference, description, payer_name, transaction_date, matched_invoice_id（nullable）, raw_json（可选）, created_at, updated_at  
  用途：防重复处理、审计、匹配引擎读取。

- **payment_invoice**（本系统内的“待核销发票”）  
  字段：id, client_id, external_invoice_id（nullable，如 rentalcollection.id）, external_type（rentalcollection|bill|manual）, amount, currency, reference_number, status, receipt_id（nullable）, matched_bank_transaction_id（nullable）, created_at, updated_at  
  status 枚举：UNPAID, PENDING_VERIFICATION, PENDING_REVIEW, PAID, REJECTED

- **payment_receipt**  
  字段：id, client_id, payment_invoice_id（nullable）, receipt_url, ocr_result_json, created_at

- **payment_verification_event**（审计）  
  字段：id, payment_invoice_id, event_type, payload_json, created_at

### 7.2 安全与一致性

- 收据**不能单独**确认付款，必须结合银行交易核销。
- 使用 **finverse_transaction_id** 唯一性防止重复入账。
- 所有状态变更写入 **payment_verification_event** 做审计。

---

## 8. 批量转账 / 批量付款（Bulk Payout）

Operator 通过 Finverse Payments API 创建付款批次。

流程概要：

```
Operator 连接银行（Finverse）
  → 创建 Payout Batch
  → SaaS Payout Engine
  → 调用 Finverse Payments API
  → 多笔单独转账
  → Webhook 更新每笔/批次状态
```

场景：工资、供应商付款、市场结算、佣金等。

需表：**payout_batch**（id, client_id, status, total_amount, currency, finverse_batch_id 等）, **payout_item**（id, payout_batch_id, amount, recipient_*, status, finverse_transfer_id 等）。

---

## 9. API 设计要点

- **Receipt 上传**：POST 收据图 → 存 OSS → 写 payment_receipt → 调 AI OCR → 创建/更新 payment_invoice，状态 PENDING_VERIFICATION。
- **同步银行交易**：定时或 Webhook 从 Finverse 拉取交易 → 写入/更新 bank_transactions（按 finverse_transaction_id 去重）。
- **匹配引擎**：对 PENDING_VERIFICATION 的 payment_invoice，用 OCR 结果与 bank_transactions 按上述规则算 confidence，自动 PAID 或 PENDING_REVIEW。
- **人工审核**：GET 待审核发票（含收据、OCR、候选交易）→ POST Approve/Reject。
- **Finverse 连接**：使用现有 `src/modules/finverse`（auth.generateLinkToken, auth.exchangeCodeForLoginIdentity, bankData.listTransactions）。

---

## 10. 安全规则（必须实现）

- 仅凭收据**不得**将发票标为 PAID；需有匹配的 bank_transaction 或人工批准。
- 同一 **finverse_transaction_id** 只允许匹配一张发票（或明确业务规则并写进 event）。
- 所有付款状态变更记录到 **payment_verification_event**。

---

## 11. 最终架构小结

```
客户付款
  → 上传收据
  → AI OCR 提取
  → PENDING_VERIFICATION
  → Finverse 银行交易同步 → bank_transactions
  → Payment Matching Engine
  → 成功 → Invoice PAID
  → 失败 → 人工审核 → Approve → PAID 或 Reject → REJECTED
```

将此文档与仓库内 **Finverse 模块**（`src/modules/finverse`）、**外键约定**（`mysql-fk-use-id-only.mdc`）一起使用，即可生成或扩展完整 backend skeleton（DB + API + services）。

---

## 12. Company Setting 两个集成（已实现）

- **AI Agent**：下拉 DeepSeek / ChatGPT (OpenAI) / Gemini；可选填写 API Key。存 `client_integration`（`key = 'aiProvider'`，`provider = 'deepseek'|'openai'|'gemini'`）。
- **Bank tracking**：由 addon「Bank Reconcile」控制；连接状态来自 Finverse（`key = 'bankData'`，`provider = 'finverse'`，`finverse_login_identity_token`）。Operator 在 Billing & Plan 增加 addon 后，再在 Company Setting 或单独流程连接 Finverse。

**无需新增 DB 表**：上述两项均使用现有 `client_integration`。Payment verification 表已由 migration `0118_payment_verification_tables.sql` 创建。
