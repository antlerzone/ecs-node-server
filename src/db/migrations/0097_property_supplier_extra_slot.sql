-- property_supplier_extra.slot: electric|water|wifi|management|extra — 用于 Edit utility 前四行与「Add」区分；expenses/bank transfer 可据此或 supplier_id 取值。
ALTER TABLE property_supplier_extra
  ADD COLUMN slot varchar(20) DEFAULT 'extra' COMMENT 'electric|water|wifi|management|extra';
