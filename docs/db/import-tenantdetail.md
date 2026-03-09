# TenantDetail 表：重建、清空、上传与导入（每一步单独执行）

## 表结构说明

- **Reference**：bankName → `bankname_wixid` + `bankname_id`（→ bankdetail）；client → `client_wixid` + `client_id`（→ clientdetail）。
- **Array**：account 存为 `account` text，CSV 可传字符串或留空。

---

## 步骤（按顺序执行）

### Step 1 — 本机：导出 CSV

- 从 Wix 导出 **TenantDetail** CSV（历史数据源）；导入目标为 MySQL。
- 保存到 **Downloads**，文件名改为 **`tenantdetail.csv`**。

---

### Step 2 — 本机：新开 PowerShell（不要 SSH）

打开 **新的 Windows PowerShell**，执行下面**一条**命令（上传 CSV 到 ECS）：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\tenantdetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/tenantdetail.csv
```

看到 `tenantdetail.csv 100%` 即表示上传完成。

---

### Step 3 — 本机：再开一个 PowerShell，SSH 登录 ECS

在 **新的 PowerShell** 里执行：

```powershell
ssh -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3
```

登录成功后提示符会变成类似：`[ecs-user@iZ8... ~]$`

---

### Step 4 — ECS：进入项目目录

在 **同一个 SSH 终端** 里执行：

```bash
cd /home/ecs-user/app
```

---

### Step 5 — ECS：重建表（删表再建，会清空数据）

在 **同一终端** 执行：

```bash
node scripts/reset-and-create-tenantdetail.js
```

看到 `[reset-tenantdetail] Dropped tenantdetail` 和 `Created tenantdetail` 即成功。

---

### Step 6 — ECS：导入 CSV

在 **同一终端** 执行：

```bash
node scripts/import-tenantdetail.js ./tenantdetail.csv
```

看到 `Done. Inserted xx rows into tenantdetail` 即导入完成。

---

## 若表已存在，只清空再导入（不重建表）

在 **ECS 终端**（已 `cd /home/ecs-user/app`）执行：

```bash
node scripts/truncate-tenantdetail.js
node scripts/import-tenantdetail.js ./tenantdetail.csv
```

---

## CSV 列映射

| Wix 列      | 表列（上传）   | 表列（FK）   |
|------------|----------------|--------------|
| _id        | wix_id         | -            |
| fullname   | fullname       | -            |
| nric       | nric           | -            |
| address    | address        | -            |
| phone      | phone          | -            |
| email      | email          | -            |
| bankName   | bankname_wixid | bankname_id  |
| bankAccount| bankaccount    | -            |
| accountholder | accountholder | -          |
| nricFront  | nricfront      | -            |
| nricback   | nricback       | -            |
| client     | client_wixid   | client_id    |
| account    | account (text) | -            |
| _createdDate | created_at   | -            |
| _updatedDate | updated_at   | -            |
