# Portal SEO Keywords (portal.colivingjb.com)

**主打：房间管理 SaaS (Room Management SaaS) · 全自动化 · 市场：Malaysia & Singapore**

## 当前使用的关键词（`app/layout.tsx` + `lib/seo.ts`）

| 类型 | 关键词 | 说明 |
|------|--------|------|
| **核心 / 主打** | room management SaaS, fully automated room management, automated rental management, room management software Malaysia/Singapore, coliving management, rental room management | 房间管理 SaaS + 全自动化 + 马新 |
| **角色** | tenant portal, owner portal, operator dashboard | 三端入口 |
| **功能** | property management software, smart lock, metered billing, rental management platform | 产品能力 |
| **地域** | Malaysia coliving, Singapore coliving, Johor Bahru | 主打马来西亚与新加坡 |

## 描述文案（DEFAULT_DESCRIPTION）

- 英文：*Fully automated room management SaaS for Malaysia & Singapore. Coliving and rental operators—tenant portal, owner portal, smart locks, metered billing. One platform for rooms, tenancies, and payments.*

## 可考虑的扩展词（按需加入）

- **co-living**, **shared living** — 与 coliving 同义/近义
- **student accommodation**, **serviced apartment** — 若目标包含学生宿舍、服务式公寓
- **rental management software Malaysia** — 地域+类型长尾
- **tenant management**, **landlord portal** — 租客管理、房东门户

修改关键词请同步更新 `app/layout.tsx` 的 `metadata.keywords` 与 `lib/seo.ts` 的 `DEFAULT_DESCRIPTION`。

---

## 已启用的 SEO 技术项

| 项 | 文件/位置 | 说明 |
|----|-----------|------|
| **Sitemap** | `app/sitemap.ts` | 公开页自动生成 `/sitemap.xml`，便于 Google 抓取与收录 |
| **Robots** | `app/robots.ts` | 生成 `robots.txt`：允许首页与公开页，禁止 `/auth/`、`/operator/`、`/owner/`、`/tenant/`、`/saas-admin/`，并声明 sitemap 地址 |
| **JSON-LD** | `components/seo-json-ld.tsx` + 根 layout | Organization + WebSite 结构化数据，利于富摘要与品牌展示；WebSite 含 SearchAction 指向 `/available-unit?keyword=` |
| **Meta** | `app/layout.tsx` + 各页 layout | title 模板、description、keywords、openGraph、twitter、canonical、icons、robots |
| **Canonical** | 各页 layout 的 `alternates.canonical` | 每页指定规范 URL，避免重复收录 |
