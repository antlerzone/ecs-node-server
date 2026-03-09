# backend/saas/ownerportal.jsw – Owner Portal（走 Node，不读 CMS）

## 用途

Owner Portal 所有数据请求通过本 JSW 转发到 ECS Node `/api/ownerportal/*`，**不读 Wix CMS**。  
认证方式：Wix Secret Manager 配置 `ecs_token`、`ecs_username`、`ecs_base_url`；每次请求带 `email`（当前登录用户）+ Bearer + X-API-Username。

## 架构

- **原**：Wix 前端 → Wix 后端 (ownerportal.jsw) → Wix CMS  
- **现**：Wix 前端 → 本 JSW (ownerportal.jsw) → Node `/api/ownerportal/*` → MySQL  

## 本 JSW 导出的函数与对应 Node 路径

| 函数 | Node POST 路径 | 说明 |
|------|----------------|------|
| getOwner | /api/ownerportal/owner | 按 email 取 owner（含 property/client 数组） |
| loadCmsData | /api/ownerportal/load-cms-data | 一次拉取 owner + properties + rooms + tenancies |
| getClientsForOperator | /api/ownerportal/clients | 运营商下拉（clients） |
| getBanks | /api/ownerportal/banks | 银行列表 |
| updateOwnerProfile | /api/ownerportal/update-profile | 更新 owner 资料 |
| getOwnerPayoutList | /api/ownerportal/owner-payout-list | body: propertyId, startDate, endDate |
| getCostList | /api/ownerportal/cost-list | body: propertyId, startDate, endDate, skip?, limit? |
| getAgreementList | /api/ownerportal/agreement-list | body: ownerId |
| getAgreementTemplate | /api/ownerportal/agreement-template | body: templateId |
| getAgreement | /api/ownerportal/agreement-get | body: agreementId |
| updateAgreementSign | /api/ownerportal/agreement-update-sign | body: agreementId, ownersign, ownerSignedAt, status |
| completeAgreementApproval | /api/ownerportal/complete-agreement-approval | body: ownerId, propertyId, clientId, agreementId |
| mergeOwnerMultiReference | /api/ownerportal/merge-owner-multi-reference | body: ownerId, propertyId, clientId |
| removeApprovalPending | /api/ownerportal/remove-approval-pending | body: ownerId, propertyId, clientId |
| syncOwnerForClient | /api/ownerportal/sync-owner-for-client | body: ownerId, clientId |
| exportOwnerReportPdf | /api/ownerportal/export-report-pdf | body: propertyId, startDate, endDate → downloadUrl |
| exportCostPdf | /api/ownerportal/export-cost-pdf | body: propertyId, startDate, endDate → downloadUrl |

## CMS → MySQL 对应（供核对）

- **Owner** → `ownerdetail`（email 解析；property/client 来自 junction 或 property_id/client_id）
- **Property** → `propertydetail`（_id → id，shortname 等）
- **Room** → `roomdetail`，**Tenancy** → `tenancy`，**Agreement** → `agreement`
- **Banks** → `bankdetail`，**Owner Payout** → `ownerpayout`，**Cost/Bills** → `bills` 等  

若某 CMS 集合或字段不确定对应哪张表/列，先与维护者确认再改代码。

## 代码文件

[JSW 完整代码](./velo-backend-saas-ownerportal.jsw.snippet.js) 复制到 Wix 的 `backend/saas/ownerportal.jsw` 使用。
