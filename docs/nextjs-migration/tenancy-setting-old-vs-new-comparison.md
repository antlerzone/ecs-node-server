# Tenancy Setting 页面：旧代码 (Wix) vs 新代码 (Next) 功能对比表

- **旧代码**：Wix frontend (tenancy setting 页) + `backend/saas/tenancysetting.jsw`，门禁 `backend/access/manage`，Topup 用 `backend/saas/topup`。
- **新代码**：Next `app/operator/tenancy/page.tsx`，API `lib/operator-api.ts`（getTenancySettingList, getTenancySettingFilters, getRoomsForChange, extendTenancy, changeRoomTenancy, terminateTenancy）。

---

## 功能对照表（Wix vs Next）

| 功能 | Wix (旧) | Next (新) | 状态 |
|------|----------|-----------|------|
| **门禁 / 权限** | getAccessContext；credit &lt; 0 仅 Topup；tenantdetail \|\| admin 才可进 | 无门禁/credit 检查（Operator 登录即进） | ⚠️ 刻意不做/可补 |
| **Tab** | tenancy / topup / view(grid-list) / companysetting | 单页，无 tab；无 Topup、无 Company Setting 入口 | ❌ 新无 tab；Topup 在 Credit 页 |
| **列表筛选** | getTenancyFilters → property 下拉 + status(All/Active/Inactive)；搜索 input；分页 | getTenancySettingFilters → property + status 下拉；搜索；date from/to；limit 500，前端 filter | ✅ 有（无 server 分页） |
| **列表展示** | Grid：repeater 卡片 + 每卡菜单；List：listView 分页 + 每行菜单 | **Table** 一表，DropdownMenu 操作（无 Grid/List 切换） | ⚠️ 新仅表格，无 grid/list 切换 |
| **分页** | paginationtenantmanagement（grid）；paginationlistview（list）；cache 或 server 分页 | 无分页（limit 500 一次拉取，前端 filter） | ❌ 新无分页 |
| **每行/卡操作** | 延租 / 换房 / 终止 / 上传协议 / 模板协议；关闭菜单 | 延租 / 换房 / 终止 / View Details / Edit Tenancy（Edit 无后端） | ⚠️ 新无协议、无取消预约 |
| **pending_approval** | 卡片黄底；仅显示「取消预约」不显示延租/换房/终止 | Status=Pending；无「取消预约」入口 | ❌ 新无取消预约 |
| **延租 (Extend)** | 日期、租金、协议费、押金；提交 disable+Loading…；switchSection+refresh | Dialog：new end date、new rent、deposit、agreement fee；extendTenancy()；关 Dialog+loadData | ✅ 有 |
| **换房 (Change Room)** | 房间下拉(Keep Current+可用房)、租金/押金/协议费/日期、**预览 prorate**、提交 | Dialog：new room、change date、rent/deposit/agreement；changeRoomTenancy()；**无 Keep Current；无 prorate 预览** | ⚠️ 新无预览、无 Keep Current |
| **终止 (Terminate)** | 没收金额、确认后 switchSection+refresh | Dialog：forfeit amount、optional reason；terminateTenancy() | ✅ 有 |
| **取消预约 (Cancel Booking)** | 仅 list 且 pending 时；二次确认(Confirm Delete Booking)；cancelBooking(tenancyId) | 无 | ❌ 新无 |
| **上传协议 (Manual URL)** | #sectionuploadagreement；mode 下拉；input URL；insertAgreement(type:'manual', url, status:'complete') | 无 | ❌ 新无 |
| **模板协议 (Template)** | #sectionagreement；mode 下拉→getAgreementTemplates(mode)→模板下拉；datepickeragreement1/2（续约期限）；#textnotify 提示；insertAgreement(type:'system', templateId, extendBegin, extendEnd) | 无 | ❌ 新无 |
| **换房预览** | previewChangeRoomProrate(oldRental, newRental, changeDate) → 显示 Prorate+Deposit Topup+Agreement+Total Payable | 无 | ❌ 新无 |
| **延租选项** | getExtendOptions(tenancyId) → paymentCycle、maxExtensionEnd（#datepickerextension 上限） | 无 | ❌ 新无 |
| **Topup 区块** | #sectiontopup：余额、套餐 repeater、选中、Checkout（&gt;1000 提示+submitTicket）；buttontopupclose | 无（在 Credit 页） | ⚠️ 刻意不做 |
| **提交按钮** | 点击 disable + label "Loading..."，完成后 switch section，finally enable + 恢复 label | 无统一 Loading 态（可补） | ⚠️ 可补 |
| **详情** | list 行点「详情」→ openListViewDetail(tenancy, tenant, room) | View Details → Dialog 只读信息 | ✅ 有 |
| **New Tenancy** | — | Link to /operator/booking | ✅ 有 |

---

## 后端 API 对照（Node 已有 vs Next 是否调用）

| 后端路由 (Node) | Wix tenancysetting.jsw | Next operator-api | 说明 |
|----------------|------------------------|-------------------|------|
| POST /api/tenancysetting/list | getTenancyList | getTenancySettingList | ✅ |
| POST /api/tenancysetting/filters | getTenancyFilters | getTenancySettingFilters | ✅ |
| POST /api/tenancysetting/rooms-for-change | getRoomsForChange | getRoomsForChange | ✅ |
| POST /api/tenancysetting/change-preview | previewChangeRoomProrate | ❌ 无 | 需加 |
| POST /api/tenancysetting/extend-options | getExtendOptions | ❌ 无 | 需加 |
| POST /api/tenancysetting/extend | extendTenancy | extendTenancy | ✅ |
| POST /api/tenancysetting/change | changeRoom | changeRoomTenancy | ✅ |
| POST /api/tenancysetting/terminate | terminateTenancy | terminateTenancy | ✅ |
| POST /api/tenancysetting/cancel-booking | cancelBooking | ❌ 无 | 需加 |
| POST /api/tenancysetting/agreement-templates | getAgreementTemplates | ❌ 无 | 需加 |
| POST /api/tenancysetting/agreement-insert | insertAgreement | ❌ 无 | 需加 |

---

## 总结：新代码少了什么

| 项目 | 说明 |
|------|------|
| **Tab / Topup** | 旧：tenancy / topup / view / companysetting。新：单页，Topup 在 Credit 页。 |
| **Grid / List 切换** | 旧：Grid repeater + List listView 切换。新：仅 Table，无切换。 |
| **分页** | 旧：cache 或 server 分页。新：limit 500 一次拉，无分页。 |
| **取消预约** | 旧：pending 时 Cancel Booking + 二次确认 + cancelBooking。新：无。 |
| **换房预览** | 旧：previewChangeRoomProrate → Prorate + Deposit Topup + Agreement + Total。新：无。 |
| **延租选项** | 旧：getExtendOptions → paymentCycle、maxExtensionEnd。新：无。 |
| **协议** | 旧：上传 URL（manual）+ 模板（mode→templates，datepicker 续约期限，insertAgreement）。新：无。 |
| **换房 Keep Current** | 旧：房间下拉含 "Keep Current Room"。新：仅可选新房间，无 Keep Current。 |
| **提交 Loading** | 旧：按钮 disable + "Loading..."。新：可补。 |

---

## 结论：和 Wix 比有没有少功能？

**已有：** 列表（property/status/搜索/日期筛选）、延租、换房、终止、View Details、New Tenancy 入口；后端 list/filters/rooms-for-change/extend/change/terminate 已接。

**缺少：** 取消预约（pending）、换房 prorate 预览、延租选项（maxExtensionEnd 等）、上传/模板协议、Grid/List 切换、分页、换房「Keep Current」、提交按钮 Loading 态；operator-api 未接 cancel-booking、change-preview、extend-options、agreement-templates、agreement-insert。
