-- Owner settlement: (1) management fee as percentage of rental income, or (2) operator pays owner a fixed monthly rent (rental / master-lease unit).

ALTER TABLE propertydetail
  ADD COLUMN owner_settlement_model ENUM('management_percent','fixed_rent_to_owner') NOT NULL DEFAULT 'management_percent'
    COMMENT 'management_percent vs fixed_rent_to_owner',
  ADD COLUMN fixed_rent_to_owner DECIMAL(18,2) DEFAULT NULL
    COMMENT 'Monthly amount operator pays owner when fixed_rent_to_owner model';
