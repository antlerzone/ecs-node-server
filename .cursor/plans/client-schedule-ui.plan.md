---
name: ""
overview: ""
todos: []
isProject: false
---

# Client Portal：Schedule 预约改版 + 手机底栏与侧栏

## A. Client 手机导航（本次新增）

### 目标

- **仅手机**（`md:hidden` 的 `[MobileNav](cleanlemon/next-app/components/layout/mobile-nav.tsx)`）：底部 **固定 5 个** quick actions，其余入口放进 **左侧滑入菜单**。
- **桌面**：`[AppSidebar](cleanlemon/next-app/components/layout/app-sidebar.tsx)` 可保持 **完整列表**（与现有一致），避免桌面用户多点一层。

### 底部 5 项（顺序）


| Label     | 路由（相对 `/client`） | 图标建议                                  |
| --------- | ---------------- | ------------------------------------- |
| Dashboard | `''`             | Home                                  |
| Booking   | `/schedule`      | Calendar（文案由 Schedule 改为 **Booking**） |
| Invoice   | `/invoices`      | FileText                              |
| Damage    | `/damage`        | AlertTriangle                         |
| Profile   | `/profile`       | User                                  |


### 左侧滑入菜单中的项

其余原在底栏的入口统一迁入侧栏（链接不变）：

- Agreement → `/agreement`
- Approval → `/approval`
- Properties → `/properties`
- Integration → `/integration`
- Smart Door → `/smart-door`

（若后续产品删减路由，以 `[client/layout.tsx](cleanlemon/next-app/app/portal/client/layout.tsx)` 中 `navItems` 为准。）

### 实现要点

- 在 `[cleanlemon/next-app/app/portal/client/layout.tsx](cleanlemon/next-app/app/portal/client/layout.tsx)` 将 `navItems` **拆成** `mobileBottomNavItems`（5）与 `mobileDrawerNavItems`（其余），**仅**把前者传给 `MobileNav`。
- 新增 **Client 专用** 组件（例如 `client-mobile-menu.tsx` 或扩展现有 layout）：
  - 使用已有 `[Sheet](cleanlemon/next-app/components/ui/sheet.tsx)` `**side="left"`** + 全高/合适宽度，内含可滚动链接列表（与 sidebar 项同结构：`href` + icon + label）。
  - 在 **手机顶栏** 或 **底栏左侧** 放 **菜单按钮**（`Menu` / `PanelLeft`）打开 Sheet；需保证不与现有 gate/redirect 冲突。
- `[MobileNav](cleanlemon/next-app/components/layout/mobile-nav.tsx)`：可保持通用，仅 **传入 5 项**；若 5 项在窄屏仍挤，可适当减小 `min-w` / `px` 或仅显示 icon（可选，以不破坏可读为准）。
- **活跃态**：Booking 对应 `/client/schedule` 及其子路径时高亮（若存在子路由，可把 `isActive` 改为 `pathname === full || pathname.startsWith(full + '/')` 仅对需要者开启）。

---

## B. Schedule 页：Tab、筛选与 Bottom Sheet 预约（原计划摘要）

- 文件：`[cleanlemon/next-app/app/portal/client/schedule/page.tsx](cleanlemon/next-app/app/portal/client/schedule/page.tsx)`。
- **Tabs**：Upcoming | Past；Past 支持 **From–To** 日期筛选（客户端过滤 `item.date`）。
- **预约**：`Dialog` 改为 `**Sheet` `side="bottom"`**；步骤 0 **Single / Bulk**；单位方格；服务/加购/日期时间/摘要；Bulk 按单位多次 `createClientScheduleJob` + 抽 async 计价函数避免双轨漂移。
- **成功页**：勾勾 + 摘要，**无 QR**。
- 构建：`npm run build:cleanlemons-portal`；部署按仓库规则重启 Next。

---

## 实施顺序建议

1. **A 导航**（独立可测）：底栏 5 项 + 左侧 Sheet，桌面 sidebar 不变。
2. **B Schedule** 页改版（可依赖 A 完成后在真机上看 Booking 入口）。

---

## Todos

- client layout：拆分 nav、左侧 Sheet、顶栏/触发器
- mobile-nav：仅 5 项 + Booking 文案与 active 规则
- schedule 页：Tabs、Past 筛选、Sheet 预约、Bulk 计价与提交、成功页
- `npm run build:cleanlemons-portal`

