# #tablegr 数据来源说明

## 前端

- **#repeatergr** 列出物业；访客点击某一项的 **#buttongrdetail（View）** → 打开 **#sectiongrdetail**，并传入该 **property**。
- **#tablegr**：在 #sectiongrdetail 内，跟随当前点击的 property，显示该物业在 datepicker1gr～datepicker2gr 范围内的 **完整 payout**（rentalcollection 全部 + bills 全部 + 汇总行）。
- 若在 #sectiongrdetail 内添加了 **#tablebillsgr**，会单独用 `payout.billsRows` 填充，仅显示 bills 明细。
- 数据来源：`loadGRDetail(property)` → `generateOwnerPayout(propertyId, shortname, datepicker1gr, datepicker2gr)` → `payout.rows` 赋给 #tablegr，`payout.billsRows` 赋给 #tablebillsgr（若存在）。
- 列：`no`、`description`、`amount`。
- **#tablegr 结构**：income 行（Rental、**Forfeit Deposit**、**Parking**、**Topup**）→ **Gross Income** → expenses 行（Owner Commission、bills、Last Month Balance，按 description A-Z 排序）→ **Total Expenses** → **Net Income** → **Management Fee** → **Owner Payout**。
- **不进入 table**：Agreement Fees、Deposit、Tenant Commission（与旧 Wix 逻辑一致，不放在 income 也不放在 expenses）。
- **MeterTransaction**：status=success、isPaid=1、created_at 在日期范围内，按房间汇总为「Topup - Room名」收入行。

## 后端：generateOwnerPayout 用到的表与数据

后端根据 **datepicker1gr / datepicker2gr** 的日期范围，按 **property_id** 从以下 MySQL 表取数，组装成表格行（rows）：

| 顺序 | MySQL 表 | 条件 / 关联 | 填入 #tablegr 的内容 |
|------|----------|-------------|------------------------|
| 1 | **rentalcollection** | `property_id` + `date` 在 [start, end]；JOIN **account**（type_id）、**roomdetail**（room_id） | 分类**以 type_id 为准**（见下表）；已付（ispaid）才进 table。<br>• **Rental Income** → "Jan Rental - Room A" 等<br>• **Forfeit Deposit** → "Jan Forfeit Deposit - Room A"<br>• **Parking** → "Jan Parking - Room A"<br>• **Owner Commission** → 费用行 |
| 2 | **metertransaction** | `property_id` + 日期范围，status='success'、ispaid=1；JOIN tenancy、roomdetail | 按房间汇总为 **Topup - Room A** 等收入行 |
| (汇总) | - | - | **Gross Income** 行 |
| 3 | **bills** | `property_id` + `period` 在 [start, end]；JOIN **supplierdetail**（supplierdetail_id 或 billtype_wixid）取 utility_type | 每笔一行（均为 **expenses**）：utility_type=electric → "Electric"，water → "Water"，wifi → "Wifi"；其他 → 显示 bills 表 column **description** |
| 4 | **ownerpayout** | 上月同物业的 netpayout &lt; 0 | **Last Month Balance** 一行（冲抵） |
| 5 | **propertydetail** | 取该物业 percentage | 用于计算 Management Fee |
| (汇总) | - | - | **Total Expenses**、**Net Income**、**Management Fee**、**Owner Payout** 行 |

### bills 表与 supplierdetail（显示规则）

- **bills** 通过 **supplierdetail_id**（FK）或 **billtype_wixid**（reference）关联 **supplierdetail**；该单位、该日期范围内的 **所有 bills** 都会显示，且均为 **expenses**。
- **显示内容**（tablegr 的 description 列）按 **supplierdetail.utility_type**：
  - **electric** → 显示 **"Electric"**
  - **water** → 显示 **"Water"**
  - **wifi** → 显示 **"Wifi"**
  - 其它或空 → 显示 bills 表 column **description**（无则用 bill type title 或 "Other"）。
- 查询用 `LEFT JOIN supplierdetail s ON (s.id = b.supplierdetail_id OR ... billtype_wixid ...)` 以拿到 utility_type。

## rentalcollection 分类：type_id 优先，title 仅作 fallback

**原则：** 分类**以 `rentalcollection.type_id` 为准**（对应 `account.id`）；`rentalcollection.title` 为后端写入时自动生成，可能不准确，**仅当 type_id 为空或不在已知 account 列表时**才用 title 做 fallback。

### account 表与 getAccountTypeIds()

后端通过 **getAccountTypeIds()** 按 `account.title` 查询得到各类型 id（见下表）。**Parking** 在 account 表里 title 可能为 **"Parking"** 或 "Parking Fees"；若都查不到则使用已知 id `e517299a-60ad-479b-b54f-67f7e12a7b24`。**Forfeit Deposit** 的 id 为 `2020b22b-028e-4216-906c-c816dcb33a85`（title = "Forfeit Deposit"）。

| account.title（或 fallback） | 是否进 table | 归类 |
|-----------------------------|--------------|------|
| **Rental Income**           | 是           | **INCOME**（租金） |
| **Forfeit Deposit**         | 是           | **INCOME**（没收定金） |
| **Parking** / Parking Fees  | 是           | **INCOME**（停车费） |
| **Owner Comission**         | 是           | **EXPENSES**（业主佣金） |
| **Agreement Fees**          | 否           | 不显示 |
| **Deposit**                 | 否           | 不显示 |
| **Tenant Commission**       | 否           | 不显示 |

- **rentalcollection** 只取 **ispaid = 1** 的记录；未付的不进 table。
- **type_id 匹配时**：直接按上表归类，不读 title。
- **type_id 未匹配时（fallback）**：用 `rentalcollection.title` 或 JOIN 的 account.title 判断；若 title **包含** "forfeit deposit"、"rental income"/"rent income"、"owner comission"/"owner commission" 等，仍可正确归类；否则该行跳过并打 log。

## 为何可能没有 item

1. **Rental Income 条件过严**：此前代码要求 `receipturl` 有值才计入租金行；若数据是导入的、没有 receipturl，就不会出现 Rental 行。
2. **日期范围**：rentalcollection 用 `date`，bills 用 `period`；若前后端时区或格式不一致，查询可能落在范围外。
3. **数据本身**：该物业在所选日期内没有 rentalcollection / bills 记录，则只有汇总行（Gross Income、Total Expenses 等），没有明细行。
