# StaffDetail & Tenancy 导入 — 复制粘贴步骤

文件名：**StaffDetail.csv**、**Tenancy.csv**（放在本机 Downloads）

---

## 步骤 1）打开 PowerShell

在 Windows 按 `Win + R`，输入 `powershell`，回车。

---

## 步骤 2）上传 CSV 到 ECS

在 PowerShell 里一次复制一行，粘贴后回车。

上传 StaffDetail.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\StaffDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/StaffDetail.csv
```

上传 Tenancy.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\Tenancy.csv" ecs-user@47.250.141.3:/home/ecs-user/app/Tenancy.csv
```

---

## 步骤 3）登入 ECS

```powershell
ssh -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

---

## 步骤 4）执行 migration（仅第一次需要）

**若报错 Table 'myapp.tenancy' doesn't exist**：说明 tenancy 表尚未创建，请执行 **0011**（建表，含全部列）：

```bash
cd /home/ecs-user/app
export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0009_staffdetail_bankname_wixid.sql
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0011_create_tenancy.sql
```

若 tenancy 表已存在（例如跑过完整 0001），只需加新列时执行 0009 + 0010：

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0009_staffdetail_bankname_wixid.sql
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0010_tenancy_columns.sql
```

---

## 步骤 5）清空表并导入数据

在 ECS 上整段复制下面全部，粘贴后按一次回车：

```bash
cd /home/ecs-user/app
node scripts/truncate-staffdetail.js
node scripts/truncate-tenancy.js
node scripts/import-staffdetail.js ./StaffDetail.csv
node scripts/import-tenancy.js ./Tenancy.csv
```

---

## CSV 第一行 (Row 1) 与表列对应

**StaffDetail.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| Name | name |
| email | email |
| salary | salary |
| Bank Name | bankname_wixid → bank_name_id |
| Bank Account | bankaccount |
| Client | client_wixid → client_id |
| status | status |
| permission | permission_json（array，如 ["finance","tenantdetail",...]） |

**Tenancy.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| tenant | tenant_wixid → tenant_id |
| room | room_wixid → room_id |
| begin | begin |
| end | end |
| rental | rental |
| submitby | submitby_wixid → submitby_id |
| title | title |
| billurl | billsurl |
| billsid | billsid |
| Password | password |
| status | status |
| passwordid | passwordid |
| agreement | agreement |
| Signagreement | signagreement |
| Checkbox | checkbox |
| Sign | sign |
| Avialabledate | availabledate |
| Remark | remark |
| Payment | payment |
| client | client_wixid → client_id |

client、tenant、room、submitby、Bank Name、Client 的 wix_id（含前导 `!`）会写入对应 _wixid 列并解析为 _id。
