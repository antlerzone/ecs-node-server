-- Admin Dashboard: refunddeposit 表增加 done、room_id/tenant_id/client_id（关联与标记完成）
ALTER TABLE refunddeposit ADD COLUMN done tinyint(1) NOT NULL DEFAULT 0;
ALTER TABLE refunddeposit ADD COLUMN room_id varchar(36) DEFAULT NULL;
ALTER TABLE refunddeposit ADD COLUMN tenant_id varchar(36) DEFAULT NULL;
ALTER TABLE refunddeposit ADD COLUMN client_id varchar(36) DEFAULT NULL;
ALTER TABLE refunddeposit ADD KEY idx_refunddeposit_client_id (client_id);
ALTER TABLE refunddeposit ADD CONSTRAINT fk_refunddeposit_client
  FOREIGN KEY (client_id) REFERENCES clientdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE refunddeposit ADD CONSTRAINT fk_refunddeposit_room
  FOREIGN KEY (room_id) REFERENCES roomdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE refunddeposit ADD CONSTRAINT fk_refunddeposit_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenantdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
