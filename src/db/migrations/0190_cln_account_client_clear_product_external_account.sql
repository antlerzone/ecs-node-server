-- Service product rows only store external_product; income GL is on the Sales Income line.
UPDATE `cln_account_client` c
INNER JOIN `cln_account` a ON a.id = c.account_id AND a.is_product = 1
SET c.external_account = '';
