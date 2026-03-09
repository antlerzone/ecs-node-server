# Expenses 全走 Node — 操作步骤

按顺序执行下面步骤即可让列表、筛选项、新建/删除/标记已付/Bulk 上传/下载模板 全部由 Node 执行。

---

## Step 1：ECS 上给 bills 表加列（仅做一次）

SSH 登录 ECS 后：

```bash
cd /home/ecs-user/app
export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0020_bills_paidat_paymentmethod.sql
```

若报错 `Duplicate column name 'paidat'`，说明列已存在，可忽略。

---

## Step 2：确认 Node 已挂载 expenses 路由并重启（如需）

- 确认 `app.js` 里已挂载：`app.use('/api/expenses', require('./src/modules/expenses/expenses.routes'));`
- 若刚改过代码，重启应用，例如：  
  `pm2 restart app` 或 `node app.js` 重新起进程。

---

## Step 3：Wix 里替换 backend/saas/expenses.jsw

1. 在 Wix 打开 **Backend** → 找到或新建 **`saas/expenses.jsw`**。
2. 打开本仓库里的 **`docs/wix/jsw/velo-backend-saas-expenses.jsw.snippet.js`**，复制**全部**内容。
3. 粘贴进 Wix 的 **`backend/saas/expenses.jsw`**，保存并发布。

（这样 getExpenses、getExpensesFilters、insertExpenses、deleteExpenses、updateExpense、bulkMarkPaid、getBulkTemplateData 都会调 ECS。）

---

## Step 4：Wix 前端改 import 与筛选项/Bulk 数据源

1. **改 import**  
   把原来从 `backend/tenancy/expenses.jsw` 的引用改成从 **`backend/saas/expenses.jsw`**，并加上 `getExpensesFilters`：

   ```js
   import {
       insertExpenses,
       deleteExpenses,
       updateExpense,
       bulkMarkPaid,
       getExpenses,
       getExpensesFilters,
       getBulkTemplateData
   } from 'backend/saas/expenses.jsw';
   ```

2. **改筛选项（不再用 wixData）**  
   用 **`docs/wix/frontend/expenses-page-corrected.md`** 里「2) 筛选项和 Bulk 用 Node」那两段，替换你当前的：
   - `setupExpensesFilters` 整段
   - `loadBulkUploadMaps` 整段  

   即：下拉和 Bulk 的 property/supplier 都来自 `getExpensesFilters()`。

3. **（可选）快首屏**  
   同一份文档里的「3) 快首屏」：onReady 里先 `initDefaultSection()`、不显示全屏 Loading，再 `await startInitAsync()`；只有 access 失败时再在 `#textstatusloading` 显示错误。

保存并发布前端。

---

## Step 5：验证

1. 打开站点，登录后进 **Expenses**：列表、分页、筛选应正常（数据来自 Node）。
2. 新建一条、删除一条、单个标记已付、Bulk Paid、Bulk Delete、Bulk 上传、下载模板 各试一次，确认无报错且数据正确。
3. **Bank 批量转账**：选若干 expense → 菜单里点 Bank File → 选银行 → 下载，确认能生成文件（已是 Node，一般无需改）。

---

## 步骤小结

| Step | 做什么 |
|------|--------|
| 1 | ECS 执行 0020 迁移，给 bills 加 paidat、paymentmethod |
| 2 | 确认 Node 挂载 `/api/expenses` 并重启 |
| 3 | Wix 用 snippet 全量替换 `backend/saas/expenses.jsw` |
| 4 | 前端改 import + setupExpensesFilters + loadBulkUploadMaps（+ 可选快首屏） |
| 5 | 浏览器里测列表、写操作、Bulk、Bank 下载 |

做完以上，所有 Expenses 相关读写与 Bank Bulk Transfer 都由 Node 执行。
