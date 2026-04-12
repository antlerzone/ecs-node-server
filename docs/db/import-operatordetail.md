# ClientDetail：主表 + 子表分类、清空、上传与导入

> 本文档记录 operatordetail 主表与 4 张子表的导入流程、脚本、以及「从 operatordetail 表自动同步到子表」的用法，下次可直接按此操作。

---

## 分类（主表 vs 子表）

**主表 operatordetail** 存扁平字段；若已跑 migration 0002，还会存 integration/profile/pricingplandetail/credit 四列（JSON text），供服务自动同步到子表。

| 字段（原 Wix → MySQL） | 表列 | 说明 |
|----------|------|------|
| _id | wix_id | 原 Wix _id |
| title | title | text |
| email | email | text |
| status | status | boolean → 1/0 |
| profilephoto | profilephoto | image → text |
| subdomain | subdomain | text |
| expired | expired | datetime |
| pricingplanid | pricingplan_wixid + pricingplan_id | reference → pricingplan |
| currency | currency | text |
| admin | admin | object → text |
| _createdDate / Updated Date | created_at / updated_at | |
| integration / Profile / pricingplandetail / credit | 同名列（TEXT） | 可选；见 migration 0002，用于「从表同步到子表」 |

**子表（array 拆成多行，每行有 client_id / client_wixid）：**

| 原 array 字段 | 子表 | 说明 |
|-----------|------|------|
| integration | **client_integration** | key, version, slot, enabled, provider, values_json, einvoice |
| profile | **client_profile** | tin, contact, subdomain, accountholder, ssm, currency, address, accountnumber, bank_id |
| pricingplandetail | **client_pricingplan_detail** | type, plan_id, title, expired, qty |
| credit | **client_credit** | type, amount |

导入时：先写 **operatordetail**，再根据 CSV 四列 JSON **自动写入** 4 张子表（或若表有 4 列则写入主表后由服务从表同步到子表）。

---

## 步骤（推荐：一条命令 先删再导）

### 方式 A：一条命令（清空 + 导入）

1. 本机上传 CSV 到 ECS（PowerShell）：
   ```powershell
   scp -i $HOME\.ssh\malaysia-ecs-key.pem "$env:USERPROFILE\Downloads\operatordetail.csv" ecs-user@47.250.141.3:/home/ecs-user/app/operatordetail.csv
   ```
2. SSH 登录后执行（默认用 `./operatordetail.csv`）：
   ```bash
   cd /home/ecs-user/app
   node scripts/clear-and-import-operatordetail.js
   ```
   或指定 CSV 路径：`node scripts/clear-and-import-operatordetail.js ./operatordetail.csv`

### 方式 B：分步（清空 → 上传 → 导入）

1. **ECS：清空**  
   `node scripts/clear-client-and-subtables.js`
2. **本机：** 从 Wix 导出 ClientDetail（含 integration / Profile / pricingplandetail / credit 四列，标准 JSON 双引号格式），保存为 `operatordetail.csv`，用 scp 上传到 app 目录。
3. **ECS：导入**  
   `node scripts/import-operatordetail.js ./operatordetail.csv`

---

## CSV 要求

- 表头需含：integration、Profile（或 profile）、pricingplandetail、credit（列名大小写可兼容）。
- 四列内容为 **标准 JSON 数组**（双引号键值），例如：`[{"enabled":true,"key":"paymentGateway",...}]`。含逗号的单元格需被双引号包裹，内部引号转义为 `""`（RFC 4180）。脚本用 `csv-parse` 解析。
- 若导出为「JS 对象字面量」或截断，脚本会尝试修复/JSON5 解析；仍失败时可设 `IMPORT_DEBUG=1` 看解析错误。

---

## 从 operatordetail 表同步到子表（无需再依赖 CSV）

- **Migration 0002**：为 operatordetail 增加四列 `integration`, `profile`, `pricingplandetail`, `credit`（TEXT）。  
  执行：`src/db/migrations/0002_clientdetail_subtable_json_columns.sql`（按项目 migration 方式执行一次）。

- **服务** `syncSubtablesFromOperatordetail(conn, clientId)`（`src/services/client-subtables.js`）：  
  从 operatordetail 读取该 client 的上述四列 JSON，解析后写入 client_integration、client_profile、client_pricingplan_detail、client_credit。  
  **每次对 operatordetail 做 insert/update 后调用一次**，即可自动更新 4 张子表，无需 trigger、无需再传 CSV。

- **验证 / 重跑同步**：若子表没数据或想按表内 JSON 重写子表，可执行：  
  `node scripts/verify-and-sync-client-subtables.js`  
  会先打 operatordetail 与 4 张子表行数，再对「四列有数据的 client」执行一次从表到子表的同步。

---

## 相关脚本速查

| 脚本 | 作用 |
|------|------|
| `clear-client-and-subtables.js` | 仅清空 operatordetail + 4 张子表 |
| `clear-and-import-operatordetail.js [csv]` | 清空 + 导入（默认 `./operatordetail.csv`） |
| `import-operatordetail.js [csv]` | 仅导入，不清空 |
| `verify-and-sync-client-subtables.js` | 查行数 + 从 operatordetail 四列重新同步到子表 |

---

## 列映射（主表）

- `_id` → wix_id  
- `Created Date` / `Updated Date` → created_at / updated_at  
- `pricingplanid` → pricingplan_wixid（并解析 pricingplan_id）  
- `status`：true/false → 1/0  
- integration / Profile / pricingplandetail / credit：若表有对应列则写入主表并用于同步子表。
