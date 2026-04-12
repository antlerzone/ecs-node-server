# Xendit vs Stripe Connect 对比

从当前代码与产品行为整理，方便对齐「processing fees」与「settlement」能力。

**前提**：**Operator 可能在新加坡或马来西亚**（按 `clientdetail.currency`：SGD = 新加坡，MYR = 马来西亚）。**SAAS 平台为马来西亚公司**。  
- **Xendit 产品**本身支持新加坡 (SGD)、马来西亚 (MYR) 等多国（PayNow、卡、虚拟账户等）。  
- **当前产品规则**：新加坡 Operator 仅能使用 **Stripe**（SGD）；马来西亚 Operator 可选择 **Stripe** 或 **Xendit**（MYR）。若日后要对新加坡开放 Xendit，只需在 `payment-gateway.service.js` 的 `getClientPaymentGateway` 中允许 `currency === 'SGD'` 时也可返回 `payex`（当该 client 已接 Xendit 时），并确保 createPayment 等支持 SGD。

| 项目 | Stripe Connect | Xendit (Payex) |
|------|----------------|----------------|
| **适用地区（产品能力）** | Singapore (SGD)、Malaysia (MYR) | Xendit 支持 SG/MY 等；**当前我们仅对马来西亚 Operator 开放** |
| **Operator 接入方式** | OAuth：点 Connect 跳转 Stripe 授权，回填 `stripe_connected_account_id` | 填写子账号：Operator 注册 Xendit sub-account，把 **Test / Live Secret Key** 贴到公司设置 |
| **收款归属** | 租客付款 → 平台先收 → 扣费后 **Transfer** 到 Operator 的 Connect 账户 | 租客付款 → 直接进 Operator 的 **Xendit 子账号**（不经过平台收款） |
| **Processing fees** | ✅ **有**：从 Operator **credit** 扣（Stripe 手续费 + 1% 平台 markup）；不足时先挂 `stripe_rent_pending_release`，充值后自动 release | ✅ **已对齐**：从 Operator **credit** 扣（1% 平台 markup + Xendit 手续费若回调有 `adjusted_received_amount`）；不足时写入 `payex_fee_pending`，下次充值（Stripe 或 Payex）后自动扣并写 creditlog |
| **Settlement 可见性** | ✅ **有**：`stripepayout` 按 client + payout 日记录；daily cron 拉 pending payouts，写 accounting journal（DR Bank, CR Stripe） | ⚠️ **部分**：有 `payex_settlement` 表 + `fetchSettlements`，但 Xendit API 目前未返回可用的 transaction 列表，cron 跑完多为 0 笔；**无** 类似 Stripe 的 settlement journal（DR Bank, CR Xendit） |
| **Webhook** | ✅ 支付成功等事件 → 扣 credit、release Transfer、写 creditlog | ✅ Invoices paid → 更新 rentalcollection / creditlogs / metertransaction |
| **Accounting 入账** | ✅ 每日 cron：对未入账的 `stripepayout` 在 Bukku/Xero/AutoCount/SQL 建「Stripe payout to bank」分录 | ❌ 暂无：无 Payex 对应的 payout → 银行分录流程 |

---

## Xendit 平台费能力（xenPlatform Fee Rule）

Xendit **支持**平台向子账号收款收取 processing / platform fee：

- **Fee Rule**：平台在 Xendit 创建一条 Fee Rule（POST `https://api.xendit.co/fee_rules`），可设 **flat** 或 **percent**，以及 fee 要结算到的账户（默认主账号）。
- **创建 Invoice 时带上**：
  - Header `for-user-id`：子账号的 **Business ID**（Xendit 侧的子账号 ID）
  - Header `with-fee-rule`：上面创建的 **Fee Rule ID**
- **用谁的 key**：必须用**平台（SAAS）的 API key** 调创建 Invoice，这样款项会按 Fee Rule 拆成「子账号实收」+「平台费进主账号」。若用 Operator 子账号的 key 建单，则不会经过 Fee Rule，和目前行为一致。

参考：[Charging a Platform Fee | Xendit Docs](https://docs-dev.xendit.co/xenplatform/platform-fee)、[Create Fee Rule](https://developers.xendit.co/api-reference/xenplatform/create-fee-rule/)、[Split payments](https://docs.xendit.co/docs/split-payments)。

**我们当前未实现**：createPayment 用的是 Operator 存的 Secret Key（子账号），没有用平台 key + `for-user-id` + `with-fee-rule`。若要对齐 Stripe 的「平台收 processing fee」，需要：
1. 在 Xendit Dashboard 或 API 创建 Fee Rule（如 1% 或固定金额）。
2. 接入时除存子账号 Secret Key 外，还要存或解析出子账号的 **Xendit Business ID**。
3. 创建 Invoice 时改用**平台 Secret Key**，并传 `for-user-id` = 该 Operator 的 Business ID、`with-fee-rule` = 我们的 Fee Rule ID。

---

## 总结（是否「一样」）

- **接入与收款**：两边都能让 Operator 接上自己的收款账号（Stripe 用 Connect OAuth，Xendit 用子账号 Secret Key），并完成租客付款与 webhook 更新。
- **Processing fees**：Stripe 已做「从 credit 扣费 + Transfer」；**Xendit 产品上可以**用 Fee Rule 收平台费，但我们**尚未实现**（需改为平台 key 建单 + for-user-id + with-fee-rule）。
- **Settlement**：Stripe 有 payout 记录 + 每日 settlement journal；Xendit 仅有表与拉取逻辑，实际数据与会计分录都未接好。

若要 Xendit 在「processing fees」和「settlement」上对齐 Stripe Connect：

1. **Processing fees**：按上面「Xendit 平台费能力」接 Fee Rule + 平台 key 建单（并存/用子账号 Business ID）。
2. **Settlement**：用 Xendit 结算/交易 API 接好 `fetchSettlements`，再仿 Stripe 做 Payex payout 的 accounting journal 与 cron。
