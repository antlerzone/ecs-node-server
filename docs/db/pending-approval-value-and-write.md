# Pending Approval：value 格式、写入位置、编辑页面

系统里有两套「待批准」：**Owner 的 approvalpending** 和 **Tenant 的 approval_request_json**。格式、写入处和可编辑页面如下。

---

## 一、Owner 待批准：ownerdetail.approvalpending

### 1.1 Value 格式（JSON 数组）

每条元素形状（兼容大小写 propertyId/propertyid 等）：

```json
{
  "propertyId": "uuid",
  "propertyid": "uuid",
  "clientId": "uuid",
  "clientid": "uuid",
  "agreementId": "uuid",
  "agreementid": "uuid",
  "status": "pending",
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

- **status** 取值：
  - `"pending"`：待业主签署/未完成
  - `"completed"`：业主已签署（Owner Portal 完成协议后由后端改为 completed）
- 带 **propertyId + agreementId** 的条目来自 **Owner Setting 的「邀请业主」** 流程；仅 **clientId + status + createdAt** 的简单条目来自 **Contact 页的 submitOwnerApproval**（只表示「该 client 已发过邀请」，没有绑定物业/协议）。

### 1.2 哪里写入 / 谁写

| 场景 | 写入位置（Node） | API / 方法 |
|------|------------------|------------|
| Contact 页「提交业主批准」 | ownerdetail.approvalpending | `POST /api/contact/submit-owner-approval` → `contact.service.submitOwnerApproval`：若该 owner 尚无本 client 的 pending，则 push `{ clientId, status: 'pending', createdAt }`。 |
| Owner Setting 保存邀请（选物业+协议） | ownerdetail.approvalpending + agreement 表 | `ownersetting.service.saveOwnerInvitation`：插入/更新 agreement（owner_operator, pending），并在 approvalpending 里 push/更新一条带 propertyId, clientId, agreementId, status: 'pending', createdAt, updatedAt。 |
| 业主在 Owner Portal 签署完成 | ownerdetail.approvalpending | `POST /api/ownerportal/complete-agreement-approval` → `ownerportal.service.completeAgreementApproval`：把对应 propertyId/clientId/agreementId 且 status= pending 的条目改为 `status: 'completed'`，并设 signedAt。 |
| 业主在 Owner Portal 拒绝 | ownerdetail.approvalpending | `POST /api/ownerportal/remove-approval-pending` → `ownerportal.service.removeApprovalPending`：按 propertyId + clientId 删掉该条。 |

### 1.3 哪个页面 edit / 怎样 edit

- **Owner Setting 页**（Wix：ownersetting，前端见 `docs/wix/frontend/ownersetting-page-full.js`）
  - **列表**：`#repeaterlistowner` 里，**只有「pending 邀请」行**（`item.__pending === true`）会启用 **#buttonedit**。
  - **Edit 流程**：点 Edit → 进入 **Create Owner / 邀请 section**（`#sectioncreateowner`），带 `editingPendingContext = { propertyId, pendingOwner }`；`pendingOwner.approvalpending` 里找到该 propertyId 且 status= pending 的项，把其 `agreementId`/`agreementid` 填到 `#dropdownchooseagreement`，property 填到 `#dropdownproperty`，再点 **Update** 会调 `saveOwnerInvitation(..., { editingPendingContext })` 更新该条（含 agreement 行与 approvalpending 里 agreementId/updatedAt）。
  - **新建邀请**：同 section，选邮箱/物业/协议后 Save，即写入新一条 pending。
- **Owner Portal 页**（业主端）
  - 业主登录后看到待签署协议；点「完成」→ 调 `completeAgreementApproval`（改 status 为 completed）；点「拒绝」→ 调 `removeApprovalPending`（从数组移除该条）。

---

## 二、Tenant 待批准：tenantdetail.approval_request_json

### 2.1 Value 格式（JSON 数组）

每条元素形状：

```json
{
  "clientId": "uuid",
  "status": "pending",
  "createdAt": "ISO date string"
}
```

- **status**：目前只用到 `"pending"`（待租客接受/拒绝）。接受后该条会从数组移除，并在 **tenant_client** 插入 (tenant_id, client_id)；拒绝则只从数组移除。
- 没有 propertyId / agreementId；只表示「该 client 向该租客发起了批准请求」。

### 2.2 哪里写入 / 谁写

| 场景 | 写入位置（Node） | API / 方法 |
|------|------------------|------------|
| Contact 页「提交租客批准」 | tenantdetail.approval_request_json | `POST /api/contact/submit-tenant-approval` → `contact.service.submitTenantApproval`：若该 tenant 尚未被本 client 批准且没有 pending，则 push `{ clientId, status: 'pending', createdAt }`。 |
| Booking 选租客（按 id 或 email） | tenantdetail.approval_request_json | `booking.service` 内：若租客未被本 client 批准且尚无 pending，则 push `{ clientId, status: 'pending', createdAt: new Date().toISOString() }`（选已有 tenant 或按 email 创建新 tenant 时都会写）。 |
| 租客在 Tenant Dashboard 接受 | tenant_client 插入 + approval_request_json 删除该条 | `tenantdashboard.service`：接受时从 approval_request_json 里删掉本 clientId 的 pending 条，并 `INSERT IGNORE INTO tenant_client (tenant_id, client_id)`。 |
| 租客在 Tenant Dashboard 拒绝 | tenantdetail.approval_request_json | `tenantdashboard.service.tenantReject`：从数组里 filter 掉 `clientId === clientId && status === 'pending'` 的条。 |
| 取消预订 | tenantdetail.approval_request_json | `tenancysetting.service` 取消 booking：从该 tenant 的 approval_request_json 中移除本 clientId 的项。 |

### 2.3 哪个页面 edit / 怎样 edit

- **Contact 页**（contact-setting）
  - 在联系人详情里对 **Tenant** 点「提交批准」会调 `submitTenantApproval(tenantEmail)`，只**写入**一条 pending，没有「编辑已有 pending」的 UI（pending 在 Tenant Dashboard 由租客接受/拒绝）。
- **Booking 页**
  - 选租客（或输入 email 创建新租客）时，若该租客尚未被本 client 批准，后端会**自动写入**一条 pending，无需单独「edit」。
- **Tenant Dashboard 页**（租客端）
  - 租客看到待批准请求；点「接受」→ 后端从 approval_request_json 移除并写入 tenant_client；点「拒绝」→ 后端仅从 approval_request_json 移除。这里没有「改 value」的编辑，只有接受/拒绝两种操作。

---

## 三、对照小结

| 项目 | Owner (approvalpending) | Tenant (approval_request_json) |
|------|--------------------------|---------------------------------|
| **表/列** | ownerdetail.approvalpending | tenantdetail.approval_request_json |
| **每条 value** | propertyId, clientId, agreementId, status, createdAt, updatedAt（status: pending \| completed） | clientId, status, createdAt（status: pending） |
| **写入：发邀请/请求** | Contact submitOwnerApproval；Owner Setting saveOwnerInvitation | Contact submitTenantApproval；Booking 选租客 |
| **写入：完成/拒绝** | Owner Portal completeAgreementApproval（改 completed）、removeApprovalPending（删条） | Tenant Dashboard 接受（删条+写 tenant_client）、tenantReject（删条） |
| **编辑 pending 的页面** | Owner Setting：仅 pending 行可 #buttonedit，进 Create Owner section 改物业/协议后 Update | 无「编辑 pending 条」的页；租客只能接受/拒绝 |
