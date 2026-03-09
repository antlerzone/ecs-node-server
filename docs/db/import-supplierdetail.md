# SupplierDetail 表：CSV 导入

## 1) 脚本

- **清空数据**：`node scripts/truncate-supplierdetail.js`
- **导入 CSV**：`node scripts/import-supplierdetail.js [csv路径]`（默认 `./supplierdetail.csv`）

## 2) 上传步骤（Step by step）

1. **本机**：从 Wix 导出 SupplierDetail 到 CSV，保存到 **Downloads**，改名为 **`supplierdetail.csv`**。
2. **本机 PowerShell 上传**（与 download 一样，只是方向是 upload）：
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\supplierdetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/supplierdetail.csv
   ```
3. **SSH 登录 ECS** 后执行：
   ```bash
   cd /home/ecs-user/app
   # 若需先执行 migration（仅一次）：0003 新列、0004 bankholder
   mysql -h ... -u ... -p ... < src/db/migrations/0003_supplierdetail_columns.sql
   mysql -h ... -u ... -p ... < src/db/migrations/0004_supplierdetail_bankholder.sql
   # 若需清空再导入
   node scripts/truncate-supplierdetail.js
   node scripts/import-supplierdetail.js ./supplierdetail.csv
   ```
   若表已有新列且只需追加导入，可只运行：
   ```bash
   node scripts/import-supplierdetail.js ./supplierdetail.csv
   ```

## 3) 文件

- **本机**：**Downloads** 里文件命名为 **`supplierdetail.csv`**。
- **ECS**：路径 `/home/ecs-user/app/supplierdetail.csv`。

## 4) 列对齐（CSV 列 → MySQL 表）

| Wix fieldkey   | 表列（上传）      | 表列（FK）     |
|----------------|-------------------|----------------|
| _id            | wix_id            | -              |
| title          | title             | -              |
| bankName       | bankdetail_wixid  | bankdetail_id  |
| bankHolder     | bankholder        | -              |
| bankAccount    | bankaccount       | -              |
| email          | email             | -              |
| billerCode     | billercode        | -              |
| client         | client_wixid      | client_id      |
| _createdDate   | created_at        | -              |
| _updatedDate   | updated_at        | -              |

- **bankName**：填 bankdetail 的 `_id`（wix_id），脚本会解析为 `bankdetail_id`。
- **client**：填 clientdetail 的 `_id`（wix_id），脚本会解析为 `client_id`。

---

## 5) Download（从 ECS 拉回本机）

若需要把 ECS 上的 `supplierdetail.csv` 拉回本机 Downloads，PowerShell：

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3:/home/ecs-user/app/supplierdetail.csv "$env:USERPROFILE\Downloads\supplierdetail.csv"
```

步骤与 upload 一致，只是 **来源/目标对调**：upload 是 `本机 Downloads → ECS app`，download 是 `ECS app → 本机 Downloads`。
