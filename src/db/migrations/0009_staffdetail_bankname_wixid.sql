-- StaffDetail: add bankname_wixid for CSV import (Bank Name -> bankdetail)
ALTER TABLE staffdetail ADD COLUMN bankname_wixid varchar(255) DEFAULT NULL;
ALTER TABLE staffdetail ADD KEY idx_staffdetail_bankname_wixid (bankname_wixid);
