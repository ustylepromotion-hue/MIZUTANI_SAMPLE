-- digest_md（MD形式）を廃止し、digest_json（JSON配列）に切替
ALTER TABLE clients DROP COLUMN digest_md;
ALTER TABLE clients ADD COLUMN digest_json TEXT NOT NULL DEFAULT '[]';
