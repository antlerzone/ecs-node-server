# 未使用的数据库列报告

基于 **src/** 与 **scripts/** 下所有 `.js` 的全文检索（整词匹配），以下列在应用代码中**没有任何引用**（仅在建表/迁移 SQL 中出现）。

生成方式：`node scripts/find-unused-db-columns.js`（依赖 `grep -rlw` 按列名整词搜索）。

---

## 未使用列列表

| 表名 | 列名 | 说明 |
|------|------|------|
| **creditlogs** | sourplan_id | FK → pricingplan(id)，当前无读写 |
| **doorsync** | requested_at | 门锁同步请求时间，表整体可能仅历史/迁移用 |
| **metertransaction** | meteridx | 序号/索引 |
| **metertransaction** | failreason | 失败原因 |
| **stripepayout** | stripe_connect_payout_id | Stripe Connect Payout ID，当前 INSERT/UPDATE 未写入，代码中无引用 |
| **syncstatus** | updatedat | 与 created_at/updated_at 命名风格不一致，未在代码中使用 |
| **syncstatus** | createdat | 同上 |

**合计：7 列**（已删除 roomdetail.link_room_detail_title_fld，见 migration 0063；meterdetail.meter_type 已在 Meter Setting list/get 中返回为 meterType，不再列为未使用）。

---

## 使用建议

- **删除前务必确认**：部分列可能被 `SELECT *` 或动态 SQL/脚本间接使用，或为后续功能预留。
- **sourplan_id**：若确定不再按「来源套餐」统计 creditlogs，可考虑弃用或归档。
- **doorsync / syncstatus**：若整表仅作历史/同步状态，可保留列；若表已废弃，可整体下线。
- **meter_type**：已在 Meter Setting API（list/get）中返回为 `meterType`，供前端使用。
- **meteridx / failreason**：meter 相关逻辑若只用其他列，可评估是否在报表或排查中需要后再决定是否保留。
- **link_room_detail_title_fld**：已通过 migration 0063 从 roomdetail 表删除。
- **stripepayout.stripe_connect_payout_id**：当前代码未写入该列；若不需要落库 Stripe Connect Payout ID，可考虑移除或保留作审计。

更新日期：根据当前仓库 `src/`、`scripts/` 与 migrations 生成。
