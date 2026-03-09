# OwnerDetail 表：重建与 CSV 导入

## 1) 脚本

- **重建表**：`node scripts/reset-and-create-ownerdetail.js`
- **清空数据**：`node scripts/truncate-ownerdetail.js`
- **导入 CSV**：`node scripts/import-ownerdetail.js [csv路径]`（默认 `./ownerdetail.csv`）

## 2) 上传步骤

1. 本机：从 Wix 导出 OwnerDetail CSV，放到 **Downloads**，改名为 **`ownerdetail.csv`**。
2. 本机 PowerShell 上传：
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\ownerdetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/ownerdetail.csv
   ```
3. SSH 登录 ECS 后执行：
   ```bash
   cd /home/ecs-user/app
   node scripts/reset-and-create-ownerdetail.js
   node scripts/import-ownerdetail.js ./ownerdetail.csv
   ```
   若表已存在且只需清空再导入：
   ```bash
   node scripts/truncate-ownerdetail.js
   node scripts/import-ownerdetail.js ./ownerdetail.csv
   ```

## 3) 文件

- 本机：**Downloads** 里文件命名为 **`ownerdetail.csv`**。
- ECS：路径 `/home/ecs-user/app/ownerdetail.csv`。

## 4) Boolean

- CSV 中 **true / false** 会转为 **1 / 0**。

---

## 列对齐（CSV 列 → MySQL 表）

| Wix fieldkey   | 表列（上传）     | 表列（FK）     |
|----------------|------------------|----------------|
| _id            | wix_id           | -              |
| ownerName      | ownername        | -              |
| bankName       | bankname_wixid   | bankname_id    |
| bankAccount    | bankaccount      | -              |
| email          | email            | -              |
| nric           | nric             | -              |
| signature      | signature (text) | -              |
| nricFront      | nricfront        | -              |
| nricback       | nricback         | -              |
| accountholder  | accountholder    | -              |
| mobileNumber   | mobilenumber     | -              |
| status         | status           | -              |
| approvalpending| approvalpending (text) | -        |
| client         | client_wixid     | client_id      |
| property       | property_wixid   | property_id    |
| profile        | profile (text)   | -              |
| account        | account (text)   | -              |
| _createdDate   | created_at       | -              |
| _updatedDate   | updated_at       | -              |

**contact_id** 已弃用，表内未保留；若 CSV 仍有该列会被忽略。

**array 字段**（approvalpending、profile、account）：表里用 **text** 存，CSV 可传字符串（如 JSON 字符串）或留空；后续由 services 解析。
