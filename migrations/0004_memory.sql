-- 階層メモリ（疑似長期記憶）への移行
-- digest_json を捨て、memory_json (long/older/recent 構造) に置き換え
ALTER TABLE clients DROP COLUMN digest_json;
ALTER TABLE clients ADD COLUMN memory_json TEXT NOT NULL DEFAULT '{"long":"","older":[],"recent":[]}';
