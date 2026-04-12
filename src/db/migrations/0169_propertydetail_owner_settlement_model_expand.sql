ALTER TABLE propertydetail
  MODIFY COLUMN owner_settlement_model ENUM(
    'management_percent_gross',
    'management_percent_net',
    'management_fees_fixed',
    'rental_unit',
    'guarantee_return_fixed_plus_share',
    'management_percent',
    'fixed_rent_to_owner'
  ) NOT NULL DEFAULT 'management_percent_gross';
