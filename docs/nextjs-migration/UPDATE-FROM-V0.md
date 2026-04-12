# 用 v0.app 设计更新 Next 前端的正确方式

---

## 先搞清楚：server 和 nextjs-migration 的关系

- **这个仓库（server）里**确实有 `docs/nextjs-migration` 这个文件夹，里面就是 Next 前端。
- **Node 的 server.js** 只提供 **API**（例如 `/api/tenantdashboard/*`），**不提供** Next 的页面；Next 是单独跑的（例如 `next start -p 3001`），ECS 上可能是 Nginx 把「前端域名」转到 Next，把「API 域名」转到 Node。
- **nextjs-migration 里的前端已经接好了 ECS 后端**：有 `lib/tenant-api.ts`、`lib/portal-api.ts`、各页面的保存/上传/登录等逻辑，都是对着你们 Node API 的。

所以：**不能每次整盘覆盖 nextjs-migration 或里面的 `app/`**。一覆盖，这些对接就都没了。你可以**每次用 v0 更新 UI**，但要按下面「非开发者流程」做，只换界面、保留后端对接。

---

## 推荐：用「v0-import 文件夹」——你只管替换，前端由 Cursor 从这边合并

我们有一个**固定文件夹**专门放 v0 的设计，你可以**每次整盘替换这个文件夹里的内容**；真正跑的前端（`app/`、`components/`）不会直接引用这里，而是由 Cursor（或开发者）**查看这个文件夹里的代码，把差异写进前端**。

- **你可以随便覆盖的地方**：`docs/nextjs-migration/v0-import/` 里的文件或子文件夹。
- **前端代码所在**：`app/`、`components/`（已接好后端，不要直接覆盖）。
- **流程**：v0 新设计 → 粘贴/替换到 `v0-import/` → 在 Cursor 里说「根据 v0-import 里的 xxx 更新前端对应页面，保留后端对接」。

详细说明见 **[v0-import/README.md](v0-import/README.md)**。

---

## 我不是开发者，也不知道 v0 改了什么（用这个流程）

你不需要自己判断 v0 改了什么，只要按下面做，把「接好的事」交给 Cursor 或开发者即可。

### 你要做的 3 步

1. **在 v0 里改好设计后，把 v0 生成的代码全部复制下来。**
2. **把代码放进 `v0-import/` 文件夹**（可以按页面分子文件夹，例如 `v0-import/tenant-profile/page.tsx`）  
   **每次有新设计就替换这个文件夹里对应的文件即可——只有这里可以整盘替换。**
3. **在 Cursor 里对 AI 说下面这句（可复制）：**

   > `v0-import` 文件夹里有新的 v0 设计（是 **租户个人资料** 页面），请根据里面的代码更新前端的对应页面（`app/tenant/profile/page.tsx`），只换 UI，保留现有的后端对接（tenant-api、updateProfile、uploadFile、useTenantOptional 等）。

   **如果是别的页面**，把「租户个人资料」和路径换成对应的，例如：
   - 租户缴费 → `app/tenant/payment/page.tsx`
   - 租户仪表盘 → `app/tenant/page.tsx`
   - 登录页 → `app/login/page.tsx`

### 记住

- **可以整盘替换的**：只有 `v0-import/` 里的内容。
- **不要直接覆盖** `app/`、`components/`；由 Cursor 根据 v0-import 的代码**合并进**前端，这样后端对接不会丢。

---

## 给开发者：为什么不能直接覆盖 app/

**不要直接覆盖整个 `app/` 目录。** 当前项目里 `app/` 已经接好了：
- `lib/tenant-api`、`lib/portal-api` 等对 ECS Node 后端的调用
- `contexts/` 里的租户/登录状态
- 各页的 `useEffect`、表单提交、上传等业务逻辑

整盘覆盖会把这些对接全部清掉，需要重新接一遍。

---

## 推荐方式：按页面/组件增量更新

### 方式一：只换「某一页」的 UI（最常用）

1. 在 v0 里改好设计，复制生成的 **组件代码**（不是整站）。
2. 在 Cursor 里：
   - **新建**一个组件文件，例如：`components/tenant/profile-page-ui.tsx`，把 v0 的代码贴进去。
   - 缺的 UI 组件（Button、Input、Card 等）从 `@/components/ui/...` 引入；若 v0 用了你项目里没有的，就放到 `components/ui/` 下或改成现有组件。
3. 打开对应的 **页面文件**，例如 `app/tenant/profile/page.tsx`：
   - **保留**：`useTenantOptional()`、`updateProfile`、`uploadFile`、`fetchBanks`、所有 `useState` / `useEffect` 和 `handleSaveChanges` 等与后端相关的逻辑。
   - **只替换**：`return (...)` 里的 JSX——改成用新组件，把原来的 state 和 handler 通过 **props** 传进去。

这样你只换了界面结构，数据流和接口调用都不变。

### 方式二：v0 产出的是整页

1. 把 v0 的整页代码存成 **一个组件**，例如 `components/tenant/profile-page-v2.tsx`。
2. 在该组件里定义 **props 接口**，把需要从「外面」拿的数据和回调都写成 props，例如：
   - `tenant`, `tenancies`, `onSave`, `onUploadFile`, `bankOptions` 等。
3. 在 `app/tenant/profile/page.tsx` 里：
   - 仍然保留所有从 `lib/tenant-api`、`contexts` 取数和调接口的逻辑。
   - `return` 里只渲染：`<ProfilePageV2 tenant={...} onSave={handleSaveChanges} ... />`。

这样 v0 负责 UI，Cursor 里的 page 只负责数据和后端，职责清晰，也方便以后再次用 v0 换版。

### 方式三：只更新某个小组件（如卡片、表单块）

1. v0 生成的若是 **小组件**（例如一张卡片、一个表单块），放到 `components/` 下合适位置，例如 `components/tenant/profile-form.tsx`。
2. 在现有页面里找到对应位置，**只替换**那一块的 JSX，把原来的 state/handler 通过 props 传给新组件。

---

## 不要做的事

- **不要** 用 v0 的整站导出直接覆盖 `app/`。
- **不要** 删掉或覆盖 `app/layout.tsx`、`app/tenant/layout.tsx` 等，里面可能有 Provider、字体、元数据。
- **不要** 在未检查的情况下覆盖已有 `app/**/page.tsx`，否则会丢掉对 `tenant-api`、`portal-api`、context 的调用。

---

## 小结

| 目标           | 做法 |
|----------------|------|
| 只改某一页的样式/布局 | 新组件 + 在对应 `page.tsx` 里只换 `return` 的 JSX，逻辑保留 |
| v0 给了一整页     | 整页做成带 props 的组件，page 只负责数据与接口，渲染该组件 |
| 只改一个小块 UI   | 新小组件 + 在页面里局部替换并传 props |

这样可以在 Cursor 里持续用 v0 迭代 UI，而 ECS Node 后端和现有 API 对接不会被破坏。
