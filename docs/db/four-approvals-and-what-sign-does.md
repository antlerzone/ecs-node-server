# 四种 Approval 与 Owner/Tenant 签/批后会发生什么

## 〇、约定与澄清

- **Owner contact**：一旦把 owner 当「联系人」用，就需要 **binding propertydetail 与 owner**（propertydetail.owner_id 和/或 owner_property），否则业主签完/批完后在列表里无法体现「已绑定该物业」。
- **Approve（contact 或 agreement）**：只做「remove 当前这条 pending」：
  - 从 approvalpending / approval_request_json 里**只删本 client 对应的那条**（remove mapping），其它 client 的条目**都保留**；
  - 然后 refresh repeater，被 approve 的那条 item 从列表消失即可。
- **Agreement sign 是否写 agreement 表？**  
  **会写。** 业主签协议时前端先调 **updateAgreementSign**（写 agreement.ownersign、owner_signed_at、status），再调 completeAgreementApproval；租客签协议调 **agreement-update-sign**，后端 **updateAgreementTenantSign** 写 agreement.tenantsign、tenant_signed_at 等。所以 agreement 表在签协议时是有被更新的。

---

## 一、我们是否已有这四种？

| 类型 | 有/无 | 说明 |
|------|--------|------|
| **Owner mapping approval** | 有 | Contact 页「提交业主批准」→ `submitOwnerApproval`，在 ownerdetail.approvalpending 里加一条 `{ clientId, status: 'pending', createdAt }`，表示「该 client 已向该业主发过邀请」。没有单独的「业主点一下同意加入 Contact」的 mapping 写入 owner_client；列表显示靠 approvalpending 或 owner_client（历史/别处写入）。 |
| **Tenant mapping approval** | 有 | Contact 页「提交租客批准」或 Booking 选租客 → 在 tenantdetail.approval_request_json 加 pending；租客在 **Tenant Dashboard** 点 **Accept** → 写入 tenant_client、从 approval_request_json 删该条；点 **Reject** → 只从 approval_request_json 删该条。 |
| **Owner agreement signing approval** | 有 | Owner Setting 发邀请（选物业+协议）→ saveOwnerInvitation 写 approvalpending + agreement 行（pending）；业主在 **Owner Portal** 签协议 → **completeAgreementApproval** 把对应 approvalpending 条目标成 `status: 'completed'`。 |
| **Tenant agreement signing approval** | 有 | 租客在 **Tenant Dashboard** 对某份 tenancy 的协议进行签署 → `POST /api/tenantdashboard/agreement-update-sign`，后端 **updateAgreementTenantSign** 写 agreement.tenantsign、tenant_signed_at 等。 |

---

## 二、Owner 签/批时会干嘛？

### 2.1 业主在 Owner Portal「签协议」（Sign Agreement）

- **触发**：业主打开待签协议，点「Agree」/签署并提交。
- **前端**：先调 **updateAgreementSign**（agreementId, ownersign, ownerSignedAt, status），再调 **completeAgreementApproval**。
- **后端**：
  - **updateAgreementSign**：**会**更新 **agreement** 表：`ownersign`、`owner_signed_at`、`status`（completed / waiting_third）。
  - **completeAgreementApproval**：只改 **ownerdetail.approvalpending** 里「该 propertyId + clientId + agreementId 且 status= pending」的那一条 → `status: 'completed'`、`signedAt`；**不**写 owner_client、owner_property、**不**改 propertydetail.owner_id。

所以：**agreement 表有被更新**；缺的是签完后 **binding propertydetail 与 owner**（propertydetail.owner_id 和/或 owner_client/owner_property）。

### 2.2 业主在 Owner Portal「Client 批准」里的 Approve（另一块 UI）

- **触发**：在「Client approval」repeater 里，业主对某个 client 的请求点 **Approve**。
- **前端**：依次调  
  `mergeOwnerMultiReference` → `removeApprovalPending` → `syncOwnerForClient`。
- **后端**：
  - **mergeOwnerMultiReference**：只更新 **ownerdetail** 的单列 `property_id`、`client_id`（legacy），**不**写 owner_client / owner_property，**不**改 propertydetail.owner_id。
  - **removeApprovalPending**：从 ownerdetail.approvalpending 里删掉「该 propertyId + clientId」的那一条。
  - **syncOwnerForClient**：把该业主同步到该 client 的 Bukku contact（写 ownerdetail.account 里该 client 的 contactId）。

所以：**这里的 Approve = 删掉该条 pending + 更新业主单列 + 同步 Bukku；仍然没有写 junction 或 propertydetail.owner_id**。

---

## 三、Tenant 签/批时会干嘛？

### 3.1 租客在 Tenant Dashboard「接受批准」（Mapping Approval – Accept）

- **触发**：租客看到某 client 的批准请求，点 **Accept**。
- **前端**：调 `POST /api/tenantdashboard/tenant-approve`（或等同），传当前租客 email + clientId（由后端从 session/context 取）。
- **后端**：`tenantdashboard.service.tenantApprove`：
  - 从 **tenantdetail.approval_request_json** 里删掉「该 clientId 且 status= pending」的那一条。
  - **INSERT IGNORE INTO tenant_client (tenant_id, client_id)**，把该租客和该 client 关联。
  - 若有该租客+该 client 的 **tenancy**，则：
    - 把 tenancy.tenancystatus 里 `key === 'contact_approval'` 的项改为 `status: 'completed'`，`first_payment` 改为 `pending`；
    - 调 **generateFromTenancyByTenancyId**（生成 rental 等）。

所以：**Accept = 删 pending + 写 tenant_client + 若有 tenancy 则更新 tenancy 状态并生成 rental**。

### 3.2 租客在 Tenant Dashboard「拒绝批准」（Mapping Approval – Reject）

- **触发**：租客点 **Reject**。
- **后端**：`tenantdashboard.service.tenantReject`：
  - 只从 **tenantdetail.approval_request_json** 里删掉「该 clientId 且 status= pending」的那一条。
  - 不写 tenant_client，不改 tenancy。

所以：**Reject = 只删该条 pending**。

### 3.3 租客在 Tenant Dashboard「签协议」（Agreement Signing）

- **触发**：租客对某份协议（如 tenancy 相关）点签署并提交。
- **前端**：调 `POST /api/tenantdashboard/agreement-update-sign`，body 含 agreementId、tenantsign（签名数据）等。
- **后端**：`tenantdashboard.service.updateAgreementTenantSign`：
  - 校验该 agreement 属于当前租客的 tenancy。
  - 更新 **agreement** 表：写 **tenantsign**、**tenant_signed_at**，可选把 **status** 改为 completed 等。

所以：**租客签协议 = 只更新 agreement 行的租客签字与时间（及可选 status）**。

---

## 四、对照小结

| 动作 | 谁 / 在哪 | 会干嘛 |
|------|-----------|--------|
| **Owner 签协议** | Owner Portal – Sign Agreement | 只把 ownerdetail.approvalpending 里对应条目标成 status= completed、加 signedAt；不改 owner_client / owner_property / propertydetail.owner_id。 |
| **Owner Approve（Client 批准 repeater）** | Owner Portal – Client approval | mergeOwnerMultiReference（只改 ownerdetail 单列）+ removeApprovalPending（删该条）+ syncOwnerForClient（Bukku）。 |
| **Tenant Accept** | Tenant Dashboard | 删 approval_request_json 该条 + 写 tenant_client + 若有 tenancy 则更新 tenancy 状态并 generateFromTenancy。 |
| **Tenant Reject** | Tenant Dashboard | 只删 approval_request_json 该条。 |
| **Tenant 签协议** | Tenant Dashboard – agreement-update-sign | 只更新 agreement.tenantsign、tenant_signed_at（及可选 status）。 |

若希望「业主签完协议后」在 Owner Setting 列表里当「已绑定该物业」显示，需要在签完协议后**额外**写 **propertydetail.owner_id** 和/或 **owner_client / owner_property**（当前 completeAgreementApproval 未做这一步）。
