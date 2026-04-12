# 修复 Property Setting Save 500（property_supplier_extra 不存在）

当 `POST /api/propertysetting/supplier-extra` 或 `supplier-extra-save` 返回 500，且 **app** 日志为：

```
Table 'myapp.property_supplier_extra' doesn't exist
```

表示 **API 连的库（例如 myapp）里还没有这张表**。迁移必须在**同一台机、同一 .env（DB_NAME 与 app 一致）**下执行。

## 步骤

```bash
cd /home/ecs-user/app

# 确认 .env 里 DB_NAME 与 pm2 app 用的相同（例如 myapp）
# 跑迁移时会打印：Using database: xxx

# 1) 建表
node scripts/run-migration.js src/db/migrations/0096_property_supplier_extra.sql

# 2) 加 slot 列
node scripts/run-migration.js src/db/migrations/0097_property_supplier_extra_slot.sql

# 3) 重启 Node API（改的是 backend，不是 portal-next）
pm2 restart app
```

若迁移时打印的 database 不是 `myapp`，请把 .env 的 `DB_NAME` 改成与 app 一致后再跑迁移。
