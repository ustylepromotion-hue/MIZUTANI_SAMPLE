# ケアレポート デモ (mizutani-worker)

訪問介護記録 → Claude sonnet で構造化レポート化するデモ。

- Worker: `mizutani-worker`
- D1: `care-report-db`
- Secret: `MIZUTANI_SAMPLE` (Anthropic APIキー)
- Model: `claude-sonnet-4-6`

## ファイル構成

```
care-report-demo/
├── wrangler.toml              # Workers設定
├── schema.sql                 # D1テーブル定義
├── package.json               # npm scripts + wrangler依存
├── .gitignore
├── .github/workflows/deploy.yml  # push時の自動デプロイ
├── src/
│   ├── index.js               # Worker（API + HTML配信 + Claude呼び出し）
│   └── index.html             # フロント（タブUI）
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

## デプロイ手順（GitHub Actions経由）

`main` ブランチに push すると自動で `wrangler deploy` が走る構成。

### 初回セットアップ（1回だけやる）

#### 1. D1データベース作成（既に作成済みならスキップ）

```bash
npx wrangler d1 create care-report-db
```

出力された `database_id` を `wrangler.toml` に貼る。本リポは既に `c835e3c1-...` で設定済み。

#### 2. Anthropic APIキーをWorker secretとして登録

```bash
npx wrangler secret put MIZUTANI_SAMPLE
```

プロンプトで `sk-ant-...` を貼り付け。

#### 3. GitHub Secrets 登録（CI/CDのため）

GitHubリポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下2つを登録：

| Secret名 | 取得方法 |
|----------|----------|
| `CLOUDFLARE_API_TOKEN` | CF dashboard → 右上アイコン → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" テンプレを使用 → 作成 |
| `CLOUDFLARE_ACCOUNT_ID` | CF dashboard → Workers & Pages を開く → URL の `https://dash.cloudflare.com/<account_id>/...` の `<account_id>` 部分、または右サイドバーに表示 |

### 通常のデプロイ

```bash
git add .
git commit -m "..."
git push origin main
```

→ GitHub Actions が走って自動でデプロイ。完了後 `https://mizutani-worker.<your-subdomain>.workers.dev` で動作。

進捗は GitHubリポの **Actions** タブで確認。

---

## ローカル開発（必要なら）

```bash
npm install
echo "MIZUTANI_SAMPLE=sk-ant-..." > .dev.vars   # .gitignore済み
npm run db:init:local                            # ローカルD1にschema適用
npm run dev                                      # localhost:8787
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
- Claude APIはJSONモードがないため、システムプロンプトでJSON強制 + assistant prefill `{` で先頭を固定している
