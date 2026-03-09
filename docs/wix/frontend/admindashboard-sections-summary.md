# Admin 页面 Section 与 Repeater 说明

## 1) #sectionproperty 是怎样打开的？

- **入口**：点击 **#buttonagreementlist**（在 default section 的 tab/导航里）。
- **流程**：`#buttonagreementlist.onClick` → `switchSectionAsync('property')` → 首次进入时执行 `initPropertySection()` → 拉取 `getTenancyFilters()` 和 `getTenancyList()`，把 tenancy 列表赋给 **#repeatertenancy**，并 expand **#sectionproperty**。
- 无 #buttonproperty；#repeateragreement 已删除。

---

## 2) #repeateradmin 显示什么？

**#repeateradmin** 的数据来自 **getAdminList({ limit: 1000 })**，后端合并三类数据：

| 类型 | 来源 | 说明 |
|------|------|------|
| **Feedback** | listFeedback(clientId) | 租客反馈（feedback 表），含 description、photo、video、done、remark |
| **Refund** | listRefundDeposit(clientId) | 退押金待处理（refunddeposit 表），含 amount、room、tenant、done |
| **PENDING_OPERATOR_AGREEMENT** | listPendingOperatorAgreements(clientId) | 待 staff 签名的合约（agreement 表：mode = tenant_operator/owner_operator，operatorsign 为空，status = ready_for_signature/locked，且有 url） |

- **#dropdownfilter** 可选：All / Feedback / Refund / **Agreement**。选 Agreement 时只显示「待 Operator 签名」的项。
- 每条在 **#textadmindescription** 的展示：
  - Feedback：description 或「房间/物业 smart door battery low」；
  - Refund：`Refund | 房间 - 租客`；
  - PENDING_OPERATOR_AGREEMENT：`房间 \| 租客`，**#buttonviewdetail** label = "Sign Agreement"，点击 → 打开 #sectionagreement 并加载该 agreement 签名。

---

## 3) #repeatertenancy 显示什么？

**#repeatertenancy** 在 **#sectionproperty** 里，数据来自 **getTenancyList**（由 **#buttonagreementlist** 打开 sectionproperty 后调用；API 为 `POST /api/admindashboard/tenancy-list`）。

- **只显示与当前 Staff 相关的 tenancy**：后端按 `tenancy.submitby_id = 当前 staff` 或 `tenancy.last_extended_by_id = 当前 staff` 筛选。即：Staff A 创建的 booking（submitby_id=A）→ A 可见；Staff B 做 extend 的 tenancy（last_extended_by_id=B）→ B 也可见；其他 staff 的租约不出现在此列表。
- 请求时带 **#dropdownproperty**、**#dropdownstatus** 筛选（propertyId、status、limit: 500）。
- **每条 = 一个 tenancy（租约）**。每行展示：物业名、租客名、租期（begin–end）、租金。
- 每个 tenancy 带 **agreements** 数组。**#buttontenanttenancy**：取该 tenancy 下 **第一条有 url 的 agreement**，调 getAgreementForOperator 后 openAgreementSectionForOperator → 打开 #sectionagreement 显示该 agreement 并签名。若该 tenancy 没有任何 agreement 有 url，按钮会 disable。

---

## 4) #buttontenanttenancy 打开 #sectionagreement 后

- **#repeateragreement 已删除**，不再使用。
- **#buttontenanttenancy** 点击后：打开 **#sectionagreement**，其中是 **单份 agreement 的签名界面**（#boxagreement、#htmlagreement、#signatureinputagreement、#buttonagree、#buttoncloseagreement），即「点哪条 tenancy → 就打开该 tenancy 下选中的那一份 agreement」。

---

## 小结

| 元素 | 作用 | 数据来源 |
|------|------|----------|
| #buttonagreementlist | 打开 #sectionproperty | 点击 → switchSectionAsync('property') |
| #repeateradmin | 列表：Feedback + Refund + 待 Operator 签的 Agreement | getAdminList → feedback + refunddeposit + listPendingOperatorAgreements |
| #repeatertenancy | 列表：**仅当前 Staff 做的 booking 的 tenancy**（按物业+状态筛选） | getTenancyList（API 传 staffId → tenancy.submitby_id） |
| #buttontenanttenancy | 打开 #sectionagreement，显示该 tenancy 下第一条有 url 的 agreement | getAgreementForOperator → openAgreementSectionForOperator |
| #sectionagreement | 单份 agreement 的签名界面（无 repeater） | getAgreementTemplate + getTenant/OwnerAgreementContext → #htmlagreement |
