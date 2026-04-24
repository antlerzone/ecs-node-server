# Google Sheet → ECS 定时推送（类 schedule.gs）

## Property ID 映射（已核对模板 CSV）

模板文件：[Import_csv/Reservation Template - Property Detail.csv](../Import_csv/Reservation%20Template%20-%20Property%20Detail.csv)

- **第 A 列**：`Property Name`
- **第 B 列**：`_ID` — **即 Google Sheet `Reservation` 工作表第 L 列应填的 Listing UUID**（与 Wix `Propertydetail` 的 `_ID` / `sourceId` 同源概念）
- 其余列：`Cleaning Fees`、`hostplatformid`、`client` 等

### 与 `cln_property` 是否「一样」？

- **不一定等于 `cln_property.id`**：库规则里 `id` 可以是 Wix 主键 UUID，但 **ECS 排程接口查物业时用的不是只靠 `id`**。
- **必须与下列之一一致**（在 B2B Key 对应的 `operator_id` 下），`google-sheet-schedule` 才能解析到物业：

  `body.property`（= Sheet **L 列** = 模板 **B 列 `_ID`**）匹配：

  - `cln_property.homestay_source_id`，或
  - `cln_property.source_id`

  见 [cleanlemon-google-sheet-schedule.service.js](../../src/modules/cleanlemon/cleanlemon-google-sheet-schedule.service.js)（`homestay_source_id = ? OR source_id = ?`）。

- **结论**：Sheet L = 模板 B = **Antlerzone/Listing 侧 UUID**；与 `cln_property` 的关系是 **「外键式映射」到 `homestay_source_id` / `source_id`**，不要求列名相同，但 **导入/同步时必须把该 UUID 写入上述两列之一**。

### 上线前建议做一次 SQL 抽检（执行计划阶段在 ECS/DB 跑）

对几条真实 L 列 UUID：`SELECT id, homestay_source_id, source_id FROM cln_property WHERE operator_id = ? AND (homestay_source_id IN (...) OR source_id IN (...));`  
无行则需在物业同步脚本或导入里补 `homestay_source_id`/`source_id`。

---

## 原目标摘要

- GAS 定时：类似 `sendNewRows`，POST `https://api.cleanlemons.com/api/cleanlemon-sync/google-sheet-schedule`。
- **M 列**（表头 `ecs`）：成功后写 `Sent`。
- 去重：ECS 已按 `reservation_id` + `property_id` upsert（与 Wix 仅 `reservationId` 略有差异，见前文）。

## 交付物

- GAS 脚本 + 触发器说明 + `ECS_API_KEY` 脚本属性。
- 停用 Wix `scheduleInsert` 触发器避免双写。

## Todos

- [ ] 编写 GAS：扫 Reservation 未 Sent(M)、POST ECS、2xx 写 M=Sent
- [ ] 停用原 schedule.gs → Wix 的时间触发器
- [ ] （可选）若业务要求仅按 reservation_id 全局 upsert，再改 ECS
