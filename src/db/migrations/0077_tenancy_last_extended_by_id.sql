-- Record which staff last extended the tenancy (admin repeatertenancy: show if submitby_id or last_extended_by_id = current staff)
ALTER TABLE tenancy ADD COLUMN last_extended_by_id varchar(36) DEFAULT NULL AFTER submitby_wixid;
ALTER TABLE tenancy ADD KEY idx_tenancy_last_extended_by_id (last_extended_by_id);
ALTER TABLE tenancy ADD CONSTRAINT fk_tenancy_last_extended_by
  FOREIGN KEY (last_extended_by_id) REFERENCES staffdetail (id) ON UPDATE CASCADE ON DELETE SET NULL;
