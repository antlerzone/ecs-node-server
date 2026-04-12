# Project（资源共享）v1 范围冻结

> 与 `lockdetail` / `gatewaydetail` **行级三列归属**（`client_id` / `cln_clientid` / `cln_operatorid`）及 **Cln–Coliving 物业链**（`cln_property.coliving_propertydetail_id`）并列：**Project** 表达的是 **多 cleaning operator 共享同一套门侧能力** 的一等概念，见 `sharing-project-schema-when-ready.sql`（立项后执行）。

## v1 资源范围（冻结）

- **必选**：`lockdetail.id`（锁）、`gatewaydetail.id`（网关）。
- **可选上下文**：`propertydetail.id`（Coliving 物业）仅作 **分组 / 展示上下文**，**不**单独作为「共享一条资源行」的替代；物业级可见性仍以现有 `cln_property` 与集成链为准。

## L3 默认权限（冻结）

- **默认**：**使用 / 调度** — 远程开门（经 Node）、查看在线与电量、排班相关读访问；**不**默认包含 TTLock 账号所有权转移或删除设备。
- **非默认（需产品单独开启 / 未来版本）**：**管理** — 改别名、删除锁 / 网关、改 TTLock 侧配置等。

## 与 `cln_property_link_request` 的关系

- **物业审批链**（client ↔ operator 单物业）：现有 `cln_property_link_request`。
- **Project**：在同一集成前提下，**Coliving 将哪些设备能力下放给哪些 cleaning operator** — **不同维度**，不互相替代。

## 修订记录

| 日期 | 说明 |
| --- | --- |
| 2026-04-04 | 初稿：v1 资源 + L3 默认权限冻结 |
