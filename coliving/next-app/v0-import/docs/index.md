# v0 设计导入区 — 文档索引

本目录是 **v0.app 设计代码的专用存放区**。你可以每次用新设计替换此区内容，前端（`app/`、`components/`）由 Cursor 根据这里的代码合并更新，不会直接引用本文件夹运行。

---

## 文档与用法

| 文档 | 说明 |
|------|------|
| **[../README.md](../README.md)** | v0-import 使用说明：放什么、怎么放、在 Cursor 里怎么说。 |
| **[../UPDATE-FROM-V0.md](../../UPDATE-FROM-V0.md)** | 完整流程：为何不能整盘覆盖 `app/`、非开发者 3 步、开发者增量更新方式。 |

---

## 流程速览

1. **你**：在 v0 改好设计 → 复制代码 → 粘贴/替换到 `v0-import/`（可按页面分子文件夹，如 `v0-import/tenant-profile/page.tsx`）。
2. **你在 Cursor 里说一句**：例如「v0-import 里 xxx 页面有新设计，请根据里面代码更新前端对应页面，只换 UI，保留后端对接」。
3. **Cursor（AI）**：根据 `v0-import` 里的代码，把差异合并进 `app/`、`components/` 中对应页面，只换 UI，保留 tenant-api、portal-api、contexts、保存/上传逻辑。

**不是自动合并**：没有脚本或 CI 监听 v0-import；每次要更新前端时，你在 Cursor 里说一句，AI 做一次合并。

真正跑的前端在 `coliving/next-app/app/` 与 `components/`，已接好 ECS Node 后端；本文件夹仅作「v0 设计来源」，供 Cursor 合并写入用。
