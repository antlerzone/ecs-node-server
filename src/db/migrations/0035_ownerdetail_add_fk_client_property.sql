-- ownerdetail: add FK for client_id -> clientdetail(id), property_id -> propertydetail(id)
-- 可重复执行：先 DROP 再 ADD。若从未加过 FK，DROP 会报错可忽略，再执行 ADD 即可。
-- 执行前确保：client_id 的值都在 clientdetail.id 中存在（或为 NULL）；property_id 同理。

-- 1) 若已有同名约束则先删（没有则报错，忽略即可）
ALTER TABLE ownerdetail DROP FOREIGN KEY fk_ownerdetail_client;
ALTER TABLE ownerdetail DROP FOREIGN KEY fk_ownerdetail_property;

-- 2) 添加 FK（_id 指向主表 id，符合项目约定）
ALTER TABLE ownerdetail
  ADD CONSTRAINT fk_ownerdetail_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE ownerdetail
  ADD CONSTRAINT fk_ownerdetail_property
  FOREIGN KEY (property_id) REFERENCES propertydetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
