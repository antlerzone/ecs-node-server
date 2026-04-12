# 多产品 SaaS 大方向（Multi-Domain Blueprint）

本文档记录 **coliving / homestay / cleaning / handyman** 多产品与 **一体机终端 + ChatHero** 的**架构与产品大方向**，供团队评审与长期对齐。

- **仓库内归档**：随代码版本管理；更新时请同步修改本文件并提交 PR。
- **详细蓝图**：含 Sprint A–E、表结构草案、终端细则等，若在 Cursor 中维护，见本机计划文件 `multi-domain-saas-terminal_88ad8253.plan.md`（路径因环境而异，通常在 `~/.cursor/plans/`）。**若两处内容冲突，以本仓库 `docs` 与 git 历史为对外准绳**，并回写计划文件。

---

## 1. 已确认的大方向（摘要）

- **产品域**：`coliving`、`cleaning`、`homestay`、`handyman/renovation` 分域；**各产品线独立门户域名**（如 `portal.colivingjb.com` 等）。
- **共享底座**：MySQL + OSS + 既有 wrappers（会计、Stripe/Xendit、Finverse、TTLock、CNYIOT、Google auth 等）；homestay channel **库存锁 / 短 hold** 需要 **Redis 类**服务。
- **Homestay**：**OTA + channel manager**；PMS 为库存/房价主数据；多 OTA **独立连接器**（Agoda YCS 与 Agoda Homes **分开**）；webhook 优先，全量定时补拉非 v1 默认。
- **身份**：**邮箱**为全局身份；`global_user` + `product_account_link`；权限 **`(product, tenant, role)`**；关键操作 **邮箱 OTP**。
- **房产**：`property_core` + `source_type` / 来源租户；跨产品 **集成用连接表 + 审批**，不共享业务大表。
- **一体机**：物理卡 **UID** 来自卡/楼控；云端发 **凭证 / QR / 会话**；发卡计费与规则见蓝图细则。
- **All-in-one 层**：终端发卡 + **ChatHero（AI + n8n）**。

---

## 2. 现状 vs 蓝图

| 维度 | 现在（仓库与运行现状） | 未来（大方向） |
|------|------------------------|----------------|
| **产品** | 单一物业管理 SaaS，重心 coliving + Wix | 多产品域 + 各产品门户 |
| **前端** | Wix 为主 + 部分 Next Portal | Next 多门户为主 |
| **身份** | client 多租户、`api_user` | 全局邮箱 + 产品绑定 / 解绑 |
| **Homestay** | 非核心 | PMS + channel manager + Redis 锁 |
| **终端** | 门锁/表计业务向 | 平台化 access_pass + 终端机合约 |
| **基础设施** | 阿里云 ECS + MySQL + OSS；单 Node、cron 与 API 同进程 | 应用 ECS + **RDS** + **托管 Redis** + 可选 **worker**；水平扩展优先 |
| **CPU（vCPU）** | 已观测实例 **4 vCPU / 8 GiB**（吉隆坡），轻载时 CPU 极低；瓶颈常为连接池/cron/同机 DB，而非单看核数 | 分层：应用 **2→4 vCPU**、RDS **约 2 起**、worker **0–2**；**不必**为多产品默认单机 8 核 |

更细的对比表与「现在够不够、未来怎样更好」见下节及文末引用。

---

## 3. CPU / 云端规格（与当前实例对照）

**当前基线（控制台）**：**4 vCPU / 8 GiB**，单实例；轻载时 **CPU 利用率可 &lt;1%** — **算力层面当前足够**，卡顿更多来自 **架构与连接/定时任务**，而非先加核。

**未来「更好」优先**：

1. **RDS（或独立 MySQL）** — 与应用分离扩容与故障域。  
2. **托管 Redis** — homestay 锁与 hold。  
3. **可选 worker** — 重 cron / 渠道同步与 API 分离。  
4. **应用水平扩展** — 多实例 + SLB，优于单机猛加核。

---

## 4. 与当前代码库的关系

- 实现仍遵循：**Node + MySQL**，FK 一律 `_id`；见 [.cursor/rules/migration-wix-node.mdc](../../.cursor/rules/migration-wix-node.mdc)、[mysql-fk-use-id-only.mdc](../../.cursor/rules/mysql-fk-use-id-only.mdc)。  
- 新能力建议落在 `src/modules/*` 与平台级 **identity / integration / access-pass** 等模块；详见蓝图 Sprint 划分。

---

## 5. 未决与讨论清单（摘录）

- 各产品 **订阅价**、**Basic/Pro/Enterprise** 功能矩阵。  
- Homestay **第一波 OTA 优先级**。  
- Handyman **v1 深度** vs 清洁 / homestay 节奏。  
- ChatHero / n8n **数据边界**与租户开通策略。  

完整 backlog 以 Cursor 计划或团队 wiki 为准。

---

## 6. 相关仓库文档

| 文档 | 说明 |
|------|------|
| [docs/index.md](../index.md) | 总索引 |
| [docs/readme/ecs-capacity-2376-rooms.md](../readme/ecs-capacity-2376-rooms.md) | 当前 ECS 与 cron/连接池风险 |
| [README.md](../../README.md) | 后端栈与集成概览 |

---

*最后更新：与 multi-domain SaaS 蓝图规划同步；增量请改本文件并提交 git。*
