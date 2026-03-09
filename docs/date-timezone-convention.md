# 日期与时区约定（马来西亚/新加坡 UTC+8）

## 原则

- **客户在马来西亚、新加坡 (UTC+8)。**
- **MySQL 一律存 UTC (UTC+0)**；连接池已设 `timezone: '+00:00'`。
- **Datepicker 选 1 March 2026 = UTC+8 的 1 March**；所有带日期的查询、展示都按此对齐。

---

## 1. 前端 Datepicker → 后端查询

- 访客在 datepicker 选的日期视为 **UTC+8 的日历日**（例如选 1 Mar 2026 = 马来西亚/新加坡的 3 月 1 日）。
- 前端把该日期以 **YYYY-MM-DD** 传给 API（如 `startDate`、`endDate`、`from`、`to`、`period`、`paidDate` 等）。
- 后端收到后：
  - **做范围查询时**：用 `malaysiaDateRangeToUtcForQuery(from, to)` 转成 UTC 的起止时间，再与 DB 里 UTC 的 `period`/`date`/`created_at` 等比较。
  - **写表时**：若写入的是「日历日」（如 `paidDate`），用 `malaysiaDateToUtcDatetimeForDb(paidDate)` 转成 UTC 再写入 datetime 列。

已按此处理的接口示例：

- **Owner Portal**：`owner-payout-list`、`cost-list`、`export-report-pdf`、`export-cost-pdf`（body: `startDate`, `endDate`）→ 用 `malaysiaDateRangeToUtcForQuery` 查 DB。
- **Generate Report**：`owner-reports`（body: `from`, `to`）→ 同上。
- **Billing / Indoor Admin**：收到 `paidDate` 等时，写入前应用 `malaysiaDateToUtcDatetimeForDb`（若列为 datetime）。

---

## 2. 读 Table → 返回前端（一律 UTC+8）

- 从表里读出的 **datetime/date**（如 `created_at`、`updated_at`、`period`、`date`、`paidat`、`begin`、`end` 等）在返回给前端前，**一律按 UTC+8 转成展示用日期**。
- 实现方式：
  - **全局**：`app.js` 里对 `/api/*` 的 `res.json(body)` 做了包装，调用 `formatApiResponseDates(body)`，把常见日期字段转成 **YYYY-MM-DD（UTC+8）**。
  - 日期字段名见 `src/utils/dateMalaysia.js` 的 `DEFAULT_DATE_KEYS`；新增返回日期字段时，可加入该列表以自动格式化。

这样前端拿到的所有日期都是「按马来西亚/新加坡日历的日期」，不会出现 3 号变 2 号等问题。

---

## 3. 工具函数（src/utils/dateMalaysia.js）

| 函数 | 用途 |
|------|------|
| `getTodayMalaysiaDate()` | 当前 UTC+8 的「今天」YYYY-MM-DD（业务判断、cron 等） |
| `malaysiaDateToUtcDatetimeForDb(malaysiaDateOrYYYYMMDD)` | 前端/datepicker 的日期 → 写表用 UTC 字符串 |
| `malaysiaDateRangeToUtcForQuery(fromYYYYMMDD, toYYYYMMDD)` | 日期范围 → UTC 起止时间，用于 WHERE |
| `utcDatetimeFromDbToMalaysiaDateOnly(utcStrOrDate)` | 表里 UTC → UTC+8 的 YYYY-MM-DD |
| `formatApiResponseDates(payload)` | 递归把 payload 中已知日期字段格式化为 UTC+8（供 res.json 前调用或中间件） |

---

## 4. 小结

- **Datepicker 选 1 March 2026** → 前端传 `2026-03-01`，后端视为 **UTC+8 的 3 月 1 日**，查库用 UTC 范围，写表用 UTC。
- **读 table 返回** → 所有日期字段经 `formatApiResponseDates` 转为 **UTC+8 的 YYYY-MM-DD**，前端直接用于展示或回填 datepicker。
