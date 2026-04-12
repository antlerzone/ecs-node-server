# rentalcollection 导入完整步骤（PowerShell）

从本机 **PowerShell** 进入 ECS，改表 → 导入 → 回填，按顺序执行即可。

---

## 前置准备

- 本机已安装 **OpenSSH**（Win10/11 一般已有，没有可在「设置 → 应用 → 可选功能」里添加 OpenSSH 客户端）。
- 你有 ECS 的 **登录账号**（如 `ecs-user`）和 **IP 或主机名**。
- 项目代码已在 ECS 上（例如在 `/home/ecs-user/app`），且已配置 `.env`（含 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`）。

---

## Step 1：用 PowerShell 连上 ECS

1. 打开 **PowerShell**（Win + X → Windows PowerShell，或开始菜单搜 PowerShell）。
2. 执行（把 `你的ECS的IP` 和 `ecs-user` 换成你的）：

```powershell
ssh ecs-user@你的ECS的IP
```

3. 提示 `Are you sure you want to continue connecting?` 输入 `yes` 回车。
4. 输入 ECS 用户密码，回车，进入 ECS 后提示符类似：`[ecs-user@xxx app]$` 或 `[ecs-user@xxx ~]$`。

---

## Step 2：进入项目目录

在 ECS 上（SSH 连上后的终端里）执行：

```bash
cd /home/ecs-user/app
```

如你的项目不在这个路径，改成你实际路径，例如：

```bash
cd ~/app
```

确认当前在项目根目录（能看到 `app.js`、`package.json`、`scripts`、`src`）：

```bash
dir
```

（Linux 下也可用 `ls`。）

---

## Step 3：执行改表 migration（0040）

在项目根目录下执行：

```bash
node scripts/run-migration.js src/db/migrations/0040_rentalcollection_import_columns.sql
```

成功会看到类似：

```
Migration 0040_rentalcollection_import_columns.sql finished.
```

若报错，检查：

- 当前目录是否是项目根（有 `scripts/run-migration.js`）。
- `.env` 里数据库配置是否正确。
- 本机能否连上 ECS 上的 MySQL（若 MySQL 在别的机器，确认 `DB_HOST` 等）。

---

## Step 4：把 CSV 传到 ECS（你要导入的那份）

在 **你本机** 再开一个 PowerShell 窗口（不要关掉已 SSH 的那一个），在 **放 CSV 的目录** 下执行（把路径和 IP 换成你的）：

```powershell
scp D:\你的路径\rentalcollection.csv ecs-user@你的ECS的IP:/home/ecs-user/app/
```

例如 CSV 在桌面：

```powershell
scp $env:USERPROFILE\Desktop\rentalcollection.csv ecs-user@你的ECS的IP:/home/ecs-user/app/
```

输入 ECS 密码后，文件会传到 ECS 的 `/home/ecs-user/app/rentalcollection.csv`。  
若你用别的文件名或路径，后面 Step 5 里把 `rentalcollection.csv` 改成实际文件名。

---

## Step 5：在 ECS 上导入 CSV 到 MySQL

回到 **已 SSH 进 ECS 的那个终端**，仍在项目根目录 `/home/ecs-user/app`。

**若要清空后重导（推荐重导时先清空）：**

```bash
node scripts/truncate-rentalcollection.js
```

**用 Node 导入脚本（推荐）：**

```bash
node scripts/import-rentalcollection.js rentalcollection.csv
```

脚本会：
- 把 CSV 的 **ID / _id** 写入列 **wix_id**；主键 **id** 使用新 UUID。
- 把 tenant/room/property/type/client/tenancy 等列直接写入对应 **_id** 列（0087 后）。
- 用各表 **wix_id** 解析并填入 FK：**client_id**（clientdetail）、**property_id**（propertydetail）、**room_id**（roomdetail）、**tenant_id**（tenantdetail）、**type_id**（account）、**tenancy_id**（tenancy）。

默认 CSV 路径为 `./rentalcollection.csv`，也可写绝对路径。导入后无需再跑 0041（脚本已做 _id 解析）；若部分行因 wix_id 对不上未填 _id，可再跑 0041 补回。

导入后可在 MySQL 里抽查行数：

```bash
mysql -u你的MySQL用户 -p 你的库名 -e "SELECT COUNT(*) FROM rentalcollection;"
```

---

## Step 6：执行回填 migration（0041，可选）

导入脚本已在导入时根据各表 wix_id 填好 client_id / property_id / room_id / tenant_id / type_id / tenancy_id。若仍有行这些列为 NULL（例如某条 wix_id 在目标表不存在），可再跑 0041 补回 property_id / room_id / tenant_id / type_id（0041 不填 client_id、tenancy_id，需 0021 / 0032 或导入脚本已做）：

```bash
node scripts/run-migration.js src/db/migrations/0041_rentalcollection_backfill_id_from_wixid.sql
```

---

## Step 7：确保外键（可选）

若需保证 `rentalcollection` 的 client_id / property_id / room_id / tenant_id / type_id / tenancy_id 均有 FK 约束（0001 与 0032 通常已建），可执行：

```bash
node scripts/run-migration.js src/db/migrations/0042_rentalcollection_ensure_fk.sql
```

0042 会检测各 FK 是否存在，不存在则添加；重复执行安全。

---

## Step 8：检查列表是否有数据

- 在浏览器打开发票页，看 **#repeaterinvoice** 是否已有数据。
- 或在 ECS 上查：

```bash
mysql -u你的MySQL用户 -p 你的库名 -e "SELECT id, title, amount, property_id, tenant_id FROM rentalcollection LIMIT 5;"
```

确认 `property_id`、`tenant_id` 等不再是 NULL（说明回填成功）。

---

## 步骤一览（复制用）

| 步骤 | 在哪里执行 | 命令 |
|------|------------|------|
| 1 | 本机 PowerShell | `ssh ecs-user@你的ECS的IP` |
| 2 | ECS 终端 | `cd /home/ecs-user/app` |
| 3 | ECS 终端 | `node scripts/run-migration.js src/db/migrations/0040_rentalcollection_import_columns.sql` |
| 4 | 本机 PowerShell（新窗口） | `scp D:\路径\rentalcollection.csv ecs-user@IP:/home/ecs-user/app/` |
| 5 | ECS 终端（重导时先做） | `node scripts/truncate-rentalcollection.js` |
| 6 | ECS 终端 | `node scripts/import-rentalcollection.js rentalcollection.csv` |
| 7 | ECS 终端（可选） | `node scripts/run-migration.js src/db/migrations/0041_rentalcollection_backfill_id_from_wixid.sql` |
| 8 | ECS 终端（可选） | `node scripts/run-migration.js src/db/migrations/0042_rentalcollection_ensure_fk.sql` |
| 9 | 浏览器或 MySQL | 查 repeaterinvoice / 查表 |

列对照与表结构见同目录 **rentalcollection-import-columns.md**。
