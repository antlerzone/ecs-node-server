# Expenses 与 Bank 后端状态（是否用 Node 执行）

## 一、当前状态总览

| 功能 | 是否用 Node 执行 | 说明 |
|------|------------------|------|
| 列表 getExpenses | ✅ 是 | `POST /api/expenses/list` |
| 筛选项 getExpensesFilters | ✅ 是 | `POST /api/expenses/filters` |
| 1️⃣ 新建 Expense (insertExpenses) | ✅ 是 | `POST /api/expenses/insert` |
| 2️⃣ 删除 Expense (deleteExpenses) | ✅ 是 | `POST /api/expenses/delete` |
| 3️⃣ 单个标记 Paid (updateExpense) | ✅ 是 | `POST /api/expenses/update` |
| 4️⃣ Bulk Paid (bulkMarkPaid) | ✅ 是 | `POST /api/expenses/bulk-mark-paid` |
| 5️⃣ Bulk Delete | ✅ 是 | 同 deleteExpenses，传 ids 数组 |
| 6️⃣ Bulk Upload Excel | ✅ 是 | 前端解析 Excel 后调 insertExpenses → Node |
| 7️⃣ Download Template (getBulkTemplateData) | ✅ 是 | `POST /api/expenses/bulk-template` |
| Bank Bulk Transfer | ✅ 是 | `backend/access/bankbulktransfer.jsw` → `POST /api/bank-bulk-transfer`，Node 已完整实现 |

## 二、Node 端实现说明

- **Expenses 写操作**：已在 `src/modules/expenses/expenses.service.js` 与 `expenses.routes.js` 实现并挂到 `/api/expenses`。
- **bills 表**：标记已付需要 `paidat`、`paymentmethod` 列，已加迁移 `src/db/migrations/0020_bills_paidat_paymentmethod.sql`。**部署后执行一次**：  
  `mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0020_bills_paidat_paymentmethod.sql`
- **JSW**：`backend/saas/expenses.jsw`（见 `docs/wix/jsw/velo-backend-saas-expenses.jsw.snippet.js`）已全部改为调用 ECS，无存根。

## 三、Bank Bulk Transfer 是否完整？

- **完整。** Node 端已实现：
  - 不传 `bank`：返回 `{ banks: [{ label, value }] }`（供下拉用）。
  - 传 `bank` + `type` + `ids` + `email`：校验 access，按 bills 生成 supplier/owner 付款数据，返回 `{ success, billerPayments, bulkTransfers, accountNumber }`。
- Wix 端 `backend/access/bankbulktransfer.jsw` 已改为调用 ECS（见 `docs/wix/jsw/velo-backend-bankbulktransfer.jsw.snippet.js`），与 Node 对接正确。
