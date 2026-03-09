-- ownerdetail: 用 client_wixid / property_wixid 回填 client_id / property_id（当前全是 NULL 导致 Owner Portal 无数据）
-- 若值带方括号 [uuid]，先去掉 [] 再与 clientdetail.wix_id / propertydetail.wix_id 匹配。
-- property_wixid 可能为多个逗号分隔的 UUID，只回填第一个对应的 property_id。

-- 1) client_id：client_wixid → clientdetail.wix_id
UPDATE ownerdetail t
INNER JOIN clientdetail c
  ON TRIM(COALESCE(c.wix_id, '')) = TRIM(REPLACE(REPLACE(TRIM(COALESCE(t.client_wixid, '')), '[', ''), ']', ''))
SET t.client_id = c.id
WHERE t.client_wixid IS NOT NULL AND TRIM(t.client_wixid) != '';

-- 2) property_id：property_wixid（取第一个 UUID）→ propertydetail.wix_id
UPDATE ownerdetail t
INNER JOIN propertydetail p
  ON TRIM(COALESCE(p.wix_id, '')) = TRIM(
      SUBSTRING_INDEX(
        TRIM(REPLACE(REPLACE(TRIM(COALESCE(t.property_wixid, '')), '[', ''), ']', '')),
        ',',
        1
      )
    )
SET t.property_id = p.id
WHERE t.property_wixid IS NOT NULL AND TRIM(t.property_wixid) != '';
