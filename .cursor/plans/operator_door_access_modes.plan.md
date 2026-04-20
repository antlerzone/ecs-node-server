---
name: Operator door access modes
overview: 在客户端房产编辑弹窗中新增「运营商开门权限」模式（下拉 + 密码/前提校验），并把原「Smart door (password)」区块移到该处；在运营商 Smart Door 列表为每把锁增加「开门 / 查看密码」能力，并按模式与「当天是否有 booking」控制可用性；在客户端 Smart Door（/client/smart-door，与运营商共用组件）为每把锁增加「查看开门日志」（需 gateway）。Staff 相关限制不在本次范围。
todos:
  - id: migration-mode
    content: Add cln_property.operator_door_access_mode migration + map in patch/detail
    status: pending
  - id: backend-validate
    content: patchClientPortalProperty validation (gateway for full/working); booking helper MY today
    status: pending
  - id: backend-list-enrich
    content: Enrich operator getSmartDoorList + optional password reveal endpoint
    status: pending
  - id: client-ui
    content: "properties/page.tsx: move password block, add dropdown + save wiring"
    status: pending
  - id: operator-ui
    content: "cleanlemon-smart-door-page: Open door + View password with disabled rules"
    status: pending
  - id: client-smart-door-view-log
    content: "Client /client/smart-door View log (gateway only) + date filter + portal API + enrich actor name"
    status: pending
isProject: false
---

# Operator door access (client property + operator smart door)

> Canonical edits may live in `~/.cursor/plans/operator_door_access_modes_97f1e883.plan.md`; this file is a repo copy.

See full sections: Product rules, Data model, Backend, Client properties UI, Operator smart door UI, **Client Smart Door — View unlock log**, Testing.

## Client Smart Door — View unlock log (`/client/smart-door`) (summary)

- **View log** on each lock when **`hasGateway`**.
- **Filter:** user can choose **date** or **from–to** (Malaysia calendar); server filters `created_at` with proper UTC bounds.
- Lists **`lockdetail_log`**: time, email, enriched **actor display name** (staff/operator vs client).
- New portal API with `getLock`-based access check; reuse pattern from admin `listAdminLockUnlockLogs`.
- Logs reflect **portal remote unlock** events recorded by backend, not pure offline BLE-only opens.
