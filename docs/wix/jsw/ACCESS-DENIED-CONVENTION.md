# 门禁拒绝统一约定（所有门禁页面）

Wix 设为 Member Only 时登入者必有 email。以下为所有使用 `getAccessContext()` 的页面在「拒绝」时的统一行为与文案。

## 1. 拒绝时的表现（所有页面一致）

- **留在 sectiondefault**：只展示默认区块（或等同的「未通过」状态）。
- **所有主按钮 disable**：不进入任何业务操作。
- **文案（label / text）** 按原因二选一：
  - **`You don't have account yet`**：登入者没有 email、email 不在 staffdetail、无 client、staff/client 未激活等（即「没有账号」类）。
  - **`You don't have permission`**：门禁返回 `NO_PERMISSION`，或该页的 **permission 限制** 不通过（即「无权限」类）。

## 2. 文案规则

```js
// 门禁返回 !accessCtx.ok 时
const message = (accessCtx.reason === 'NO_PERMISSION')
  ? "You don't have permission"
  : "You don't have account yet";
showAccessDenied(message);
return;
```

- **NO_PERMISSION** → `"You don't have permission"`
- **其余**（NO_EMAIL、NO_STAFF、NO_CLIENT、STAFF_INACTIVE、CLIENT_NOT_FOUND、CLIENT_INACTIVE、BACKEND_ERROR 等）→ `"You don't have account yet"`

## 3. 各页 showAccessDenied 必须做的事

- 展开 / 停留在 **#sectiondefault**（或该页等效的默认区块）。
- 将用于提示的 **Text 元件**（如 #textstatusloading、#text19）设为上述 `message` 并 show。
- **Disable 该页所有主按钮**（如 #buttonprofile、#buttontopup、#buttonroom 等），避免进行任何业务操作。

## 4. Permission 与页面/按钮对应（admin = 全部可进）

| Permission | 作用 |
|------------|------|
| admin | 全部页面可进、全部按钮 enable |
| usersetting | Company Setting 内 #buttonusersetting enable（否则 disable） |
| integration | #buttonintegration enable；Account 页面可进 |
| billing | #buttontopup、#buttonpricingplan enable；Account 页面可进 |
| profilesetting | #buttonprofile enable |
| booking | Booking 页面可进（#sectiondefault、#sectiontab、#buttonbooking） |
| marketing | 暂不影响 |
| propertylisting | Property / Smart Door / Meter / Room / Owner / Agreement Setting 页面可进 |
| tenantdetail | Contact Setting 页面可进 |
| finance | Expenses、Generate Report 页面可进 |

Account 页面：integration \|\| billing \|\| admin（无单独 "account" permission 名）。

## 5. 有 permission 限制的页面（不通过时 section default + "You don't have permission"）

| 页面 | 所需 permission | 不通过时文案 |
|------|-----------------|--------------|
| Room / Property / Smart Door / Meter Setting | propertylisting \|\| admin | You don't have permission |
| Tenancy Setting | tenantdetail \|\| admin | You don't have permission |
| Contact Setting | tenantdetail \|\| admin | You don't have permission |
| Owner Setting / Agreement Setting | propertylisting \|\| admin | You don't have permission |
| Expenses / Generate Report | finance \|\| admin | You don't have permission |
| Account Setting | integration \|\| billing \|\| admin | You don't have permission |
| Booking | booking \|\| admin | You don't have permission |
| Company Setting | 有任意 permission 即可进页；各按钮按 UI_PERMISSION_MAP 控制 | - |
| Billing | staff.permission.billing（后端） | You don't have permission |

以上页面在「门禁通过但该页 permission 不通过」时：留在 sectiondefault、按钮 disable、文案 **You don't have permission**。

## 6. #sectiontab 约定（入口栏，所有页面统一）

- **#sectiontab** 是页面入口：内放切换到各 section 的按钮（如 #buttonroom、#buttonexpenses、#buttoninvoice 等），**始终 expand & show**，不论当前在哪个 section 都不 collapse。
- **以下情况须 disable sectiontab 内全部按钮**：
  1. **无 credit** 且当前展示 sectiontopup（强制 topup）时 → sectiontab 内按钮全部 disable，只能通过 topup 流程恢复。
  2. **无 permission**（门禁 NO_PERMISSION 或该页 permission 不通过）→ showAccessDenied 时已 disable 主按钮，包含 sectiontab 内按钮。
  3. **Client 无 permission**（同上，按门禁/该页权限判断）→ 同上。
- 各页 sectiontab 内按钮示例：
  - **Expenses**：#buttonexpenses、#buttontopup
  - **Admin Dashboard**：#buttonadmin、#buttonagreementlist、#buttonprofile
  - **Tenant Invoice**：#buttonmeterinvoices、#buttoninvoice（及 #buttontopup 若在 tab 内）
