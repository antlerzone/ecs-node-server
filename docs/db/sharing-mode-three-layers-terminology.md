# 「三层传达」术语对齐（Sharing mode）

## 团队需二选一明确（避免研发 / 运营理解不一致）

在未额外说明时，文档与产品讨论里 **「三层」** 可能指：

### A. 三角色 / 责任边界（推荐默认）

| 层 | 角色 | 职责 |
| --- | --- | --- |
| L1 | **Integrator（Coliving operator）** | 资产与 TTLock 集成所有者；定义把哪些锁 / gateway 纳入某共享范围 |
| L2 | **Platform / Project（Cleanlemons 域）** | 项目命名、生命周期、审计、对多 operator 的授权与撤销 |
| L3 | **Consumer operators（cleaning A / B 等）** | 在各自 portal 内看到被授权资源、执行业务（排班、开门等） |

后续 **kiosk QR、icare、ecommunity** 可复用同一套 **L1 / L2 / L3** 语义。

### B. 系统三层（技术栈）

| 层 | 含义 |
| --- | --- |
| UI | Portal（Next.js） |
| API | Node（Express） |
| 数据 / 外部 | MySQL、TTLock 等 |

## 对齐结论（供立项与评审引用）

- **默认文档写法**：若无特别声明，**「三层传达」= A（三角色）**；若某次评审讨论的是架构图，**在幻灯片 / README 中显式标注「本页三层 = UI/API/DB」**。
- **确认方式**：产品 / 架构负责人在内部 spec 或会议纪要中勾选一个字母，并写入 `sharing-project-v1-scope.md` 修订记录（如有）。
