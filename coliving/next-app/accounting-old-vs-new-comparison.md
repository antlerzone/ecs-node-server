# Account Setting（会计账户设置）页面：旧代码 vs 新代码功能对比表

| 功能 | 旧代码 (Wix account-setting + account.jsw) | 新代码 (Next operator/accounting) | 备注 |
|------|---------------------------------------------|-----------------------------------|------|
| **页面结构 / Tab** | #sectiontab：Topup (#buttontopup)、Account (#buttonaccount)；Section：topup / account / accountdetail | 单页 **Accounting**，无 Tab；无 Topup 区块 | 新：Topup 在 Credit 页，本页只做账户映射 |
| **Topup（充值）** | ✅ 本页有独立 Section：getMyBillingInfo、getCreditPlans、repeater 选方案、#buttoncheckout → startNormalTopup；>1000 显示 problem box | ❌ 无 | 产品约定：充值统一在 Credit 页 |
| **进入前权限 / 能力** | getAccessContext → 无 capability.accounting 则 disableAccountSection('Your plan does not include Accounting') | 依赖 operator 路由/权限；未在此页单独判断 capability.accounting | 新：通常由 layout/API 控制 |
| **Resolve 会计系统** | resolveAccountSystem(clientId) → 无 ok 则「Please setup accounting integration first」；无 provider 则「Please setup account integration first」；写入 accessCtx.accountSystem / accountIntegration | ❌ 本页未调用 resolve | 新：若未集成，getAccountList 可能空或 API 报错；可按需在 layout 或本页加 resolve |
| **Credit 不足强转 Topup** | accessCtx.credit?.ok === false → enterForcedTopupModeManage，只展开 topup section | ❌ 无 | 新：Credit 状态在 Credit 页处理 |
| **账户列表数据** | getAccountList() → items 带 _myAccount、_protected(PROTECTED_BUKKUID_IDS) | getAccountList() → items 带 _myAccount | 一致；新未用 _protected |
| **列表展示** | #repeateraccount：Title (#textaccounttitle)、Type (#textaccounttype)、Account ID (#textaccountid，有则显示 ID 否则 "Not set" 红色)、Edit (#buttonedit) | 卡片列表：title、type(Badge)、Mapped: accountid / "Not set"(amber)、Edit 按钮 | 等价 |
| **搜索** | #inputaccountsearch，onInput 防抖 300ms → applyAccountFilter（按 title/type 关键词） | 搜索框，实时 filter（title/type 包含 search） | 一致 |
| **筛选下拉** | #dropdownfilteraccount：All、A→Z、Z→A、Asset、Liability、Income、Expenses、**Product** | Select：All、A to Z、Z to A、Asset、Liability、Income、Expenses | 新：**少「Product」类型筛选**，可补 |
| **排序** | 同上：az/za 按 title 排序；类型筛选用 filterVal 过滤 type | az/za 按 title 排序；类型筛选用 filterType 过滤 | 一致 |
| **分页** | ACCOUNT_PAGE_SIZE=10，#paginationaccount，renderAccountPage | ❌ 无分页，一次展示全部 filtered 列表 | 新：若账户模板很多可加分页 |
| **打开详情** | #buttonedit → getAccountById(id) 取最新 → openAccountDetailSection（accountdetail section） | Edit → openDetail(account)，用列表项数据，不请求 getAccountById | 新：少一次 get 请求，数据来自列表 |
| **详情表单** | #inputname（只读/受保护时 disable）、#inputaccounttype（只读）、#inputaccountid、#inputproductid（仅当 item 有 type 时显示） | Dialog：Account Name 只读、Account Type 只读、Bukku Account ID、Product ID (Optional) | 新：Product ID 始终显示为可选；旧按 type 显隐 |
| **受保护账户** | PROTECTED_BUKKUID_IDS 内 id → _protected，详情里 #inputname.disable() | ❌ 无保护列表，名称可改 | 新：**未做受保护账户只读**，若需可补 |
| **保存映射** | saveBukkuAccount({ item, clientId, system, accountId, productId }) → 成功后折叠 accountdetail、回 account、initAccountList | saveAccount({ item: { _id }, clientId, accountId, productId }) → 关 Dialog、loadAccounts() | 一致（新未传 system，后端可由 client 推断） |
| **Sync Account** | #buttonsyncaccount → syncBukkuAccounts({ clientId })；autocount/sql 提示 "Sync not available"；成功显示 createdAccounts/linkedAccounts/createdProducts/linkedProducts，2 秒后 hideSectionLoading | Sync Accounts 按钮 → syncAccounts() → loadAccounts()；无结果条数展示 | 新：**未展示 Sync 结果条数**（created/linked），可加 toast 或文案 |
| **Sync 不可用** | provider 为 autocount/sql 时 showSectionLoading('Sync not available...') | 未在前端区分；依赖 API 返回错误 | 可补：根据 API reason 提示 |
| **空列表提示** | "No account templates. Run Sync Account to create from Bukku, or import bukkuid.csv..." | "No accounts found" | 新可沿用旧文案更明确 |

---

## 总结：新代码少了什么 / 不一样的地方

| 项目 | 说明 |
|------|------|
| **Topup** | 刻意不做：充值统一在 Credit 页，与 Report 页一致。 |
| **Resolve / 能力校验** | 旧：进入 Account 前 resolveAccountSystem + capability.accounting，无则禁用区块并提示。新：本页未调 resolve，若需与旧一致可在 layout 或本页加载时调 resolve/能力判断并提示。 |
| **Credit 强转 Topup** | 旧：credit?.ok === false 时只显示 topup。新：在 Credit 页处理，本页不重复。 |
| **筛选「Product」** | 旧：下拉有 Product 类型；新：无。可补一条 `{ value: "product", label: "Product" }`。 |
| **分页** | 旧：10 条/页；新：无分页。账户模板通常不多，可接受；多了可加分页。 |
| **受保护账户** | 旧：PROTECTED_BUKKUID_IDS 对应行名称只读。新：未实现，若需可加 _protected 或 id 白名单只读。 |
| **Sync 结果反馈** | 旧：成功后显示 createdAccounts/linkedAccounts/createdProducts/linkedProducts。新：仅刷新列表，可加 toast/文案显示条数。 |
| **getAccountById** | 旧：Edit 时先 getAccountById 再开详情。新：直接用列表项，少一次请求，功能等价。 |

---

## 结论：有没有少功能？

**核心能力没有少：**

- 账户模板列表（title、type、映射 accountid、Not set 提示）✅  
- 搜索 + 筛选（All、A→Z、Z→A、按类型）✅（仅少 Product 筛选，易补）  
- 编辑映射（Account ID、Product ID）✅  
- 保存映射（saveAccount → Node account/save）✅  
- Sync Account（syncAccounts → Node account/sync，再刷新列表）✅  

**差异都是产品/UX 选择或小增强：**

- Topup / Credit 强转：放在 Credit 页，不在本页。  
- Resolve/能力：可在此页或 layout 补一次校验与提示。  
- Product 筛选、受保护账户只读、Sync 结果条数、分页：可按需补齐。  

**后端一致：** 新旧都调同一套 Node `/api/account/*`（resolve、list、get、save、sync），**没有少功能**。
