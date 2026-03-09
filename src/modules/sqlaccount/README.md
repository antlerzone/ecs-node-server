# SQL Account API wrapper

马来西亚会计软件 [SQL Account](https://www.sql.com.my/)（E Stream MSC）的 HTTP API 封装。

## 官方 API 文档

- **SQL API docs（对接总览，必读）：** https://wiki.sql.com.my/wiki/SQL_Accounting_Linking  
  含四种对接方式：SDK Live（推荐，支持 Node.js）、XLS/MDB Import、XML Import、Text Import。本模块实现的是 **HTTP REST API**（Access Key + Secret Key + AWS Sig v4）方式。
- **API 配置与密钥：** [Setup and Configuration](https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration)  
  Postman Collection 需在 SQL Account 内「Download Postman Collection」取得具体 endpoint。
- **客服提供的 Postman + Demo 凭证（测试用）：** 见项目根目录 [docs/sql-account-api.md](../../../docs/sql-account-api.md)  
  - Postman 集合：https://download.sql.com.my/customer/Fairy/APICollection.zip  
  - 认证：AWS Signature Version 4（Query Parameters）  
  - Demo 环境与 AccessKey/SecretKey 仅用于测试；2027 年起拟收费 RM1,000/公司/年。

## 环境变量

- `SQLACCOUNT_BASE_URL` — API 根地址（必填，无尾部斜杠）
- `SQLACCOUNT_ACCESS_KEY`、`SQLACCOUNT_SECRET_KEY` — 在 SQL Account：Tools > Maintain User > API Secret Key 生成

或按客户在 `client_integration`（provider=sqlaccount）配置。

## Wrappers

- **account.wrapper.js** — Account 列表/创建
- **contact.wrapper.js** — Contact 列表/创建/更新
- **invoice.wrapper.js** — 销售发票：listInvoices, getInvoice, createInvoice, updateInvoice（路径以 Postman 为准）
- **purchase.wrapper.js** — 采购：listPurchases, getPurchase, createPurchase, updatePurchase
- **payment.wrapper.js** — 付款单：listPayments, getPayment, createPayment
- **receipt.wrapper.js** — 收款单：listReceipts, getReceipt, createReceipt
- **einvoice.wrapper.js** — E-Invoice（MyInvois）：submitEInvoice, getEInvoiceStatus, cancelEInvoice

## 路由（Base: `/api/sqlaccount`）

- `GET /agent` — 示例：获取 Agent 列表
- `POST /request` — 通用请求，body: `{ method, path, data?, params? }`
