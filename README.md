# ケアレポート デモ (mizutani-worker)

訪問介護記録 → DeepSeek で構造化レポート化するデモ。

- Worker: `mizutani-worker` → https://mizutani-worker.ustyle-promotion.workers.dev
- D1: `care-report-db`
- Secret: `MIZUTANI_SAMPLE` (DeepSeek APIキー)
- Model: `deepseek-chat` (`response_format: { type: 'json_object' }` でJSON強制)

## ファイル構成

```
care-report-demo/
├── wrangler.toml         # Workers設定
├── schema.sql            # D1テーブル定義
├── package.json          # npm scripts + wrangler依存
├── .gitignore
├── src/
│   ├── index.js          # Worker（API + HTML配信 + LLM呼び出し）
│   └── index.html        # フロント（タブUI）
└── README.md
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| POST | /api/report | レポート生成（生記録→構造化JSON、D1保存） |
| GET  | /api/clients | 利用者一覧 |
| GET  | /api/history/:name | 利用者の過去20件 |

リクエストbody例（`POST /api/report`）：

```json
{
  "client_name": "田中ヨシ子",
  "visit_date": "2026-05-17",
  "raw_text": "玄関チャイム3回ならしたが応答なし..."
}
```

---

## デプロイ

ローカルから直接 `wrangler deploy` する方式。wrangler が CF に OAuth login 済み前提。

```bash
npm run deploy
# = npx wrangler deploy
```

これだけ。30秒で本番反映。

### 初回セットアップ（既存環境では不要）

```bash
# 1. D1作成（既存なら不要、本リポは database_id 設定済み）
npx wrangler d1 create care-report-db

# 2. schema 適用（テーブル変更時のみ、冪等）
npm run db:init:remote

# 3. secret 登録（既存なら不要）
npx wrangler secret put MIZUTANI_SAMPLE
# → DeepSeek の API key を貼る
```

---

## ローカル開発（必要なら）

```bash
npm install
echo "MIZUTANI_SAMPLE=sk-..." > .dev.vars   # DeepSeekのAPIキー、.gitignore済み
npm run db:init:local                        # ローカルSQLiteにschema適用
npm run dev                                  # localhost:8787
```

ログ：
```bash
npm run tail   # 本番Worker のログをストリーム
```

---

## 注意

- `wrangler.toml` の `database_id` を環境ごとに差し替えること
- `.dev.vars` は絶対コミットしない（`.gitignore` 済み）
- Worker内では `env.MIZUTANI_SAMPLE` で参照（HTMLには露出しない）
- LLM呼び出し関数名が `callClaude()` のまま残ってる（命名がプロバイダと食い違うが動作には影響なし）
- DeepSeek の JSON モード (`response_format: { type: 'json_object' }`) を使用、prefill ハック不要
