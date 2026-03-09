-- rentalcollection: add description column (separate from referenceid)
ALTER TABLE rentalcollection ADD COLUMN description text DEFAULT NULL AFTER referenceid;
