# ISSEIレポートメーカー (mizutani-worker)

訪問介護記録 → DeepSeek で構造化レポート化 + 過去記録RAG検索アプリ。

- **アプリ本体**: https://mizutani-worker.ustyle-promotion.workers.dev
- **公開URL（このページ）**: https://ustylepromotion-hue.github.io/MIZUTANI_SAMPLE/ → Worker本体へリダイレクト
- Worker: `mizutani-worker`
- D1: `care-report-db`
- Secret: `MIZUTANI_SAMPLE` (DeepSeek APIキー)
- Model: `deepseek-chat` (JSON mode)

## 機能

- 生記録テキスト→構造化レポート（severity / tasks / issues / challenges / recommendations / changes_from_last / summary）
- レポートはブラウザ上で**人間が編集可能**（黄色枠のcontenteditable）
- 利用者ID `C-XXXXXX`（衝突回避ランダム）、同姓同名OK
- 利用者一覧で **編集 / 削除**（削除は名前タイピング確認）
- 履歴は**日付ごとアコーディオン**、前後ナビ＋全開閉
- **RAG検索**: 過去記録をLLMが巡回。出典内事実のみ回答、推測禁止。事実ベース提案と一般知識補足は可

## API

| Method | Path | 説明 |
|--------|------|------|
| POST | /api/report | レポート生成 |
| GET  | /api/clients | 利用者一覧 |
| GET  | /api/history/:key | 履歴（public_id or name） |
| PATCH | /api/clients/:public_id | 利用者名変更 |
| DELETE | /api/clients/:public_id | 利用者削除（記録もカスケード） |
| POST | /api/ask/:public_id | RAG検索 |

## デプロイ

```bash
npm run deploy   # = npx wrangler deploy
```

スキーマ変更時:
```bash
npx wrangler d1 execute care-report-db --remote --file=migrations/<file>.sql
```

バックアップ:
```bash
npx wrangler d1 export care-report-db --remote --output=backup.sql
```

## 注意

- `.dev.vars` は絶対コミットしない
- `env.MIZUTANI_SAMPLE` は DeepSeek APIキー
- LLM関数名が `callClaude()` のまま残存（命名と実体の食い違いだが動作には影響なし）
