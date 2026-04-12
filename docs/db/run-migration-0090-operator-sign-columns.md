# Run migration: `operator_signed_at` / `operator_signed_hash` on `agreement`

If logs show:

`Unknown column 'operator_signed_at' in 'field list'`

on `POST /api/admindashboard/agreement/operator-sign`, the DB has not applied **`0090_agreement_operator_signed_at_hash.sql`**.

## Apply（推荐：自动读 `.env`）

**`mysql` 命令行不会读取 `.env`**。若在 shell 里没有先 `export DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`，`-p"$DB_PASSWORD"` 会是空的，就会出现交互式 `Enter password:`。

在项目根目录用已有脚本（内部 `dotenv` 加载 `.env`）：

```bash
cd /home/ecs-user/app
node scripts/run-migration.js src/db/migrations/0090_agreement_operator_signed_at_hash.sql
```

或：

```bash
npm run migrate:sql -- src/db/migrations/0090_agreement_operator_signed_at_hash.sql
```

## 若坚持用 `mysql` CLI

先让变量进当前 shell（示例，按你机器上 `.env` 实际路径）：

```bash
cd /home/ecs-user/app
set -a && source .env && set +a   # 仅当 .env 可被 bash 直接 source 时有效
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0090_agreement_operator_signed_at_hash.sql
```

若 `.env` 含特殊字符导致 `source` 失败，请用上面的 **`node scripts/run-migration.js`**。

## 若曾报错 `Unknown column 'operator_signed_at' in 'agreement'`

旧版 `0090` 使用 `PREPARE` + 动态 `ALTER ... AFTER operator_signed_at`，被 `run-migration.js` 按 `;` 切分后会**截断字符串**，导致第一列未加上、第二句 `AFTER operator_signed_at` 失败。  
当前仓库里的 `0090` 已改为**两条普通 `ALTER TABLE`**（无 `AFTER`），请重新执行：

```bash
node scripts/run-migration.js src/db/migrations/0090_agreement_operator_signed_at_hash.sql
```

列已存在时会自动跳过重复列错误。

## Behaviour without migration

The Node app falls back to updating only `operatorsign` (+ `operator_signed_ip` if present) so operator sign does not 500. For full audit (`operator_signed_at`, `operator_signed_hash`), run the migration above.
