# Owner Portal 功能对比表（Wix 旧版 vs Next.js 迁移版）

基于 Wix 前端 + `backend/saas/ownerportal.jsw` 与 Next.js `app/owner/*`、`lib/owner-api.ts` 的逐项对比。

---

## 1. 页面与入口

| 功能/页面 | Wix 旧版 | Next.js 迁移版 | 备注 |
|----------|----------|----------------|------|
| 主导航 | 单页内 section 切换：My Property / Profile / Agreement / Report / Support | 独立路由：Dashboard、My Properties、Smart Door、Profile、Agreement、Owner Report、Cost Report、Approvals | Next 多页面 + 多出 Smart Door、独立 Approvals |
| Dashboard | 无独立首页，进入即「My Property」或需先完善 Profile | 有 `/owner`：KPI（物业数、单元数、入住率、本期 payout）、收入图、物业列表入口 | Next 新增 |
| 「非业主」提示 | 有：`You Are Not our Owner Yet`，主按钮禁用 | 由 `useAuth("owner")` 控制，未登录不渲染；无「已是用户但不是 owner」的单独文案 | 可考虑在 Next 增加「您还不是业主」提示 |
| Profile 未完成引导 | 未完成时强制切到 Profile、主操作受限 | 无强制跳转 Profile；依赖后端/业务判断 | 可选补：未完成 profile 时提示或跳 Profile |

---

## 2. My Property / 我的物业

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 物业下拉 | 有，All Properties + 按物业筛选 | 有，All Properties + 按物业筛选 | ✅ 一致 |
| 按房间展示 | 有，repeater 按 **房间**，每房间显示当前租约 | 按 **物业** 卡片，卡片内列当前租客（非按房间列表） | 展示维度不同：Wix 以房间为单位，Next 以物业+租客 |
| 租约信息 | 租客名、租期、租金、货币格式化 | 租客名、租期、租金（RM） | ✅ 一致 |
| 租约即将到期高亮 | 有，30 天内到期日期标红 | 无 | ⚠️ Next 可补 |
| 协议按钮（每房间/租约） | 有：Sign Agreement / View Agreement / Pending Complete / Unavailable | 有：Download Agreement（有 PDF 时） / “Agreement not yet available” | 逻辑等价，文案不同；Next 无「Sign Agreement」入口（签约在 Agreement 页） |
| Operator 下拉 | 有，`getClientsForOperator`，All Operators + 按 operator 筛选 | **无** | ⚠️ Next 缺少「按 Operator 筛选」 |

---

## 3. Profile / 个人资料

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 姓名 / 电话 / 邮箱 / 银行等 | 有 | 有 | ✅ |
| Entity Type 下拉 | 有（含 EXEMPTED_PERSON） | 有 | ✅ |
| Reg No Type（NRIC/BRN/PASSPORT） | 有，随 Entity Type 联动 | 有，EXEMPTED_PERSON 时禁用 | ✅ |
| Tax ID / 地址（street/city/state/postcode） | 有 | 有 | ✅ |
| 银行下拉 | `getBanks()` | `getBanks()` | ✅ |
| NRIC 上传 | 先 OSS 取 URL，再 `updateOwnerProfile({ nricFront/nricback })` | `uploadFile()` + `updateOwnerProfile({ nricFront/nricback })` | ✅ 实现方式不同，结果一致 |
| 更新后同步到客户账套 | 有，`syncOwnerForClient` 对 owner 下每个 account 调用 | **无** | ⚠️ Next 更新 Profile 后未调用 `syncOwnerForClient` |
| 修改密码 | 无 | 有（Change Password 弹窗，逻辑需后端支持） | Next 多出 |
| 邮箱变更验证 | 无 | 有（EmailVerificationDialog） | Next 多出 |

---

## 4. Agreement / 协议

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 协议列表 | `getAgreementList({ ownerId })` | 同 | ✅ |
| 状态 | pending / waiting_third / completed | pending / ready_for_signature / waiting_third / completed / locked | ✅ 兼容 |
| 签约流程 | 取模板 → 取 context（tenant_operator / owner_tenant / owner_operator）→ 渲染 HTML → 签名 → updateSign + completeAgreementApproval | 取模板 → getAgreementContext(mode) → 渲染 HTML → 签名 → updateSign + completeAgreementApproval | ✅ |
| Agreement context mode | 三种：tenant_operator、owner_tenant、owner_operator（按 agreement.mode） | 仅传 `owner_tenant` 或 `owner_operator`，未传 `tenant_operator` | ⚠️ 若模板为 tenant_operator，Next 会当 owner_operator 取 context，可能不对 |
| 签名输入 | 有 | 有（文本签名） | ✅ |
| 查看已签 PDF | 有，`wixLocation.to(pdfurl)` | 有，`window.open(pdfurl)` | ✅ |
| 模板占位符（含图片） | 有，`wixImageToStatic` 处理 wix:image | 仅文本替换，未处理 wix:image | ⚠️ 若模板含 Wix 图片占位符，Next 需另做图片处理 |

---

## 5. Owner Report / 业主报表

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 物业 + 日期范围 | 有 | 有 | ✅ |
| 月度列表 | totalrental, totalutility, totalcollection, expenses, netpayout | 同 | ✅ |
| 汇总（Total Rental / Utility / Gross / Expenses / Net） | 有 | 有 | ✅ |
| 整表 Export PDF | `exportOwnerReportPdf` | `exportOwnerReportPdf` | ✅ |
| 每行「月度报告」链接 | 有，`item.monthlyreport` 下载 | 有 | ✅ |

---

## 6. Cost Report / 成本报表

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 物业 + 日期范围 | 有 | 有 | ✅ |
| 分页 | 有，COST_PER_PAGE=10 | 有，10 条/页 | ✅ |
| 列表字段 | listingTitle/property, period, amount, description, bukkuurl | 同 | ✅ |
| 每行发票链接 | 有，bukkuurl | 有 | ✅ |
| Export Cost PDF | `exportCostPdf` | `exportCostPdf` | ✅ |

---

## 7. Client Approval / 待审批（Operator 邀请业主）

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 待审批列表 | 有，来自 `owner.approvalpending` + 待签协议（pending 且无 ownersign） | 仅有 `owner.approvalpending` | 数据源一致；Wix 多「待签协议」混在同一 repeater |
| 批准 | mergeOwnerMultiReference + removeApprovalPending | 同 | ✅ |
| 批准后 syncOwnerForClient | 有（best-effort，不阻塞） | **无** | ⚠️ Next 批准后未调 syncOwnerForClient |
| 拒绝 | removeApprovalPending | 同 | ✅ |
| 列表中「待签协议」入口 | 有，同一 repeater 内「Sign Agreement」打开签约弹窗 | 无；签约只在 Agreement 页 | 功能在 Next 有，入口分离到 Agreement 页 |

---

## 8. Support / 支持

| 功能 | Wix 旧版 | Next.js 迁移版 | 备注 |
|------|----------|----------------|------|
| 入口 | 主按钮 #buttonsupport | 侧栏「Contact Support」→ WhatsApp | ✅ 均有入口，Next 为外链 |

---

## 9. 仅 Next 有的能力

| 功能 | 说明 |
|------|------|
| Smart Door | `/owner/smart-door`：TTLock 远程开门、业主 PIN、设置/修改 PIN（getRoomsWithLocks, remote-unlock, passcode, passcode-save） |
| Dashboard | 汇总 KPI、收入图、物业入口 |
| 修改密码 | Profile 页 Change Password（依赖 portal 后端） |
| 邮箱变更验证 | Profile 页改邮箱需验证 |

---

## 10. API 覆盖（ownerportal.jsw → owner-api.ts）

| API | Wix JSW | Next.js owner-api | 备注 |
|-----|---------|-------------------|------|
| getOwner | ✅ | ✅ | |
| loadCmsData | ✅ | ✅ | |
| getClientsForOperator | ✅ | ✅ | 仅 My Properties 未用 |
| getBanks | ✅ | ✅ | |
| updateOwnerProfile | ✅ | ✅ | |
| getUploadCreds | ✅ | — | Next 用 uploadFile 走 proxy，不需前端 getUploadCreds |
| getOwnerPayoutList | ✅ | ✅ | |
| getCostList | ✅ | ✅ | |
| getAgreementList | ✅ | ✅ | |
| getAgreementTemplate | ✅ | ✅ | |
| getAgreement | ✅ | ✅ | |
| updateAgreementSign | ✅ | ✅ | |
| completeAgreementApproval | ✅ | ✅ | |
| mergeOwnerMultiReference | ✅ | ✅ | |
| removeApprovalPending | ✅ | ✅ | |
| syncOwnerForClient | ✅ | ✅ 已封装 | 未在 Profile 更新/Approval 批准后调用 |
| exportOwnerReportPdf | ✅ | ✅ | |
| exportCostPdf | ✅ | ✅ | |
| rooms-with-locks / remote-unlock / passcode / passcode-save | — | ✅ | Next 独有（Smart Door） |
| Agreement context (tenant/owner-tenant/owner-context) | 在 access/agreementdetail | 通过 portal proxy 调 agreement/* | ✅ |

---

## 11. 建议补全项（少功能/差异）

| 优先级 | 项目 | 说明 |
|--------|------|------|
| 高 | Profile 更新后调用 syncOwnerForClient | 与 Wix 一致，保证批准/资料更新后同步到客户账套 |
| 高 | Approval 批准后调用 syncOwnerForClient | 同上，best-effort 即可 |
| 中 | Agreement 的 context mode 传 tenant_operator | 若 agreement.mode === 'tenant_operator'，getAgreementContext 传 mode: 'tenant_operator'，避免用错模板变量 |
| 中 | My Properties 增加 Operator 下拉 | 使用 getClientsForOperator，按 operator 筛选（与 Wix 一致） |
| 低 | 租约 30 天内到期在 My Properties 高亮 | 与 Wix 一致体验 |
| 低 | 「非业主」提示 | 已登录但非 owner 时显示 You Are Not our Owner Yet 类文案 |
| 低 | 模板中 Wix 图片占位符 | 若有模板用 wix:image，需在 Next 做占位符替换或说明不支持 |

---

## 12. 总结

- **整体**：Next 已覆盖 Wix Owner Portal 绝大部分功能，并新增 Dashboard、Smart Door、改密、邮箱验证等。
- **明确少做/差异**：  
  - Profile / Approval 后未调 **syncOwnerForClient**；  
  - **Operator 下拉** 未在 My Properties 使用；  
  - Agreement 未传 **tenant_operator** mode；  
  - 租约即将到期**高亮**、**非业主**提示、模板**图片占位符**为可选补全。

按上表「建议补全项」逐项实现即可与 Wix 行为对齐并略优于旧版。
