-- 续约时保留「原合约到期日」：extend agreement 的日期范围 = previous_end（合约到期）→ end（新到期），不是 begin。
-- 每次 extend 时由代码写入 previous_end = 延之前的 end。

ALTER TABLE tenancy ADD COLUMN previous_end date DEFAULT NULL COMMENT 'Contract end before last extend, used for extend agreement date range';
