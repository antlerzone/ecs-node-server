# Xendit 平台先收再分（xenPlatform Master + Split Rule）

与 Stripe Connect 一致：**租客付 1000 → operator 实收 1000**。2.5%+1% 的 processing fees 由 SAAS 平台支付，Node 里从 operator 的 credit 扣回（2.5% Xendit 费 + 1% 平台 markup）。

## 两种模式

| 模式 | 配置 | 钱流 | 扣 operator credit |
|------|------|------|--------------------|
| **Operator 模式**（原逻辑） | 每个 operator 填自己的 Xendit Secret Key | 顾客付款 → 直接进 operator 的 Xendit 账户 | 扣 1% + Xendit 费 |
| **Platform 模式** | 平台在 env 配 `XENDIT_PLATFORM_SECRET_KEY` + `XENDIT_PLATFORM_ACCOUNT_ID`，operator 填 **Xendit Sub-account ID** | 顾客付款 → 先进平台 Master → Split **100%** 给 operator（扣费后余额）→ 平台再 **Transfer** 2.5% 给 operator → operator 实收 1000 | 扣 **2.5%+1%**（平台先付费用，从 credit 扣回） |

Xendit 支持新加坡 (SGD) 与马来西亚 (MYR)。新加坡 operator 也可选 Xendit；开单 / Split / Transfer 与 credit 扣费按 client 的 `clientdetail.currency` 使用对应币种。

**Operator 不选 test/live**：新户口 operator 仅能「注册」(Create sub-account)，不能选 test mode。Test 或 live 由**平台**的 env（`XENDIT_PLATFORM_USE_TEST`、`FORCE_PAYMENT_SANDBOX`）决定；发 checkout 时用平台 key（sandbox 则全站 test，上线换 live key 则全站 live）。Company Setting 的 Xendit 弹窗在 Platform 模式下不显示「Use test mode」与 Test/Live Secret Key 输入框。

## 环境变量（Platform 模式）

在 `.env` 中配置（仅 Platform 模式需要；**测试环境**可用 test key）：

```bash
# Xendit 平台 Master（xenPlatform）
XENDIT_PLATFORM_SECRET_KEY=xnd_production_xxxx
# 平台 Master 的 Business ID（用于 Transfer：把 2.5% 手续费转给 operator，使 operator 实收 1000）
XENDIT_PLATFORM_ACCOUNT_ID=your_master_business_id
# 测试环境（Company Setting 里「Create Sub-account」会用到）
XENDIT_PLATFORM_TEST_SECRET_KEY=xnd_development_xxxx
XENDIT_PLATFORM_USE_TEST=1
```

- 不设 `XENDIT_PLATFORM_SECRET_KEY`：仅支持 Operator 模式（每个 operator 自己的 key）。
- **XENDIT_PLATFORM_ACCOUNT_ID**：Master 账号的 Business ID（即 Transfer API 的 `source_user_id`）。**不在 API Keys 页**，要在 **xenPlatform → Accounts** 里找：点「Create transfer」时 From 下拉会显示各账号的 Account ID，或 Accounts 列表里你平台（Master）那一行的 Account ID。若不设，不会执行「平台 → operator」的 Transfer，operator 只能收到 Split 后的金额（约 97.5%），但 Node 仍会扣 2.5%+1% 的 credit。
- 设了平台 key 后，operator 可在 **Company Setting → Payment Gateway → Xendit** 中二选一：
  - **Platform 模式**：只填 **Xendit Sub-account ID**，无需填 Secret Key。平台用 Master key 开单 + Split Rule（100% 给 operator），付款成功后平台再 Transfer 2.5% 给 operator，operator 实收与租客支付同额。
  - **Operator 模式**：填 Test/Live Secret Key，款直接进 operator 的 Xendit。

## 后端逻辑摘要

- **createPayment(clientId, params)**  
  - 若 `getPayexPlatformConfig(clientId).usePlatformFlow` 为 true：  
    - 用平台 key 调用 `ensureClientSplitRule(clientId)` 取得或创建 Split Rule（**100%** → operator）。  
    - 用 `createInvoiceWithSplitRuleViaApi` 创建 invoice（header `with-split-rule`），metadata 含 `client_id`。  
  - 否则：用该 client 的 Xendit key 调 `Invoice.createInvoice`（原逻辑）。
- **handleCallback**  
  - 成功时若为 Platform 模式：先 **transferFeeToOperatorIfPlatform**（平台转 2.5% 给 operator，使 operator 实收 1000），再 **applyPayexFeeDeduction**（从 operator credit 扣 2.5%+1%）。

## 迁移路径

1. 在 Xendit 开通 **xenPlatform**，将平台账号作为 Master，为每个 operator 创建 **Sub-account**（或使用既有 sub-account）。
2. 在 Xendit Dashboard 获取每个 operator 的 **Business ID**（Sub-account 的 ID）。
3. 在 ECS `.env` 中设置 `XENDIT_PLATFORM_SECRET_KEY`（及可选 TEST）。
4. 各 operator 在 Company Setting → Payment Gateway → Xendit 中填写 **Xendit Sub-account ID**（即 Business ID），可不填 Secret Key；保存后该 client 走 Platform 模式。
5. 未填 Sub-account ID、只填 Secret Key 的 client 仍走 Operator 模式，行为与改造前一致。

相关代码：`src/modules/payex/payex.service.js`（`getPlatformXenditConfig`、`getPayexPlatformConfig`、`ensureClientSplitRule`、`createInvoiceWithSplitRuleViaApi`、`createPayment`、`applyPayexFeeDeduction`）、`src/modules/companysetting/companysetting.service.js`（`payexConnect` 接受 `xendit_sub_account_id`）。
