# Contact Setting 页面：旧 Wix vs 新 Next vs Node 后端 功能对比表

## 1. 前端功能对比（旧 Wix vs 新 Next）

| 功能 | 旧 Wix (Contact Setting) | 新 Next (operator/contact) | 备注 |
|------|---------------------------|----------------------------|------|
| **联系人列表** | getContactList(type, search, sort, page, pageSize, limit) | getContactList(search, pageSize: 500) | 新：不传 type/sort 给 API，前端 Tab + 前端排序 |
| **筛选** | 下拉 type：A>z, Z>a, Owner, Tenant, Supplier；搜索 inputcontact | Tab：All / Owner / Tenant / Supplier；Search 框 | 新：type 用 Tab 前端筛，sort 仅 A↔Z 前端 |
| **排序** | sort: A>z / Z>a 传 API 或前端 cache 排序 | sortBy: az / za 仅前端排序 | 一致（新未传 sort 给 API，Node 支持） |
| **分页** | 10 条/页，cache 最多 500 条，超过走 server 分页 | 无分页，单次 limit 500，全部前端展示 | 新：无分页 |
| **列表项** | text, role, roleColor, type, __pending；Edit / Delete(Cancel) | name, type, email, phone, Edit Account ID / Edit / Delete / Sync to Bukku | 新：无 Pending 状态、无 Cancel 文案 |
| **Get Owner** | getOwner(id) 点编辑时拉详情 | getOwnerDetail(entityId) 仅用于 Edit Account ID 拉 account[] | 一致（新仅用在 Account ID 弹窗） |
| **Get Tenant** | getTenant(id) 点编辑时拉详情 | getTenantDetail(entityId) 仅用于 Edit Account ID | 同上 |
| **Get Supplier** | getSupplier(id) 点编辑时拉详情 | getSupplierDetail(entityId) 仅用于 Edit Account ID | 同上 |
| **Update Owner Account** | 编辑里 #inputbukkuid → updateOwnerAccount(ownerId, contactId) | Edit Account ID 弹窗 → updateOwnerAccount(entityId, accountIdValue) | 一致 |
| **Update Tenant Account** | 同上 | 同上 | 一致 |
| **Update Supplier** | 编辑里可改 name/email/billerCode/bankName/bankAccount/bankHolder/contactId/productid → updateSupplier(supplierId, payload) | 仅 Edit Account ID → updateSupplierAccount(supplierId, contactId)；**无完整 Supplier 编辑表单** | 新：缺 Supplier 完整编辑（姓名/邮箱/银行/Jompay 等） |
| **Delete Owner** | deleteOwnerOrCancel(ownerId, isPending)；Pending 时按钮为 Cancel | **无**：handleConfirmDelete 只删本地 state，**不调 API** | 新：少功能 |
| **Delete Tenant** | deleteTenantOrCancel(tenantId, isPending) | **无**：同上 | 新：少功能 |
| **Delete Supplier** | deleteSupplierAccount(supplierId) | **无**：同上 | 新：少功能 |
| **Create Supplier** | #buttonsupplier → 表单 name/email/billerCode/bankName/bankAccount/bankHolder/dropdownmode(Jompay/Bank) → createSupplier(payload) | Add Contact → Supplier 表单仅本地，handleSaveNew **不调 API**，只 setContacts | 新：少功能 |
| **Submit Owner Approval** | #buttonowner → #inputemail2 → submitOwnerApproval(email) | **无**：Add Owner 只本地添加 | 新：少功能 |
| **Submit Tenant Approval** | #buttontenant → #inputemail2 → submitTenantApproval(email) | **无**：Add Tenant 只本地添加 | 新：少功能 |
| **Banks 下拉** | getBanks() → #dropdownbank 选项（bankdetail） | **未用 API**：硬编码 BANKS 数组 | 新：未接 getBanks |
| **Account System** | getAccountSystem() → contactAccountSystem, contactHasAccountSystem，无则 disable #inputbukkuid | getOnboardStatus() → accountingConnected / accountingProvider，无则隐藏 Edit Account ID | 等价（来源不同） |
| **Topup Section** | 有 #buttontopup、Credit plans、Checkout | 无（Contact 页不包含 Topup） | 产品取舍 |
| **权限** | permission.tenantdetail \|\| admin | 依赖 operator 路由 | 一致 |
| **Mobile** | "Please setting on pc version" | 响应式 | 新支持手机 |

---

## 2. 前端调用的 API 对比（Wix JSW vs Next operator-api）

| API | 旧 Wix (contact.jsw) | 新 Next (operator-api.ts) | Node 路由 |
|-----|----------------------|---------------------------|-----------|
| 列表 | getContactList(opts) → POST /api/contact/list | getContactList(opts) ✅ | POST /api/contact/list ✅ |
| 银行 | getBanks() → POST /api/contact/banks | getBanks() ✅（**Next 页未调用**） | POST /api/contact/banks ✅ |
| 会计系统 | getAccountSystem() → POST /api/contact/account-system | getAccountSystem() ✅（**Next 页用 getOnboardStatus 代替**） | POST /api/contact/account-system ✅ |
| Owner 详情 | getOwner(ownerId) → POST /api/contact/owner | getOwnerDetail(ownerId) ✅ | POST /api/contact/owner ✅ |
| Tenant 详情 | getTenant(tenantId) → POST /api/contact/tenant | getTenantDetail(tenantId) ✅ | POST /api/contact/tenant ✅ |
| Supplier 详情 | getSupplier(supplierId) → POST /api/contact/supplier | getSupplierDetail(supplierId) ✅ | POST /api/contact/supplier ✅ |
| 更新 Owner Account | updateOwnerAccount(ownerId, contactId) | updateOwnerAccount(ownerId, contactId) ✅ | POST /api/contact/owner/update-account ✅ |
| 更新 Tenant Account | updateTenantAccount(tenantId, contactId) | updateTenantAccount(tenantId, contactId) ✅ | POST /api/contact/tenant/update-account ✅ |
| 更新 Supplier | updateSupplier(supplierId, payload) 全字段 | **仅** updateSupplierAccount(supplierId, contactId) | POST /api/contact/supplier/update ✅（Node 支持全 payload） |
| 删 Owner | deleteOwnerOrCancel(ownerId, isPending) | **未在 operator-api 暴露** | POST /api/contact/owner/delete ✅ |
| 删 Tenant | deleteTenantOrCancel(tenantId, isPending) | **未在 operator-api 暴露** | POST /api/contact/tenant/delete ✅ |
| 删 Supplier | deleteSupplierAccount(supplierId) | **未在 operator-api 暴露** | POST /api/contact/supplier/delete ✅ |
| 建 Supplier | createSupplier(payload) | **未在 operator-api 暴露** | POST /api/contact/supplier/create ✅ |
| Owner 审批 | submitOwnerApproval(ownerEmail) | **未在 operator-api 暴露** | POST /api/contact/submit-owner-approval ✅ |
| Tenant 审批 | submitTenantApproval(tenantEmail) | **未在 operator-api 暴露** | POST /api/contact/submit-tenant-approval ✅ |
| 同步 Transit | upsertContactTransit(clientId, payload) | **未在 operator-api 暴露** | POST /api/contact/upsert-transit ✅（create 内部会用） |

---

## 3. Node 后端（与旧 Wix 一致）

Node 已实现旧 Wix 使用的全部 Contact 接口，**没有少接口**：

- POST /api/contact/list  
- POST /api/contact/owner, /tenant, /supplier  
- POST /api/contact/banks, /account-system  
- POST /api/contact/owner/update-account, /tenant/update-account  
- POST /api/contact/owner/delete, /tenant/delete, /supplier/delete  
- POST /api/contact/supplier/create, /supplier/update  
- POST /api/contact/upsert-transit  
- POST /api/contact/submit-owner-approval, /submit-tenant-approval  

---

## 4. 总结：新 Next 少了什么

| 项目 | 说明 |
|------|------|
| **Add Owner / Add Tenant** | 旧：提交邮箱 → submitOwnerApproval / submitTenantApproval。新：仅本地 state，不调 API。 |
| **Add Supplier** | 旧：完整表单 → createSupplier。新：仅本地，不调 createSupplier。 |
| **Delete（Owner/Tenant/Supplier）** | 旧：deleteOwnerOrCancel / deleteTenantOrCancel / deleteSupplierAccount。新：仅从列表移除，不调 API。 |
| **Supplier 完整编辑** | 旧：编辑 name/email/billerCode/bank/Jompay/Bank Transfer/contactId/productid → updateSupplier。新：只支持 Edit Account ID（updateSupplierAccount），无姓名/银行等编辑。 |
| **Pending 状态** | 旧：列表显示 Pending Approval，Delete 变 Cancel。新：无。 |
| **getBanks** | 旧：下拉用 bankdetail。新：硬编码 BANKS，未调 getBanks。 |
| **getContactList 的 type/sort** | 新未传 type、sort，仅前端 Tab + 前端排序；Node 支持 type/sort。 |
| **分页** | 旧：10 条/页，>500 走 server。新：单次 500 条无分页。 |

**建议补全（若要对齐旧版）：**

1. operator-api 增加：deleteOwnerOrCancel, deleteTenantOrCancel, deleteSupplierAccount, createSupplier, updateSupplier(全字段), submitOwnerApproval, submitTenantApproval。  
2. Next Contact 页：Add Owner/Tenant 调 submit*Approval；Add Supplier 调 createSupplier；Delete 调对应 delete API；Supplier 编辑用 updateSupplier 全字段；银行下拉用 getBanks()。
