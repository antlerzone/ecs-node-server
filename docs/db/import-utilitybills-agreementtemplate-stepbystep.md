# UtilityBills (bills) & AgreementTemplate 导入 — 复制粘贴步骤

文件名：**UtilityBills.csv**、**agreementtemplate.csv**（本机 Downloads）。UtilityBills 导入到表 **bills**（即 bill）。

---

## 步骤 1）打开 PowerShell

在 Windows 按 `Win + R`，输入 `powershell`，回车。

---

## 步骤 2）上传 CSV 到 ECS

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\UtilityBills.csv" ecs-user@47.250.141.3:/home/ecs-user/app/UtilityBills.csv
```

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\agreementtemplate.csv" ecs-user@47.250.141.3:/home/ecs-user/app/agreementtemplate.csv
```

---

## 步骤 3）登入 ECS

```powershell
ssh -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

---

## 步骤 4）执行 migration（仅第一次需要）

**若报错 Table 'myapp.bills' doesn't exist**：先建表，执行 **0013**：

```bash
cd /home/ecs-user/app
export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0013_create_bills.sql
```

若 bills 表**已存在**（例如刚跑过 0013 或完整 0001），只需加列时执行 **0012**。**注意**：若已执行过 0013 建表，请勿再执行 0012（会报 Duplicate column）。

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0012_bills_columns.sql
```

AgreementTemplate 加 mode 列（仅一次）：

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0014_agreementtemplate_mode.sql
```

---

## 步骤 5）清空表并导入

```bash
cd /home/ecs-user/app
node scripts/truncate-bills.js
node scripts/truncate-agreementtemplate.js
node scripts/import-bills.js ./UtilityBills.csv
node scripts/import-agreementtemplate.js ./agreementtemplate.csv
```

---

## CSV 第一行 (Row 1) 与表列对应

**UtilityBills.csv → 表 bills**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| listingTitle | listingtitle |
| billType | billtype_wixid → billtype_id (account) |
| period | period |
| amount | amount |
| description | description |
| property | property_wixid → property_id |
| bukkuurl | billurl |
| billname | billname |
| client | client_wixid → client_id |
| Paid | paid |

**agreementtemplate.csv → 表 agreementtemplate**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| Title | title |
| client | client_wixid → client_id |
| Folderurl | folderurl |
| Templateurl | templateurl |
| Html | html |
| Mode | mode |
