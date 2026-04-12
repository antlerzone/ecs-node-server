# 多少 Client / Room 才能平台月收入 100,000 MYR？

根据当前代码逻辑，平台月收入包含：**定价方案年费（Plan）**、**Add-on**、**租金 1% 平台 markup（processing 由客户承担，平台只收 1%）**。文档也含「屋主租金月收入 100k」的参考。

---

## 1. 代码里的常数（直接来自代码）

| 项目 | 值 | 出处 |
|------|-----|------|
| 每间 active room 每月扣费 | **10 credits** | `src/modules/billing/deduction.service.js`：`deductMonthlyActiveRoomCredit`，`amount = 10 * count` |
| 租金 processing 平台抽成 | **1%**（Stripe 费由客户 credit 扣，平台只收 1% markup） | `src/modules/stripe/stripe.service.js`：`PLATFORM_MARKUP_PERCENT = 1` |
| Active room 定义 | `roomdetail.active = 1` | 每月 1 号 cron 统计该 client 下 `roomdetail WHERE active = 1` 的数量 |
| 定价方案 | `pricingplan.sellingprice`（年费）、`pricingplan.corecredit` | 客户买 plan 得 core credit，1 年有效 |
| Add-on | `pricingplanaddon`（credit_json 等价年费） | 如 Bank Bulk 2500/年、Extra User 500/年 等 |

---

## 2. 综合估算：平台月收入 100,000 MYR（Plan + Add-on + 1% Markup）

假设（可在脚本中改）：

- **租金** ≈ 1,000/月（MYR 或 SGD 同 nominal）
- **30% 客户为 SGD**：1% markup 在 SGD 上按汇率折 MYR（如 1 SGD ≈ 3.5 MYR）
- **入住率** 90%（有租约的房间才产生租金 → 才有 1% markup）
- **Add-on**：约 20% 客户有 addon，平均年费等价 2,000 MYR

则：

- **每 client 月收入** = (Plan 年费/12) + (Add-on 折月) + (每 client 房间数 × 每房月 markup 折 MYR)
- **每房月 markup 折 MYR** = 70%×10 + 30%×(10×3.5) = 17.5 MYR（满租）；再 × 入住率 0.9 ≈ **15.75 MYR/房/月**
- 目标：**100,000 = N × (Plan 月均 + Add-on 月均 + R × 15.75)** → 解出 **N（client 数）** 和 **总 room = N × R**

脚本会从 DB 取 `pricingplan` 平均年费、当前平均每 client room 数，并代入上述假设，直接给出 **所需 client 数** 与 **所需 room 数**。

---

## 3. 屋主租金月收入 100,000（参考，非平台收入）

- 目标：屋主月租金收入 100,000
- 设平均每房月租 = **M**
- 则房间数 = **100,000 / M**（例：M=1,000 → 100 间）

---

## 4. 用脚本算（含 Add-on、1% markup、30% SGD）

运行（项目根目录）：

```bash
node scripts/calc-rooms-for-100k.js
```

脚本会：

- 从 DB 读 `pricingplan`、`pricingplanaddon`、active room 统计
- 用假设：租金 1000/月、30% SGD、SGD→MYR=3.5、入住率 90%、Add-on 20% 客户/年均 2000 MYR
- 输出：为达 **平台月收入 100,000 MYR** 所需的 **client 数** 与 **room 数**，以及 Plan / Add-on / 1% Markup 的收入占比

---

## 5. 小结

| 目标 | 公式/说明 |
|------|------------|
| 平台月收入 100k MYR | 月收入 = N×(Plan/12 + Add-on/12) + N×R×入住率×每房月 markup；解 N、总 room = N×R。Markup 折 MYR 含 30% SGD×汇率。 |
| 屋主租金月收入 100k | room 数 = 100,000 / 平均月租 M |

代码依据：`deduction.service.js`（10 credits/room/月）、`stripe.service.js`（1% markup）、`pricingplan` / `pricingplanaddon`、`tenancy.rental`。
