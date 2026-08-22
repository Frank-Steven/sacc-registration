-- 0004_registration_data_field_index.sql — M4 导出统计
-- 字段分布统计按 field_id 过滤（registration_data 原仅 (registration_id) 索引，export.md 决策 7）

CREATE INDEX IF NOT EXISTS idx_registration_data_field ON registration_data (field_id);
