# HANDOFF — mizutani-worker (care-report-demo)

次にこのフォルダ触る人（人間でも次回のClaudeでも）向けの引き継ぎ。READMEには書かない、「やらかしと回避策」をここに残す。

最終更新: 2026-05-19

## 2026-05-18〜19 セッションでの主な変更
- フォルダ rename: `care-report-demo` → `ISSEIレポートメーカー`、ヘッダー/タイトルも変更
- レポート各セクションを contenteditable 化、黄色枠＋編集ヒントで「触れる」UI
- 利用者ID: `clients.public_id` 追加（C-XXXXXX, 衝突回避ランダム）、`name` の UNIQUE 撤廃で同姓同名OK
- 利用者一覧に編集/削除ボタン、削除はニックネームタイピング確認モーダル
- 履歴を日付ごとアコーディオン化、前後ナビ＋全開閉、初期は最新だけ展開
- RAG 検索 (`POST /api/ask/:public_id`): 出典内事実のみ回答、推測禁止、事実ベース提案/一般知識補足は可
- RAGは「質問」ボタン押下時のみ作動（Enter発火を撤去）、出力は3〜5行で簡潔、出典は明示要求時のみ
- GitHub Pages 修正: ルートに `index.html` リダイレクト＋`.nojekyll`。素のREADME表示を停止し Worker 本体へ遷移
- 本名NG → ニックネーム運用に切替（UI全箇所、システムプロンプトも対応）
- 階層メモリ導入（`memory_json` = {long, older, recent}）。記録は無限蓄積だがLLMコンテキストは~4000tok固定。50件超で long を LLM 再要約（300字）
- `summary_jp` 生成プロンプトに厳格ルール: ソースは生テキスト+過去記録のみ、推測・脚色・ヘッジ表現禁止、不明は「記載なし」

## マイグレーション履歴
- 0001_add_public_id.sql — clients再構築、public_id追加、name UNIQUE撤廃
- 0002_add_digest.sql — digest_md 追加（後に廃止）
- 0003_digest_json.sql — digest_md → digest_json（JSON配列）
- 0004_memory.sql — digest_json → memory_json（{long, older, recent}）

すべて remote 適用済み。バックアップは `backup_20260518_155753.sql`。

---
（以下、元の内容）

---

## 1. このアプリの現在地（事実）

- **本番URL: https://mizutani-worker.ustyle-promotion.workers.dev** ← ここで動いてる
- **GitHub: https://github.com/ustylepromotion-hue/MIZUTANI_SAMPLE** ← ソース置き場のみ。CI/CDなし
- Worker: `mizutani-worker`
- D1: `care-report-db` (id `c835e3c1-6254-4c15-aa6f-d6f0381def16`)
- Secret: `MIZUTANI_SAMPLE` = **DeepSeek API key**（Anthropicじゃない、罠）
- Model: `deepseek-chat`、`response_format: { type: "json_object" }` でJSON強制
- CF account: ustyle.promotion@gmail.com / `d1b74546929d99a7d941d4b503a5e1b3`
- wranglerはOAuth login済み。追加認証は不要

デプロイは `npm run deploy` 一発。30秒で本番反映。

---

## 2. 過去にハマったポイント（同じ轍を踏むな）

### 2-1. `MIZUTANI_SAMPLE` は Anthropic じゃなく DeepSeek

プロンプト本文に「Claude API（sonnet、レポート生成）」と書かれてる箇所がある（元の構築指示書）。素直に信じて `api.anthropic.com` 叩く実装に書き換えると、本番テストで `invalid x-api-key` が出る。

**事実：** ユーザのこのアカウント（ustyle.promotion）の既存Workerは基本DeepSeek構成。`MIZUTANI_SAMPLE` も DeepSeek key。`src/index.js` の `callClaude()` 関数は名前に反して中身は `api.deepseek.com/chat/completions` を叩いている。命名が嘘なのは既知。

**ルール：**
- 既存secretのプロバイダを変更する書き換えは、ユーザに確認するまでしない
- `src/index.js` の `fetch()` 行のURLを必ず確認してから手を入れる
- 命名と実体が食い違う場合は実体を信じる

### 2-2. デプロイは「ローカル `wrangler deploy`」一本

GitHub Actions経路を提案するな。過去にやったら以下の連鎖が起きた：

1. ローカルSSH鍵がGitHub未登録 → push失敗
2. HTTPSのkeychain tokenに`workflow` scopeなし → ワークフローpush拒否
3. gh CLIインストール → device flow → workflow scope付き再認証
4. GitHub Actions実行 → CF API token未登録で失敗
5. CF API tokenはOAuth経由のprogrammatic作成不可（権限階層）→ ダッシュボード手動操作必須
6. ユーザに「今までは Worker名+secret 教えただけでデプロイできてた」と指摘されて結局ローカル方式に戻した

**ルール：**
- 「デプロイ方法は？」を聞く必要がそもそもない。`npm run deploy` で終わり
- GitHub Actions / CF Buildsは、ユーザが明示的に「CI/CDにしたい」と言った時だけ提案
- GitHubは「ソース置き場」、本番反映は別経路（ローカルwrangler）と分けて考える

### 2-3. GitHub Pages のURLと混同しないように

ユーザが `https://ustylepromotion-hue.github.io/MIZUTANI_SAMPLE/` を開いて「動いてないやん」と来たことがある。

**事実：**
- GitHub Pagesは設定してない（不要）、動かなくて当然
- このアプリは D1 + DeepSeek API が必要なので、静的ホスティング（GitHub Pages）では原理的に動かせない
- アプリ本体は **CF Workers** で動く。**正しいURLは `https://mizutani-worker.ustyle-promotion.workers.dev`**

**ルール：**
- 報告時は CF Workers URL を太字で強調する
- 「GitHubに上げた」と言うときは「ソースだけ」と明記する
- ユーザから「動かない」と言われたら、まずどのURL見てるか確認する

### 2-4. `care-report-db` には過去テストの残骸が入ってる

`/api/clients` を叩くと「テスト太郎」「あああ」「っっs」など過去のテスト残骸が返る。気持ち悪いが、本番D1のデータなので勝手に消すな。ユーザ判断仰いでから DELETE。

---

## 3. 改善余地（未対応、優先度低）

| 項目 | 内容 | 影響 |
|------|------|------|
| 関数名 | `callClaude()` を `callLLM()` or `callDeepSeek()` にリネーム | 命名と実体の食い違い解消 |
| テストデータクリーンアップ | `care_records` / `clients` の不要テストレコード削除 | UI の利用者一覧が綺麗になる |
| `/api/clients` 並び順 | `ORDER BY last_visit DESC NULLS LAST` 追加で record_count=0 を後ろに | 一覧の見やすさ |
| ローカル開発確認 | `.dev.vars` 作成して `npm run dev` でlocalhost動作確認まだやってない | 開発時の動作保証 |
| `/api/history/:name` テスト | 未curl、ブラウザ経由でしか動作未確認 | 信頼性 |

---

## 4. 動作確認したこと（2026-05-17 時点）

- `GET /` → 200, HTML配信OK
- `GET /api/clients` → 200, JSON返却OK（テスト残骸含む）
- `POST /api/report` で田中ヨシ子テスト → 200, 9秒, severity=yellow, D1保存OK
- `wrangler secret list` で `MIZUTANI_SAMPLE` 登録確認

---

## 5. よく使うコマンド

```bash
# デプロイ
npm run deploy

# 本番ログtail
npm run tail

# D1 schema再適用（冪等）
npm run db:init:remote

# 本番のレコード件数確認
npx wrangler d1 execute care-report-db --remote --command "SELECT name, COUNT(*) c FROM clients c LEFT JOIN care_records r ON c.client_id=r.client_id GROUP BY c.client_id"

# secret 一覧
npx wrangler secret list

# 過去のデプロイ履歴
npx wrangler deployments list --name mizutani-worker
```

---

## 6. 関連メモリ（ユーザのClaude memory）

- `feedback-cf-deploy-default` — CFデプロイはローカル優先
- `feedback-llm-provider-from-secret` — 既存secretのプロバイダ尊重
- `project-mizutani-care-report` — このプロジェクトの概要
