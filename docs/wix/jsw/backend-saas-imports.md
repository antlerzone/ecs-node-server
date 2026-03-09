# backend/saas 引用说明（Wix 前端 → JSW）

前端页面（如 Company Setting）通过以下方式引用后端模块：

```js
import { getMyBillingInfo, getCreditPlans, startNormalTopup } from 'backend/saas/topup';
import { submitTicket } from 'backend/saas/help';
```

## 文件位置

在 Wix 后台 **Backend** 下，需存在与 `companysetting.jsw` **同级** 的：

- **backend/saas/topup.jsw** — 提供 `getMyBillingInfo`、`getCreditPlans`、`startNormalTopup`
- **backend/saas/help.jsw** — 提供 `submitTicket`、`getUploadCreds`、`getFaqPage` 等

即目录结构为：

```
backend/
  saas/
    companysetting.jsw
    topup.jsw      ← 必须有，否则会报 Cannot find module 'backend/saas/topup'
    help.jsw
    ...
```

## 若 IDE 报红但运行正常

部分编辑器（含 Wix Code / 本地 VS Code）无法解析 `backend/` 路径，会显示 “Cannot find module 'backend/saas/topup'”。  
只要 **运行时** 在 Wix 中页面能正常加载、Topup/Help 功能正常，可视为 IDE 的解析问题，不影响发布。

若希望本地 IDE 不报错，可在项目根目录添加 **jsconfig.json**，例如：

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "backend/*": ["backend/*"]
    }
  },
  "include": ["**/*.jsw", "**/*.js"]
}
```

并确保 `backend/saas/topup.jsw` 与 `backend/saas/help.jsw` 实际存在。

## 参考实现

- Topup 实现见：`docs/wix/jsw/velo-backend-saas-topup.jsw.snippet.js`
- Help 实现见：`docs/wix/jsw/velo-backend-saas-help.jsw.snippet.js`

若站点里没有 `topup.jsw`，可新建文件并把 snippet 内容复制到 **backend/saas/topup.jsw**。
