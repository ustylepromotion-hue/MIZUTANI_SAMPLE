-- 既存clientsテーブルを作り直してpublic_idを追加、nameのUNIQUE制約を外す
PRAGMA foreign_keys = OFF;

CREATE TABLE clients_new (
  client_id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 既存データを移行（public_idは暫定的にclient_idベースで生成）
INSERT INTO clients_new (client_id, public_id, name, created_at)
SELECT client_id, 'C-' || substr('00000' || client_id, -5), name, created_at FROM clients;

DROP TABLE clients;
ALTER TABLE clients_new RENAME TO clients;

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

PRAGMA foreign_keys = ON;
