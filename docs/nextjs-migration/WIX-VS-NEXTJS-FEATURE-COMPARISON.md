# Wix vs Next.js Operator Portal 功能对比表

| Wix 页面 | Next.js 页面 | 功能项 | Wix 有 | Next.js 有 | 备注 |
|----------|--------------|--------|:------:|:----------:|------|
| **admindashboard** | operator/ + approval/ | Dashboard KPIs | ✅ | ✅ | |
| | | Feedback 列表/处理 | ✅ | ✅ | |
| | | Refund 列表/处理 | ✅ | ✅ | |
| | | 待 Operator 签 Agreement | ✅ | ✅ | |
| | | Tenancy 列表（按 staff 筛选） | ✅ | ⚠️ | Next 有 getTenancyList，approval 页未展示 tenancy 列表 |
| | | #buttonagreementlist → sectionproperty | ✅ | ❌ | Next 无「Tenancy 列表 + 点 tenancy 签 agreement」流程 |
| | | Profile 门控（未填好前禁用 admin） | ✅ | ⚠️ | 待确认 |
| | | Topup 区块 | ✅ | ✅ | layout 显示 credit |
| **companysetting** | company/ | Profile（公司名/SSM/地址/银行等） | ✅ | ✅ | |
| | | Admin/Fees（payout/salary/rental/deposit/commission 等） | ✅ | ✅ | |
| | | Staff 列表/新增/编辑/禁用 | ✅ | ✅ | |
| | | Stripe 连接/断开 | ✅ | ✅ | |
| | | CNYIoT 连接/断开 | ✅ | ✅ | |
| | | TTLock 连接/断开 | ✅ | ✅ | |
| | | Bukku/Xero/AutoCount/SQL 连接/断开 | ✅ | ✅ | |
| | | 头像/公司章上传 OSS | ✅ | ⚠️ | Next 未集成上传 |
| | | Topup 区块 | ✅ | ✅ | layout |
| **propertysetting** | property/ | 物业列表/筛选/搜索 | ✅ | ✅ | |
| | | 物业详情/编辑 | ✅ | ✅ | |
| | | 新增物业 | ✅ | ✅ | |
| | | Parking Lots 车位管理 | ✅ | ❌ | **缺失** |
| | | 业主协议（Owner/Agreement 绑定） | ✅ | ❌ | **缺失** |
| | | setPropertyActive 启用/禁用 | ✅ | ❌ | **缺失** |
| | | 占用检查 isPropertyFullyOccupied | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **roomsetting** | room/ | 房间列表/筛选/搜索 | ✅ | ✅ | |
| | | 房间详情/编辑 | ✅ | ✅ | |
| | | 新增房间 | ✅ | ✅ | |
| | | setRoomActive 启用/禁用 | ✅ | ❌ | **缺失** |
| | | Meter 绑定（updateRoomMeter） | ✅ | ❌ | **缺失** |
| | | Smart Door 绑定（updateRoomSmartDoor） | ✅ | ❌ | **缺失** |
| | | 主图/相册上传 | ✅ | ❌ | **缺失** |
| | | getTenancyForRoom 详情内租客信息 | ✅ | ⚠️ | Next 有 hasActiveTenancy，无详情 |
| | | Topup 区块 | ✅ | ✅ | layout |
| **ownersetting** | owner/ | 业主列表/搜索 | ✅ | ✅ | |
| | | searchOwnerByEmail | ✅ | ❌ | **缺失** |
| | | 业主邀请 saveOwnerInvitation | ✅ | ❌ | **缺失** |
| | | 从物业解绑 deleteOwnerFromProperty | ✅ | ❌ | **缺失** |
| | | 删除业主映射 removeOwnerMapping | ✅ | ❌ | **缺失** |
| | | 业主创建 createOwner | ✅ | ❌ | **缺失** |
| | | 业主编辑 | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **agreementsetting** | agreement-setting/ | 协议模板列表/搜索/分页 | ✅ | ⚠️ | Next 用 mock，未接 API |
| | | 新建/编辑/删除模板 | ✅ | ⚠️ | Next 用 mock |
| | | Topup 区块 | ✅ | ✅ | layout |
| **metersetting** | meter/ | 电表列表/筛选 | ✅ | ⚠️ | Next 用 mock |
| | | parent/child/brother 分组 | ✅ | ⚠️ | Next 有 UI，mock 数据 |
| | | 抄表/用量/分摊方式 | ✅ | ❌ | **缺失** |
| | | 新增/编辑电表 | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **smartdoorsetting** | smart-door/ | 门锁/网关列表 | ✅ | ⚠️ | Next 有页面，mock |
| | | 门锁详情/绑定房间 | ✅ | ❌ | **缺失** |
| | | Child lock | ✅ | ❌ | **缺失** |
| | | 新增门锁 insertSmartDoors | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **tenancysetting** | tenancy/ | 租约列表/筛选 | ✅ | ⚠️ | Next 用 mock |
| | | 延租 extendTenancy | ✅ | ⚠️ | Next 有 UI，mock |
| | | 换房 changeRoom | ✅ | ⚠️ | Next 有 UI，mock |
| | | 终止 terminateTenancy | ✅ | ⚠️ | Next 有 UI，mock |
| | | 取消预约 cancelBooking | ✅ | ❌ | **缺失** |
| | | 协议上传/模板 | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **expenses** | expenses/ | 费用列表/筛选 | ✅ | ✅ | |
| | | 新增/编辑/删除 | ✅ | ⚠️ | Next 有 delete，新增/编辑待确认 |
| | | 批量标记已付 | ✅ | ✅ | |
| | | Topup 区块 | ✅ | ✅ | layout |
| **tenant-invoice** | invoice/ | 租金列表 getRentalList | ✅ | ⚠️ | Next 用 mock |
| | | Meter 组/用量/分摊 | ✅ | ⚠️ | Next 有 UI，mock |
| | | 新增/编辑/删除租金 | ✅ | ❌ | **缺失** |
| | | 发票类型/物业筛选 | ✅ | ⚠️ | Next 有 UI，mock |
| | | Topup 区块 | ✅ | ✅ | layout |
| **contact-setting** | contact/ | 联系人列表（owner/tenant/supplier） | ✅ | ⚠️ | Next 用 mock |
| | | 新增/编辑/删除 | ✅ | ⚠️ | Next 有 UI，mock |
| | | Bukku 同步 | ✅ | ❌ | **缺失** |
| | | 业主/租客审批 | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **generatereport** | report/ | Owner Payout 报表 | ✅ | ⚠️ | Next 用 mock |
| | | 生成报表 | ✅ | ❌ | **缺失** |
| | | Bank Bulk Transfer 下载 | ✅ | ❌ | **缺失** |
| | | 导出 PDF | ✅ | ❌ | **缺失** |
| | | Topup 区块 | ✅ | ✅ | layout |
| **billing** | billing/ + credit/ | 套餐/余额/充值 | ✅ | ✅ | |
| | | 每条 Core 过期日（CORE Credit: X, Expired: date） | ✅ | ✅ | Credit 页 + Billing 页「View Plan Details」内 |
| | | creditusage 文案（billing 摘要说明） | ✅ | ✅ | 后端 clientdetail.creditusage，有则展示 |
| | | Balance 列（交易表 running balance） | ✅ | ✅ | 后端 getStatementItems 计算，表无 balance 列 |
| | | 导出 Excel（Statement） | ✅ | ✅ | Credit 页 / Billing 页「Export Excel」→ statement-export |
| | | Top-up ≤1000：Stripe 支付 | ✅ | ✅ | startTopup → 跳转 Stripe |
| | | Top-up >1000：银行转账 + 提交 ticket | ✅ | ✅ | submitTicket(mode: topup_manual) + problem 说明框 |
| | | Credit 页：仅 credit 交易（creditOnly） | ✅ | ✅ | filterType: creditOnly |
| | | Billing 页：仅 plan 交易（planOnly） | ✅ | ✅ | filterType: planOnly |
| | | Top-up 行有 Invoice 按钮 | ✅ | ✅ | invoiceUrl 存在时显示 |
| | | Plan history 有金额 + invoiceUrl 时 Invoice 按钮 | ✅ | ✅ | |
| | | 规则文案：-10/agreement、-10/room/month | ✅ | ✅ | Credit Usage Rules 卡片 |
| | | Statement 明细 | ✅ | ✅ | getStatementItems，Credit/Billing 分页展示 |
| **account-setting** | accounting/ | 科目同步 resolveAccountSystem | ✅ | ⚠️ | Next 有页面，待确认 |
| | | Bukku 科目 sync | ✅ | ❌ | **缺失** |
| **booking** | booking/ | 预约列表/创建 | ✅ | ⚠️ | Next 有页面，待确认 |
| **manual-billing** | — | SaaS 手动充值/续费 | ✅ | — | 非 Operator 功能 |
| **available-unit** | — | 公开房源列表 | ✅ | — | 公开页，无 Operator 对应 |
| **help** | — | FAQ/工单 | ✅ | — | 无 Operator 对应 |
| **enquiry** | — | 询盘 | ✅ | — | 公开页 |

---

## 图例

- ✅ 已对接
- ⚠️ 部分对接 / mock

---

## 缺失功能汇总（需优先补齐）

1. **Property**：Parking Lots、业主协议、setPropertyActive、占用检查
2. **Room**：setRoomActive、Meter/Smart Door 绑定、主图/相册上传
3. **Owner**：创建业主、邀请、解绑、删除、编辑
4. **Meter**：真实 API 对接、抄表、分组编辑
5. **Smart Door**：真实 API 对接、绑定房间、Child lock
6. **Tenancy**：真实 API 对接、取消预约、协议上传
7. **Invoice**：getRentalList 等真实 API、新增/编辑/删除租金
8. **Contact**：真实 API 对接、Bukku 同步、审批
9. **Report**：生成报表、Bank Bulk Transfer、导出 PDF
10. **Agreement Setting**：真实 API 对接
11. **Admin**：Tenancy 列表 + 点 tenancy 签 agreement 流程
