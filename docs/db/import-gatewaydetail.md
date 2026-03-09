# GatewayDetail 表：清空、CSV 导入

## 1) 脚本

- **清空数据**：`node scripts/truncate-gatewaydetail.js`（若 lockdetail 有引用 gateway，请先清空 lockdetail）
- **导入 CSV**：`node scripts/import-gatewaydetail.js [csv路径]`（默认 `./GatewayDetail.csv`）

## 2) 上传步骤（Step by step）

1. **本机**：从 Wix 导出 GatewayDetail 到 CSV，保存到 **Downloads**，文件名为 **`GatewayDetail.csv`**。
2. **本机 PowerShell 上传**：
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\GatewayDetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/GatewayDetail.csv
   ```
3. **SSH 登录 ECS** 后执行：
   ```bash
   cd /home/ecs-user/app
   # 先清空 lockdetail（因 FK 指向 gatewaydetail），再清空 gatewaydetail
   node scripts/truncate-lockdetail.js
   node scripts/truncate-gatewaydetail.js
   node scripts/import-gatewaydetail.js ./GatewayDetail.csv
   ```
   若只追加导入、不清空：
   ```bash
   node scripts/import-gatewaydetail.js ./GatewayDetail.csv
   ```

## 3) 文件

- **本机**：**Downloads** 里文件命名为 **`GatewayDetail.csv`**。
- **ECS**：路径 `/home/ecs-user/app/GatewayDetail.csv`。

## 4) 列对齐（CSV Row 1 → 表）

| CSV 列名 (Row 1) | 表列（上传） | 表列（FK） |
|------------------|--------------|------------|
| ID               | wix_id       | -          |
| Locknum          | locknum      | -          |
| Isonline         | isonline     | -          |
| Gatewayid        | gatewayid    | -          |
| Gatewayname      | gatewayname  | -          |
| Networkname      | networkname  | -          |
| Type             | type         | -          |
| client           | client_wixid | client_id  |

- **client**：填 clientdetail 的 wix_id，脚本会解析为 `client_id`。

## 5) Download（从 ECS 拉回本机）

```powershell
scp -i $HOME\.ssh\malaysia-ecs-key.pem ecs-user@47.250.141.3:/home/ecs-user/app/GatewayDetail.csv "$env:USERPROFILE\Downloads\GatewayDetail.csv"
```
