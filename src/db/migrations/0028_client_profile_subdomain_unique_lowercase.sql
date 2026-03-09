-- client_profile.subdomain: 统一小写、全库唯一（不同 client 不可重复）
-- 应用层写入时须 LOWER(subdomain)；此处归一化已有数据并加唯一约束。
-- 若已有重复 subdomain，请先手工去重或置空后再执行。

UPDATE client_profile SET subdomain = LOWER(TRIM(subdomain)) WHERE subdomain IS NOT NULL AND TRIM(subdomain) != '';

ALTER TABLE client_profile ADD UNIQUE KEY idx_client_profile_subdomain_unique (subdomain);
