-- ISSEIレポートメーカー - D1 Schema

CREATE TABLE IF NOT EXISTS clients (
  client_id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,    -- 表示用ID（例 C-A3K7M2）
  name TEXT NOT NULL,                 -- 同姓同名OK（UNIQUE外した）
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

CREATE TABLE IF NOT EXISTS care_records (
  record_id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  visit_date TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_care_records_client ON care_records(client_id, visit_date DESC);
