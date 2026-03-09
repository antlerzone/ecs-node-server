# OwnerPayout & RoomDetail 导入 — 复制粘贴步骤

文件名：**OwnerPayout.csv**、**RoomDetail.csv**（放在本机 Downloads）

---

## 步骤 1）打开 PowerShell

在 Windows 按 `Win + R`，输入 `powershell`，回车。

---

## 步骤 2）上传 CSV 到 ECS

在 PowerShell 里**一次复制一行，粘贴后回车**。

上传 OwnerPayout.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\OwnerPayout.csv" ecs-user@47.250.141.3:/home/ecs-user/app/OwnerPayout.csv
```

上传 RoomDetail.csv：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\RoomDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/RoomDetail.csv
```

---

## 步骤 3）登入 ECS

```powershell
ssh -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

---

## 步骤 4）执行 migration（仅第一次需要）

若报错 **Table 'myapp.ownerpayout' doesn't exist**，说明这两张表尚未创建，请执行 **0008**（一次建好两张表）：

```bash
cd /home/ecs-user/app
export $(grep -v '^#' .env | xargs)
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0008_create_ownerpayout_roomdetail.sql
```

若表已存在（例如跑过完整 0001_init.sql），只需加新列时，执行 0006、0007：

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0006_ownerpayout_columns.sql
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0007_roomdetail_columns.sql
```

---

## 步骤 5）清空表并导入数据

在 ECS 上**整段复制下面全部，粘贴后按一次回车**：

```bash
cd /home/ecs-user/app
node scripts/truncate-ownerpayout.js
node scripts/truncate-roomdetail.js
node scripts/import-ownerpayout.js ./OwnerPayout.csv
node scripts/import-roomdetail.js ./RoomDetail.csv
```

看到 `Done. Inserted ... rows` 即完成。

---

## CSV 第一行 (Row 1) 与表列对应

**OwnerPayout.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| property | property_wixid → property_id |
| period | period |
| title | title |
| totalrental | totalrental |
| totalutility | totalutility |
| totalcollection | totalcollection |
| expenses | expenses |
| netpayout | netpayout |
| Bukkubills | bukkubills |
| Bukkuinvoice | bukkuinvoice |
| monthlyreport | monthlyreport |
| client | client_wixid → client_id |
| paid | paid |

**RoomDetail.csv**

| Row 1 列名 | 表列 |
|------------|------|
| ID | wix_id |
| Title | title_fld |
| Description | description_fld |
| Available | available |
| Parking Lot | parkinglot |
| Smart Meter | smartmeter（数字，列名任意大小写均可） |
| Price | price |
| Main Photo | mainphoto |
| Media Gallery | media_gallery_json（JSON 数组；CSV 内需用双引号包住整段，引号内再写 `""` 表示一个 `"`） |
| Remark | remark |
| Appointment | appointment |
| Property | property_wixid → property_id |
| Room Name | roomname |
| meter | meter_wixid → meter_id |
| Availabledate | availabledate |
| Availablefrom | availablefrom |
| availablesoon | availablesoon |
| Msg | msg |
| Status | status |
| client | client_wixid → client_id |
| active | active |
| smartdoor | smartdoor_wixid → smartdoor_id |

client、property、meter、smartdoor 的 wix_id（含前导 `!`）会写入对应 _wixid 列并解析为 _id。

**link_room_detail_title_fld**：表内已有列，用于存「房间详情标题」的链接（如 Wix 的 link 字段）。若 CSV 有对应列（例如 "Link Room Detail Title"），可在脚本中增加映射；目前未从 CSV 导入。
