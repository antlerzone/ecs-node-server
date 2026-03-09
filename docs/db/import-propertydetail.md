# PropertyDetail 表：重建与 CSV 导入

## 1) 脚本

- **重建表（删数据并建新结构）**  
  ```bash
  node scripts/reset-and-create-propertydetail.js
  ```
- **导入 CSV**  
  ```bash
  node scripts/import-propertydetail.js [csv路径]
  ```  
  不写路径时默认用当前目录下的 `propertydetail.csv`。

## 2) 上传步骤

1. **本机**：若需从 Wix 导出历史数据，导出 PropertyDetail 的 CSV，改名为 **`propertydetail.csv`**（数据目标为 MySQL，不再使用 Wix CMS）。
2. **上传到 ECS**（在 Windows PowerShell 里，把 `propertydetail.csv` 传到服务器）：  
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\propertydetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/propertydetail.csv
   ```
3. **SSH 登录 ECS** 后执行：  
   ```bash
   cd /home/ecs-user/app
   node scripts/reset-and-create-propertydetail.js
   node scripts/import-propertydetail.js ./propertydetail.csv
   ```

## 3) 文件位置与命名

- 本机：`Downloads` 里的文件请重命名为 **`propertydetail.csv`**（与表名一致）。
- ECS 上：上传后路径为 `/home/ecs-user/app/propertydetail.csv`，导入脚本默认就找这个路径。

## 4) Boolean 处理

- CSV 里的 **true / false** 在导入时会自动转为 **1 / 0** 写入 `active` 等字段，无需手改。

---

## 列对齐（CSV 列 → MySQL 表）

| Wix fieldkey      | 表列（上传/存 Wix _id） | 表列（FK）   |
|-------------------|--------------------------|--------------|
| _id               | wix_id                   | -            |
| _createdDate      | created_at               | -            |
| _updatedDate      | updated_at               | -            |
| meter             | meter_wixid              | meter_id     |
| agreementtemplate | agreementtemplate_wixid  | agreementtemplate_id |
| client            | client_wixid             | client_id    |
| management        | management_wixid         | management_id |
| internetType      | internettype_wixid       | internettype_id |
| ownername         | owner_wixid              | owner_id     |
| smartdoor         | smartdoor_wixid          | smartdoor_id |
| saj               | water                    | -            |
| tnb               | electric                 | -            |
| parkinglot        | parkinglot (text)        | -            |
| signagreement     | signagreement (url)      | -            |
| agreementstatus   | agreementstatus (json 数组) | -         |
| checkbox          | checkbox (boolean→1/0)  | -            |
| wifidetail        | wifidetail (text)       | -            |
| 其他              | 同名小写列               | -            |

脚本会根据各 `xxx_wixid` 在对应表里查 `wix_id`，把得到的 `id` 写入 `xxx_id`。boolean 的 true/false 会转为 1/0。
