-- LockDetail: add gateway_wixid for CSV import (resolve to gateway_id from gatewaydetail)
ALTER TABLE lockdetail ADD COLUMN gateway_wixid varchar(255) DEFAULT NULL;
ALTER TABLE lockdetail ADD KEY idx_lockdetail_gateway_wixid (gateway_wixid);
