# Owner Portal 页（迁移版）

## 说明

- **数据来源**：全部通过 **backend/saas/ownerportal.jsw** 请求 ECS Node（`/api/ownerportal/*`），不读 Wix CMS。
- **Agreement 上下文**：仍用 **backend/access/agreementdetail**（已走 Node `/api/agreement/*`）。
- **前端完整代码**：[owner-portal-page-full.js](./owner-portal-page-full.js)。
- **默认 section**：**#sectionownerportal**。onReady 时 #repeaterclient 先 hide，有数据才 show；主按钮先 disable、label「Loading...」，init 完成后 enable 并恢复 label，不自动跳转到其他 section。

## Repeater 与数据来源

| 元素 | 数据来源 | 说明 |
|------|----------|------|
| **#repeateragreement** | **agreement** 表（`/api/ownerportal/agreement-list`） | 条件：owner_id = 当前业主 或 (owner_id IS NULL 且 property_id 属于业主的 properties)；mode 为 owner_operator/owner_tenant 或 NULL。 |
| #repeatertenancy | loadCmsData → tenancies（按 rooms → tenancy） | 依赖业主的 properties（owner_property 或 propertydetail.owner_id）。 |
| #dropdownownerreportproperty | loadCmsData → PROPERTIES | 同上。 |
| #repeaterclient | getClientsForOperator + approvalpending 等 | 先 hide，有 rows 才 show。 |

## 依赖

- `backend/saas/ownerportal`：getOwner、loadCmsData、getClientsForOperator、getBanks、updateOwnerProfile、getOwnerPayoutList、getCostList、getAgreementList、getAgreementTemplate、getAgreement、updateAgreementSign、completeAgreementApproval、mergeOwnerMultiReference、removeApprovalPending、syncOwnerForClient、**exportOwnerReportPdf**、**exportCostPdf**。
- `backend/access/agreementdetail`：getTenantAgreementContext、getOwnerAgreementContext、getOwnerTenantAgreementContext。
- `wix-users`：仅 `wixUsers.currentUser.getEmail()`。`wix-location`：PDF 下载用 `wixLocation.to(downloadUrl)`。

## NRIC 上传

- 约定使用 **阿里云 OSS**，不再使用 Wix 存储。
- 流程建议：先调用项目内「上传到 OSS」接口取得 URL，再 `updateOwnerProfile({ nricFront: url })` 或 `updateOwnerProfile({ nricback: url })`。
- 若过渡期仍用 Wix 上传，`uploadFiles()` 返回的 `file.fileUrl` 可先传入 `updateOwnerProfile`，后续再切到 OSS。

## CMS → MySQL 对应（Owner Portal 用到的表）

| Wix CMS 集合 / 概念 | MySQL 表 | 备注 |
|--------------------|----------|------|
| OwnerDetail | ownerdetail | 按 email 解析业主；property/client 多对多走 **owner_property**、**owner_client** 关联表 |
| owner_property / owner_client | owner_property, owner_client | 一业主多 property、多 client；迁移 0037 建表并回填 |
| PropertyDetail | propertydetail | shortname, client_id, owner_id |
| RoomDetail | roomdetail | property_id |
| Tenancy | tenancy | tenant_id, room_id, begin, end, rental |
| clientdetail | clientdetail | 用于 Operator 下拉 |
| BankDetail | bankdetail | bankname |
| OwnerPayout | ownerpayout | property_id, period, totalrental, netpayout, monthlyreport 等 |
| UtilityBills | bills | property_id, period, amount, description, billurl |
| agreement | agreement | #repeateragreement 数据来源；0033 增加 owner_id, property_id, tenancy_id, mode, status, ownersign, pdfurl 等；列表含 owner_id 匹配或 property 归属回退 |
| agreementtemplate | agreementtemplate | html, title |

## PDF 导出（Node 生成）

- Owner Report、Cost Report 由 Node（pdfkit）生成，接口 `POST /api/ownerportal/export-report-pdf`、`/api/ownerportal/export-cost-pdf`，返回 `{ downloadUrl }`。
- 前端 #buttonexportpdf、#buttonexportpdfcost 调用 exportOwnerReportPdf、exportCostPdf 后 `wixLocation.to(downloadUrl)` 直接下载，与 expenses 页一致。

## 部署前检查

1. 执行 **agreement 表迁移**：`src/db/migrations/0033_agreement_owner_portal_columns.sql`（为 agreement 增加 owner 门户所需列）；可选 0035（ownerdetail FK）、0036（ownerdetail _wixid 回填 _id）、**0037**（owner_client、owner_property 关联表，推荐）。
2. Wix Secret Manager 配置：`ecs_token`、`ecs_username`、`ecs_base_url`（与其它 SaaS 页相同）。
3. 在 Wix 后台创建 **backend/saas/ownerportal.jsw**，内容粘贴 [velo-backend-saas-ownerportal.jsw.snippet.js](../jsw/velo-backend-saas-ownerportal.jsw.snippet.js)。
4. 页面 Code 使用 [owner-portal-page-full.js](./owner-portal-page-full.js)，并按需调整元素 ID（如 `#sectionownerportal`、`#dropdownproperty`、`#repeateragreement`、`#repeaterclient` 等）。
