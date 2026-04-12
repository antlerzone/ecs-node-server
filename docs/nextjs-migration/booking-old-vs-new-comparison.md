# Booking 页面：旧代码 (Wix) vs 新代码 (Next) 功能对比表

- **旧代码**：Wix `frontend/booking.js` + `backend/saas/booking.jsw`，门禁 `backend/access/manage`，Company Setting `getAdmin`。
- **新代码**：Next `app/operator/booking/page.tsx`，API `lib/operator-api.ts`。

---

## 当前功能对照表（Wix vs Next）

| 功能 | Wix (旧) | Next (新) | 状态 |
|------|----------|-----------|------|
| **门禁 / Credit** | getAccessContext；credit < 0 强制 Top Up | 无（Operator 登录即进；Top Up 在 Credit 页） | ⚠️ 刻意不做 |
| **权限** | booking \|\| admin 才可进入 | 无显式校验（同 Operator 登录） | ⚠️ 可补 |
| **Admin Rules** | getAdminRules() → deposit/agreement/parking/commission/rental/otherFees | getAdminRules() 页面 load 预填规则，选房后按规则填费用 | ✅ 有 |
| **Company 默认费用** | getAdmin() → agreementFees、parking 预填 | getAdmin() + getAdminRules() 预填 agreementFees、parking | ✅ 有 |
| **可用房间** | getAvailableRooms(keyword) → radiogroup | getAvailableRooms(propertySearch) → **下拉 (Available unit)** | ✅ 有 |
| **房间详情** | getRoom(roomId) + admin 规则填 deposit/agreement/parking/otherFees + getParkingLotsByProperty | getBookingRoom(roomId) + admin 规则 + getParkingLotsByProperty(propertyId) | ✅ 有 |
| **Parking Lots** | getParkingLotsByProperty(propertyId)，已租不显示 | getParkingLotsByProperty(propertyId)，后端只返回 available=1 | ✅ 有 |
| **租客搜索** | searchTenants(keyword) debounce；公邮短关键词封锁 | searchTenants(keyword) debounce 500ms | ✅ 有（无短关键词封锁） |
| **租客选择 + 详情** | getTenant(tenantId) → 显示 Name/Email/Phone | getTenant(tenantId) 选人后拉详情显示 | ✅ 有 |
| **租期** | datepicker1 / datepicker2 | startDate / endDate (input type=date) | ✅ 有 |
| **日期规则** | getForcedEndDate(start, end, rentalRule) 自动改 end | getForcedEndDate，first/last/specific 自动改结束日 | ✅ 有 |
| **费用输入** | rental, deposit, agreementFees, parkingFees；可编辑 | 同上，可编辑 | ✅ 有 |
| **Commission** | 按 admin commissionRules 算出，显示在 summary | **Commission (MYR) input + Charge on (Tenant/Owner) 下拉**；以输入为最终，Summary 跟随 | ✅ 有 |
| **Add-ons** | repeater addon；otherFees 预填一条 | addOns 数组；otherFees 从规则预填 | ✅ 有 |
| **Summary** | Rental/Deposit/Agreement/Parking/Add-ons、prorate、TOTAL MOVE IN | Recurring (monthly) / One-time、Prorate 公式、Rental/Parking Total、Commission（来自 input）、TOTAL MOVE IN + 公式 | ✅ 有 |
| **Prorate + TOTAL MOVE IN** | calculateTenancyFinancial；commission 按规则 | 同逻辑 + 公式行；commission 用 input 最终值 | ✅ 有 |
| **Billing Blueprint** | generateBillingBlueprint() 传 createBooking | generateBillingBlueprint()，含 commissionInput/commissionChargeOn，传 createBooking | ✅ 有 |
| **提交** | createBooking(..., billingBlueprint, commissionSnapshot, adminRules) | createBooking() 完整 payload；返回 alreadyApproved/status | ✅ 有 |
| **提交成功** | 按钮 "Complete"，5 秒刷新 | 成功文案（pending approval / invoices generated） | ✅ 有 |
| **Top Up（页内）** | sectiontopup / buttontop | 无（统一在 Credit 页） | ⚠️ 刻意不做 |
| **Mobile 菜单** | #buttonmobilemenu / #boxmobilemenu | 用 layout 侧栏 | ✅ 可接受 |

---

## 后端 API 使用（Next 已接）

| 后端路由 (Node) | Next operator-api | 说明 |
|----------------|-------------------|------|
| POST /api/booking/admin-rules | getAdminRules() | ✅ |
| POST /api/booking/available-rooms | getAvailableRooms(keyword) | ✅ |
| POST /api/booking/room | getBookingRoom(roomId) | ✅ |
| POST /api/booking/search-tenants | searchTenants(keyword) | ✅ |
| POST /api/booking/tenant | getTenant(tenantId) | ✅ |
| POST /api/booking/parking-by-property | getParkingLotsByProperty(propertyId) | ✅ |
| POST /api/booking/create | createBooking(payload) | ✅ |
| companysetting/admin | getAdmin() | ✅ 预填 agreementFees/parking |

---

## 结论：和 Wix 比有没有少功能？

**核心流程已对齐：** 房间下拉、租客搜索+详情、租期、日期规则、费用与 Commission 输入/下拉、Prorate/公式/TOTAL MOVE IN、billing blueprint、createBooking 提交及成功提示，均已有。

**刻意不做或可补：** 门禁/credit 强转 Top Up（可放 Credit 页）、页内 Top Up、公邮短关键词封锁、显式 booking 权限校验。
