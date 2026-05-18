-- 利用者ごとの蓄積ダイジェスト（Markdown）。RAG用にLLMが読みやすい形で保持。
ALTER TABLE clients ADD COLUMN digest_md TEXT NOT NULL DEFAULT '';
