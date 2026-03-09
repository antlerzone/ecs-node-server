# 清空 account 表并上传 bukkuid.csv 到 ECS（PowerShell 步骤）

在 **Windows PowerShell** 中按顺序执行（密钥与 CSV 路径请按你本机修改）。

---

## 1. 上传 CSV 到 ECS

在 PowerShell 里执行（把 `C:\Users\User\Downloads\bukkuid.csv` 和 `.\malaysia-ecs-key.pem` 换成你的实际路径）：

```powershell
scp -i .\malaysia-ecs-key.pem C:\Users\User\Downloads\bukkuid.csv ecs-user@47.250.141.3:/home/ecs-user/app/bukkuid.csv
```

---

## 2. SSH 登录 ECS

```powershell
ssh -i .\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

---

## 3. 在 ECS 上清空 account 表并导入

登录后依次执行：

```bash
cd /home/ecs-user/app
```

```bash
node scripts/truncate-account.js
```

```bash
node scripts/import-account.js bukkuid.csv
```

看到 `Done. Inserted N rows into account` 即导入成功。

---

## 4. （可选）导入后同步 client_id

若 CSV 里是 client 的 wix_id，需要跑一次 backfill 把 `account.client_id` 填上：

```bash
# 若项目里有 0047 迁移，可在 MySQL 里执行对应 SQL；或运行 backfill 脚本（如有）
node scripts/backfill-client-id-from-wixid.js
```

若没有该脚本，可手动执行迁移 `0047_account_client_wixid_backfill_fk.sql` 中的逻辑。

---

## 一键复制版（本机 PowerShell 执行）

```powershell
# 1) 上传 CSV
scp -i .\malaysia-ecs-key.pem C:\Users\User\Downloads\bukkuid.csv ecs-user@47.250.141.3:/home/ecs-user/app/bukkuid.csv

# 2) 登录 ECS 后执行（下面三行在 SSH 登录后的终端里执行）：
# cd /home/ecs-user/app
# node scripts/truncate-account.js
# node scripts/import-account.js bukkuid.csv
```

步骤 2 需在 SSH 会话里手动执行，无法在本地 PowerShell 一条命令完成。
