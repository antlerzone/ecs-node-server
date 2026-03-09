# roomdetail meter_id / smartdoor_id 回填（ECS）

## 用途

- `roomdetail.meter_id` 当前没有 FK 到 `meterdetail`，或列为空：用 `meter_wixid` 匹配 `meterdetail.wix_id` 回填 `meter_id`。
- 同理用 `smartdoor_wixid` 匹配 `lockdetail.wix_id` 回填 `roomdetail.smartdoor_id`。
- 回填后 Room Setting 页的 **#dropdownmeter**、**#dropdownsmartdoor** 会从表里正确带出选项，且当前房间已绑定的 meter/smartdoor 会正确显示为选中值。

## 执行方式（二选一）

### 1) Node 脚本（推荐）

```bash
cd /home/ecs-user/app && node scripts/backfill-roomdetail-meter-smartdoor-fk.js
```

输出示例：

```
[meter] meterdetail wix_id -> id map size: 12
[meter] roomdetail.meter_id backfilled: 8
[smartdoor] lockdetail wix_id -> id map size: 5
[smartdoor] roomdetail.smartdoor_id backfilled: 3
Done.
```

### 2) SQL 迁移

```bash
mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < src/db/migrations/0051_roomdetail_backfill_meter_smartdoor_id.sql
```

## 若表上尚无 FK

若建表时未加或已删掉 FK，可手动执行：

```sql
ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_meter
  FOREIGN KEY (meter_id) REFERENCES meterdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE roomdetail ADD CONSTRAINT fk_roomdetail_smartdoor
  FOREIGN KEY (smartdoor_id) REFERENCES lockdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
```

（若已存在则跳过或先 `ALTER TABLE roomdetail DROP FOREIGN KEY fk_roomdetail_meter;` 再 ADD。）

## 若 dropdown 选项仍为空

选项来自 **meterdetail** / **lockdetail** 表（按当前 client_id 过滤）。若选项为空，请确认：

- `meterdetail`、`lockdetail` 中该 client 有数据；
- 两表的 `client_id` 已正确回填（例如跑过 0021_backfill_client_id_from_wixid.sql 或对应脚本）。
