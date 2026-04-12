# `tenantdetail.profile`（租客头像 / Portal 扩展字段）

头像、`entity_type`、`reg_no_type`、`bank_refund_remark` 等存在 **`tenantdetail.profile`**（JSON 文本列）。

若库表是早期 `0001_init` 且**从未加过该列**，`UPDATE ... SET profile = ?` 会失败；旧代码**静默忽略**，表现为：**上传头像成功（OSS 有文件）但刷新后仍只有首字母**。

## 修复

```bash
cd /home/ecs-user/app
node scripts/run-migration.js src/db/migrations/0131_tenantdetail_profile.sql
```

然后 **`pm2 restart app`**。之后 `POST /api/tenantdashboard/update-profile` 会把 `avatar_url` 合并进 JSON 并持久化；`init` 会通过 `getTenantByEmail` 读回 `profile.avatar_url`。

若列仍缺失，接口会返回 `ok: false`, `reason: 'PROFILE_COLUMN_MISSING'`（不再静默失败）。
