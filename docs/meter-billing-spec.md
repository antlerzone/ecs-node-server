# 电表分组与账单规则（Developer Specification）

本文档为电费系统的**最终版业务规则**：用量公式、Sharing Method、Payment Type、AUTO/MANUAL 引擎，以及 **12 种组合**的完整定义。模型为 **1 个 parent + 多个 child（子表）**，与 tenancy/房间无绑定；若业务上「每房一表」，则每个 child 可对应一房。实现时（Node tenantinvoice、Wix Meter Setting / Tenant Invoice）须与此保持一致。

---

## 1. 基础统一规则（含 CNYIoT 调用模型）

### 基本公式

```text
parentUsage     = 主电表用量（来自 CNYIoT getMonthBill）
totalChildUsage = 所有子表（child）用量之和
sharedUsage     = parentUsage − totalChildUsage   （不低于 0）
```

- **AUTO**：`sharedUsage = max(parentUsage − totalChildUsage, 0)`（系统按主表与子表读数自动算「剩余用量」）。
- **MANUAL**：`sharedUsage = parentUsage`（不扣子表，以管理员输入的 TNB 总账单对应主表用量为基数）。

**Remark**：

- 用量数据来源统一为 CNYIoT `getMonthBill`（见 `src/modules/cnyiot/wrappers/meter.wrapper.js` → `getUsageSummary`），按 `meterIds` 与 `start/end` 取各表用量，得到 `children[meterId]` 与 `total`。
- **CNYIoT 调用一律使用平台主账号**：后端通过 env `CNYIOT_LOGIN_NAME` / `CNYIOT_LOGIN_PSW` 获取平台账号，统一登录并缓存 token；每个 client 只在本地维护 `meterdetail`、`client_integration` 中的配置（如 `cnyiot_subuser_id`），**不再需要为每个 client 单独存 CNYIOT username/password**。

---

## 2. Sharing Method 定义（#dropdownsharing）

共 **3 种**：Percentage、Divide Equally、Room。与 tenancy 无关。

### 2.1 Percentage

- **规则**：按各 **child** 的 usage 占 **totalChildUsage** 的比例分配 sharedUsage。
- **usage=0 的 child**：自然分不到份额。

### 2.2 Divide Equally（重要）

- **规则**：**所有 child 平分**，包括 inactive/空位。
- **inactive 或空位**：那一份由屋主承担（屋主亏）。
- **例**：sharedUsage = 40，4 个子表（1 个 inactive）→ 40 ÷ 4 = 10；inactive 那 10 = 屋主亏。

### 2.3 Room（Active Child Only）

- **规则**：只算 **Active** 的 child；inactive 不参与分摊。
- **例**：sharedUsage = 40，4 个子表、1 个 inactive → 40 ÷ 3 ≈ 13.33；inactive 不承担，其他 child 对应户多摊。

---

## 3. Payment Type 定义

| 类型 | 含义 | 行为 |
|------|------|------|
| **Prepaid** | 先付费后用电 | 直接扣 meter balance；不开 invoice。 |
| **Postpaid** | 先用电后付费 | 开 invoice；不扣余额。 |

---

## 4. 两种 Engine 定义（AUTO / MANUAL）

### 4.1 AUTO 模式（Usage Engine）

- **特点**：不看 TNB bill；全部按 **sellingRate**（电表费率）计费。
- **公式**：
  - `finalUsage = ownUsage + shareUsage`（每个 child：自身用量 + 分摊到的 shared 部分）
  - `payment = finalUsage × sellingRate`

### 4.2 MANUAL 模式（Hybrid 模式）

- **特点**：Admin 输入 **TNB amount**；各 child 电已按 sellingRate 买过，只分 **sharedUsage**；sharedUsage 按 **TNB 单价** 算。
- **公式**：
  - `tnbUnitCost = totalTnbAmount / parentUsage`
  - `paymentShared_i = shareUsage_i × tnbUnitCost`

**Remark**：MANUAL 下各 child 自身用电已按 sellingRate 收费，仅「主表总账单 − 子表已计部分」按 TNB 单价摊给各 child。

---

## 5. 12 种组合（最终版）

### 5.1 PREPAID + AUTO（#1–3）

| # | Sharing | 规则 | 处理方式 |
|---|---------|------|----------|
| 1 | Percentage | 按 usage 比例分 | 扣 finalUsage × sellingRate |
| 2 | Divide equally | 所有 child 平分（inactive 屋主亏） | 扣 finalUsage × sellingRate |
| 3 | Room | 只 active child 分 | 扣 finalUsage × sellingRate |

### 5.2 PREPAID + MANUAL（#4–6）

| # | Sharing | 规则 | 处理方式 |
|---|---------|------|----------|
| 4 | Percentage | 按 usage 比例分 shared | 扣 share × TNB单价 |
| 5 | Divide equally | 所有 child 平分（inactive 屋主亏） | 扣 share × TNB单价 |
| 6 | Room | 只 active child 分 | 扣 share × TNB单价 |

### 5.3 POSTPAID + AUTO（#7–9）

| # | Sharing | 规则 | 处理方式 |
|---|---------|------|----------|
| 7 | Percentage | usage 比例 | invoice = finalUsage × sellingRate |
| 8 | Divide equally | 所有 child 平分（inactive 屋主亏） | invoice = finalUsage × sellingRate |
| 9 | Room | 只 active child 分 | invoice = finalUsage × sellingRate |

### 5.4 POSTPAID + MANUAL（#10–12）

| # | Sharing | 规则 | 处理方式 |
|---|---------|------|----------|
| 10 | Percentage | usage 比例分 shared | invoice = share × TNB单价 |
| 11 | Divide equally | 所有 child 平分（inactive 屋主亏） | invoice = share × TNB单价 |
| 12 | Room | 只 active child 分 | invoice = share × TNB单价 |

---

## 6. 核心概念小结

### Divide Equally vs Room

| 项目 | Divide Equally | Room |
|------|----------------|------|
| 参与分摊 | **全部 child** | **仅 Active child** |
| inactive | 也占一份，屋主亏 | 不参与，其他 child 多摊 |

### 系统核心总结

| 维度 | 规则 |
|------|------|
| **AUTO** | usage × sellingRate；不看 TNB。 |
| **MANUAL** | sharedUsage × TNB 单价；各 child 电不重复收费。 |
| **Prepaid** | 扣余额。 |
| **Postpaid** | 开 invoice。 |

---

## 7. 实现与代码参考

- **用量**：`src/modules/cnyiot/wrappers/meter.wrapper.js` → `getUsageSummary`（调 getMonthBill）。
- **分组与 sharing 配置**：Meter Setting 页（`docs/wix/frontend/metersetting-page-full.js`）、`src/modules/metersetting/metersetting.service.js`（submitGroup、loadGroupList）。**#dropdownsharing 仅 3 项**：Percentage、Divide Equally、Room（无 Tenancy）。
- **账单计算**：`src/modules/tenantinvoice/tenantinvoice.service.js`（handleUsagePhase、handleCalculationPhase）。当前实现已区分 parent_auto / parent_manual 与 percentage / divide_equally / room；Divide Equally「inactive 参与、屋主亏」等细节需按本规范补齐或校验。

---

## 8. 后续可补充

- Developer 版流程图（AUTO/MANUAL 分支、Prepaid/Postpaid 分支）。
- Edge cases：inactive 很多、全部 0 usage 等处理约定。
