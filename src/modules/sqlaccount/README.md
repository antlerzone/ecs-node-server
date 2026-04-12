# SQL Account API wrapper

马来西亚会计软件 [SQL Account](https://www.sql.com.my/)（E Stream MSC）的 HTTP API 封装。

## 官方 API 文档

- **SQL API docs（对接总览，必读）：** https://wiki.sql.com.my/wiki/SQL_Accounting_Linking  
  含四种对接方式：SDK Live（推荐，支持 Node.js）、XLS/MDB Import、XML Import、Text Import。本模块实现的是 **HTTP REST API**（Access Key + Secret Key + AWS Sig v4）方式。
- **API 配置与密钥：** [Setup and Configuration](https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration)  
  Postman Collection 需在 SQL Account 内「Download Postman Collection」取得具体 endpoint。
- **本仓库 Postman 集合（对照用）：** 根目录 [postman_collection.json](../../../postman_collection.json)（路径与 `lib/postmanPaths.js` 一致）
- **客服提供的 Postman + Demo 凭证（测试用）：** 见项目根目录 [docs/sql-account-api.md](../../../docs/sql-account-api.md)  
  - Postman 集合：https://download.sql.com.my/customer/Fairy/APICollection.zip  
  - 认证：AWS Signature Version 4（默认 Authorization Header；也可 Query Parameters）  
  - Demo 环境与 AccessKey/SecretKey 仅用于测试；2027 年起拟收费 RM1,000/公司/年。

## 环境变量

- `SQLACCOUNT_BASE_URL` — API 根地址（必填，无尾部斜杠）
- `SQLACCOUNT_ACCESS_KEY`、`SQLACCOUNT_SECRET_KEY` — 在 SQL Account：Tools > Maintain User > API Secret Key 生成
- `SQLACCOUNT_AWS_REGION` — 默认 `ap-southeast-5`
- `SQLACCOUNT_AWS_SERVICE` — 默认 `sqlaccount`
- `SQLACCOUNT_SIGV4_MODE` — `header`（默认）或 `query`

或按客户在 `client_integration`（provider=sqlaccount）配置。

## Wrappers

命名尽量与 **Bukku / Xero** 一致：`list` / `read` / `create` / `update` / `remove`（SQL 无 archive）。旧名如 `listInvoices`、`createAccount` 仍保留为别名。

- **account.wrapper.js** — `GET/POST /account`，`PUT/DELETE /account/:CODE`
- **contact.wrapper.js** — Postman 为 **Customer**（`/customer`）与 **Supplier**（`/supplier`）；另提供 `listCustomers` / `listSuppliers` 等；统一 `list` 会合并两边
- **invoice.wrapper.js** — 销售发票：`/salesinvoice`（Postman「Invoice」）
- **purchase.wrapper.js** — 采购发票：`/purchaseinvoice`
- **payment.wrapper.js** — 付款：`/paymentvoucher`
- **receipt.wrapper.js** — 客户收款：`/customerpayment`
- **einvoice.wrapper.js** — 基于 `/salesinvoice/{dockey}` 的子路径（可用 env 覆盖后缀）
- **agent.wrapper.js** — `/agent`
- **journalEntry.wrapper.js** — `/journalentry`（或 `SQLACCOUNT_JOURNAL_PATH`）

## 路由（Base: `/api/sqlaccount`）

- `GET /agent` — 示例：获取 Agent 列表
- `POST /request` — 通用请求，body: `{ method, path, data?, params? }`
