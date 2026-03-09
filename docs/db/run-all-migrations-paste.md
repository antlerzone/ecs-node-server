# 从头到尾执行所有 Migration（粘贴到 Terminal）

两方谁先签都可以，没有顺序要求。

---

## 方式一：用现有 Node 脚本（推荐）

确保项目根目录已配置 `.env`（DB_HOST, DB_USER, DB_PASSWORD, DB_NAME），然后粘贴整段：

```bash
cd /home/ecs-user/app && for f in $(ls -1 src/db/migrations/*.sql | sort -V); do echo "=== $f ==="; node scripts/run-migration.js "$f" || exit 1; done && echo "All migrations done."
```

或先给脚本执行权限再运行：

```bash
cd /home/ecs-user/app
chmod +x scripts/run-all-migrations.sh
./scripts/run-all-migrations.sh
```

---

## 方式二：用 MySQL 客户端

若用 mysql 命令且已设好 `$DB`、`$USER`、`$PASS`：

```bash
cd /home/ecs-user/app/src/db/migrations
for f in $(ls -1 *.sql | sort -V); do echo "=== $f ==="; mysql -h "$DB_HOST" -u "$USER" -p"$PASS" "$DB" < "$f" || exit 1; done
echo "All migrations done."
```

---

## 执行顺序（sort -V）

0001 → 0002 → … → 0033_agreement_owner_portal_columns → 0033_agreement_pdf_columns → … → 0053 → 0054 → 0055_agreement_columns_locked
