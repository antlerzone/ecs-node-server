# SQL Account API（官方客服资料）

本仓库的 **SQL Account 对接**（`src/modules/sqlaccount/`）已按此方式实现：  
认证使用 **AWS Signature Version 4**，凭证从 **client_integration**（provider=sql）或 **env** 读取。  
Demo 凭证仅用于本地/测试环境配置，勿写入正式环境。

## SaaS 里让 client 接入 SQL

可以。访客（client）在「会计集成」里选择 **SQL Account** 后，需要填写三项（每 client 独立存在 `client_integration.values_json`）：

| 项 | 说明 | 每个 client 是否不同 |
|----|------|----------------------|
| **Base URL** | API 根地址（无尾部斜杠），例如 `https://connect.sql.com.my` 或客户自建实例地址 | 若用 SQL 公共网关，可所有人同一 URL；若客户自建/专属实例，则**每个 client 不同**，必须各自填写 |
| **Access Key** | AWSv4 Access Key（在 SQL Account：Tools > Maintain User > API Secret Key 生成） | **每个 client 不同**（按公司/账套） |
| **Secret Key** | AWSv4 Secret Key | **每个 client 不同**（与 Access Key 成对） |

后端从 `client_integration` 读：`provider IN ('sql','sqlaccount')`、`key = 'addonAccount'`，`values_json` 内字段名为 `sqlaccount_base_url` / `base_url`、`sqlaccount_access_key` / `access_key`、`sqlaccount_secret_key` / `secret_key`。  
也就是说：**需要 Base URL**；是否每个 client 不一样取决于用的是公共网关还是客户自己的实例。

## 接口与认证

- **Postman 集合导入**  
  https://download.sql.com.my/customer/Fairy/APICollection.zip  

- **认证方式**  
  AWS Signature Version 4（Query Parameters）  
  https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html  

## Demo 凭证（仅测试）

- **环境**：SQL Public Connect https://connect.sql.com.my/（Demo Database）
- **AWSv4 AccessKey**  
  `53638dc6c7b9ca1c643df5233680c327.sql.my/ACCOUNTAPI`
- **AWSv4 SecretKey**  
  `a8d10a36bcfe3d33d9d6bb2ffb0daa9ce3712e10188b845a505fb6708135ce04`

测试时可在 `.env` 中设置（或为测试 client 配置 addonAccount）：  
`SQLACCOUNT_BASE_URL`、`SQLACCOUNT_ACCESS_KEY`、`SQLACCOUNT_SECRET_KEY`（用上列 Demo 值）。

## 费用说明

- 目前暂免费用（FOC）。
- 自 **2027 年 1 月起** 拟收费：**RM 1,000 / 公司 / 年**（价格可能调整）。

备注：由 SQL 官方客服提供，集成时以最新官方说明为准。
