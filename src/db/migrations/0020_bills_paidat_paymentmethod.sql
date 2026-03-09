-- Bills: add paidat and paymentmethod for mark-paid flow.
ALTER TABLE bills ADD COLUMN paidat datetime DEFAULT NULL;
ALTER TABLE bills ADD COLUMN paymentmethod varchar(100) DEFAULT NULL;
