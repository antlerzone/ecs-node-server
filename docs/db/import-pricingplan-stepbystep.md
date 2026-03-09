# PricingPlan / PricingPlanAddon / PricingPlanLogs 导入步骤

## 1. 准备 CSV

- **pricingplan.csv**：表头需包含（大小写可混用）  
  `ID` / `_id`、`Title`、`corecredit`、`features`（数组 JSON）、`description`、`sellingprice`、`addon`（数组 JSON）、`Created Date` / `Updated Date`（可选）
- **pricingplanaddon.csv**：表头需包含  
  `ID` / `_id`、`Title`、`description`（数组 JSON）、`credit`（数组 JSON）、`qty`
- **pricingplanlogs.csv**：表头需包含  
  `ID` / `_id`、`title`、`Scenario`、`Clientid`（对应 clientdetail）、`Amount`、`Amountcents`、`Status`、`Staff`（对应 staffdetail）、`Planid`（对应 pricingplan）、`Referencenumber`、`Paidat`、`Payload`（JSON）、`Payexreference`、`Txnid`、`Addons`（JSON）、`Addondeductamount`、`Redirecturl`

## 2. 执行迁移（仅首次或加列时）

为 `pricingplanlogs` 增加 `staff_wixid`、`plan_wixid` 列（用于 CSV 中的 Staff、Planid 解析为 staff_id、plan_id）：

```bash
# 在项目根目录
node scripts/run-migration.js src/db/migrations/0018_pricingplanlogs_staff_plan_wixid.sql
```

若表结构已由 `0001_init.sql` 创建且已跑过 0018，可跳过本步。

## 3. 清空表（再导入前）

**顺序**：先清空依赖 plan 的 logs，再清空 plan，最后清空 addon。

```bash
node scripts/truncate-pricingplanlogs.js
node scripts/truncate-pricingplan.js
node scripts/truncate-pricingplanaddon.js
```

## 4. 导入 CSV

**顺序**：先导入 plan 和 addon（无相互 FK），再导入 logs（logs 引用 pricingplan、staffdetail、clientdetail）。

```bash
node scripts/import-pricingplan.js ./pricingplan.csv
node scripts/import-pricingplanaddon.js ./pricingplanaddon.csv
node scripts/import-pricingplanlogs.js ./pricingplanlogs.csv
```

未写路径时默认分别为：`./pricingplan.csv`、`./pricingplanaddon.csv`、`./pricingplanlogs.csv`。

## 5. 字段与表对应关系摘要

| 表 | CSV 列（示例） | 库表列 | 说明 |
|----|----------------|--------|------|
| pricingplan | Title | title | 文本 |
| pricingplan | corecredit | corecredit | 数字 |
| pricingplan | features | features_json | 数组 JSON |
| pricingplan | description | description | 文本 |
| pricingplan | sellingprice | sellingprice | 数字 |
| pricingplan | addon | addon_json | 数组 JSON |
| pricingplanaddon | Title | title | 文本 |
| pricingplanaddon | description | description_json | 数组 JSON |
| pricingplanaddon | credit | credit_json | 数组 JSON |
| pricingplanaddon | qty | qty | 数字 |
| pricingplanlogs | Clientid | client_wixid → client_id | 关联 clientdetail |
| pricingplanlogs | Staff | staff_wixid → staff_id | 关联 staffdetail |
| pricingplanlogs | Planid | plan_wixid → plan_id | 关联 pricingplan |
| pricingplanlogs | Payload / Addons | payload_json / addons_json | JSON |

导入前请确保 **clientdetail**、**staffdetail** 已导入，以便 pricingplanlogs 的 Clientid、Staff 能解析为 client_id、staff_id；**pricingplan** 需先于 **pricingplanlogs** 导入，以便 Planid 解析为 plan_id。
