# 在 ECS 上执行 0027_supplierdetail_backfill_client_id

迁移内容：
1. **Mapping**：用 `supplierdetail.client_wixid` 对焦 `clientdetail.wix_id`，回填 `supplierdetail.client_id`
2. 若尚未存在，则添加外键 `fk_supplierdetail_client`：`supplierdetail.client_id` → `clientdetail(id)`

不新建任何表（无 supplierdetail_client）。

## 方式一：用 run-migration（推荐，会读 .env）

```bash
cd /home/ecs-user/app && node scripts/run-migration.js src/db/migrations/0027_supplierdetail_backfill_client_id.sql
```

## 方式二：直接用 mysql 客户端

```bash
cd /home/ecs-user/app && mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0027_supplierdetail_backfill_client_id.sql
```

执行后建议检查：
- `SELECT id, client_wixid, client_id FROM supplierdetail LIMIT 20;` 有 client_wixid 的行应有对应的 client_id

---

## 若 client_id 仍为 NULL：先做诊断

1. **看 clientdetail 里有没有对应的 wix_id**（把下面 `817f6510-...` 换成你 supplierdetail 里实际的 client_wixid 值）：

```sql
SELECT id, wix_id FROM clientdetail WHERE TRIM(wix_id) = '817f6510-47ac-4f8f-9828-d2fd91cb406f' LIMIT 5;
```

若这里无结果，说明 clientdetail 里没有这个 wix_id，需要先在 clientdetail 补数据或确认两边用的是同一套 ID。

2. **看有多少 supplierdetail 能对上**：

```sql
SELECT COUNT(*) AS matched
FROM supplierdetail t
INNER JOIN clientdetail c ON TRIM(COALESCE(c.wix_id, '')) = TRIM(COALESCE(t.client_wixid, ''))
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';
```

若 matched > 0 但表里 client_id 还是 NULL，再执行一次迁移（见上「方式一」或「方式二」）。迁移已改为用 TRIM 对焦，避免首尾空格导致对不上。
