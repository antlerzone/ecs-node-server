# LockDetail & GatewayDetail 导入 — 复制粘贴步骤

文件名：**LockDetail.csv**、**GatewayDetail.csv**（放在本机 Downloads）

---

## 步骤 1）打开 PowerShell

在 Windows 按 `Win + R`，输入 `powershell`，回车；或从开始菜单打开 **Windows PowerShell**。

---

## 步骤 2）上传 CSV 到 ECS

在 PowerShell 里**一次复制一行，粘贴后回车**。

上传 LockDetail.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\LockDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/LockDetail.csv
```

上传 GatewayDetail.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\GatewayDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/GatewayDetail.csv
```

---

## 步骤 3）登入 ECS

在 PowerShell 里复制粘贴并回车：

```powershell
ssh -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

登入后提示符会变成 `[ecs-user@...]$`。

---

## 步骤 4）清空表并导入数据

在 ECS 上**整段复制下面全部，粘贴后按一次回车**（先清空再导入：先 Gateway 后 Lock）。

```bash
cd /home/ecs-user/app
node scripts/truncate-lockdetail.js
node scripts/truncate-gatewaydetail.js
node scripts/import-gatewaydetail.js ./GatewayDetail.csv
node scripts/import-lockdetail.js ./LockDetail.csv
```

看到 `Done. Inserted ... rows` 即完成。

---

## 若尚未跑过 migration（仅第一次需要）

若 lockdetail 表还没有 `gateway_wixid` 列，先执行一次：

```bash
cd /home/ecs-user/app
export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0005_lockdetail_gateway_wixid.sql
```

然后再做步骤 4。

---

## CSV 第一行 (Row 1) 与表列对应

**LockDetail.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| gateway | gateway_wixid → gateway_id |
| Lockid | lockid |
| Lockname | lockname |
| Electricquantity | electricquantity |
| Type | type |
| Hasgateway | hasgateway |
| Lockalias | lockalias |
| client | client_wixid → client_id |
| active | active |
| Childmeter | childmeter (json) |

**GatewayDetail.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| Locknum | locknum |
| Isonline | isonline |
| Gatewayid | gatewayid |
| Gatewayname | gatewayname |
| Metworkname | networkname |
| Type | type |
| client | client_wixid → client_id |
