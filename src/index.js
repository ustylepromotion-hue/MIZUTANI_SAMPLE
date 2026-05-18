import HTML from './index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      // API routes
      if (url.pathname === '/api/report' && request.method === 'POST') {
        return await handleReport(request, env, cors);
      }
      if (url.pathname === '/api/clients' && request.method === 'GET') {
        return await handleClients(env, cors);
      }
      if (url.pathname.startsWith('/api/history/') && request.method === 'GET') {
        const clientName = decodeURIComponent(url.pathname.split('/api/history/')[1]);
        return await handleHistory(clientName, env, cors);
      }
      const askMatch = url.pathname.match(/^\/api\/ask\/([^/]+)$/);
      if (askMatch && request.method === 'POST') {
        return await handleAsk(decodeURIComponent(askMatch[1]), request, env, cors);
      }
      const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
      if (clientMatch) {
        const publicId = decodeURIComponent(clientMatch[1]);
        if (request.method === 'PATCH') return await handleClientRename(publicId, request, env, cors);
        if (request.method === 'DELETE') return await handleClientDelete(publicId, env, cors);
      }

      // Serve HTML
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500, headers: cors });
    }
  },
};

// ── Report Generation ──
async function handleReport(request, env, cors) {
  const { client_name, visit_date, raw_text } = await request.json();

  if (!client_name || !raw_text) {
    return Response.json({ error: 'client_name and raw_text required' }, { status: 400, headers: cors });
  }

  const date = visit_date || new Date().toISOString().split('T')[0];

  // Upsert client（同名は既存を使い回す。同姓同名を分けたい場合は別途編集で改名）
  let client = await env.DB.prepare('SELECT client_id, public_id FROM clients WHERE name = ? ORDER BY client_id ASC LIMIT 1').bind(client_name).first();
  if (!client) {
    const publicId = await generateUniquePublicId(env);
    await env.DB.prepare('INSERT INTO clients (public_id, name) VALUES (?, ?)').bind(publicId, client_name).run();
    client = await env.DB.prepare('SELECT client_id, public_id FROM clients WHERE public_id = ?').bind(publicId).first();
  }

  // Fetch past records (latest 10)
  const pastRecords = await env.DB.prepare(
    'SELECT visit_date, report_json FROM care_records WHERE client_id = ? ORDER BY visit_date DESC LIMIT 10'
  ).bind(client.client_id).all();

  const history = pastRecords.results.map(r => ({
    visit_date: r.visit_date,
    ...JSON.parse(r.report_json),
  }));

  // Call Claude API
  const reportJson = await callClaude(env.MIZUTANI_SAMPLE, raw_text, client_name, date, history);

  // Save to D1
  await env.DB.prepare(
    'INSERT INTO care_records (client_id, visit_date, raw_text, report_json) VALUES (?, ?, ?, ?)'
  ).bind(client.client_id, date, raw_text, JSON.stringify(reportJson)).run();

  // ── 階層メモリ更新 ──
  const entry = buildDigestEntry(date, reportJson);
  const current = await env.DB.prepare('SELECT memory_json FROM clients WHERE client_id = ?').bind(client.client_id).first();
  const mem = parseMemory(current?.memory_json);
  await appendToMemory(mem, entry, env);
  await env.DB.prepare('UPDATE clients SET memory_json = ? WHERE client_id = ?').bind(JSON.stringify(mem), client.client_id).run();

  return Response.json({ report: reportJson, history }, { headers: cors });
}

// ── メモリ層管理 ──
const RECENT_CAP = 10;
const OLDER_CAP = 50;

function parseMemory(s) {
  try {
    const m = JSON.parse(s || '{}');
    return { long: m.long || '', older: m.older || [], recent: m.recent || [] };
  } catch { return { long: '', older: [], recent: [] }; }
}

function buildDigestEntry(date, r) {
  const e = { d: date, s: r.severity || 'green' };
  if (r.tasks_performed?.length) e.tasks = r.tasks_performed;
  if (r.client_condition) e.cond = r.client_condition;
  if (r.client_habits) e.habits = r.client_habits;
  if (r.issues?.length) e.issues = r.issues;
  if (r.challenges?.length) e.chal = r.challenges;
  if (r.recommendations?.length) e.rec = r.recommendations;
  if (r.changes_from_last && r.changes_from_last !== '初回記録') e.chg = r.changes_from_last;
  if (r.summary_jp) e.sum = r.summary_jp;
  return e;
}

function entryToOneLine(e) {
  const core = e.sum || (e.tasks || []).join('+') || (e.issues || []).join(';') || '記録あり';
  return `${e.d}/${e.s}: ${core}`.slice(0, 120);
}

async function appendToMemory(mem, entry, env) {
  mem.recent.unshift(entry);
  while (mem.recent.length > RECENT_CAP) {
    const demoted = mem.recent.pop();
    mem.older.unshift(entryToOneLine(demoted));
  }
  if (mem.older.length > OLDER_CAP) {
    mem.long = await consolidateLongTerm(env, mem.long, mem.older);
    mem.older = [];
  }
}

async function consolidateLongTerm(env, prevLong, olderLines) {
  const prompt = `以下は同一利用者の中期記憶（1行サマリー、新しい順）と既存の長期記憶です。これらを統合し、300字以内の長期記憶として書き直してください。

【ルール】
- 繰り返し起こる事象、慢性的な状態、人物特性、傾向を残す
- 一過性の出来事、軽微な詳細は捨てる
- 単一の文章のみ。前置き・メタ情報・見出し禁止
- 推測禁止、事実のみ

【既存の長期記憶】
${prevLong || '（なし）'}

【中期記憶】
${olderLines.join('\n')}`;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MIZUTANI_SAMPLE}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 500,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) return prevLong; // 失敗時は既存維持
  return (data.choices[0].message.content || '').trim().slice(0, 600);
}

async function buildMemoryFromRecords(clientId, env) {
  const records = await env.DB.prepare(
    'SELECT visit_date, report_json FROM care_records WHERE client_id = ? ORDER BY visit_date ASC'
  ).bind(clientId).all();
  const mem = { long: '', older: [], recent: [] };
  for (const r of records.results) {
    await appendToMemory(mem, buildDigestEntry(r.visit_date, JSON.parse(r.report_json)), env);
  }
  return mem;
}

// ── LLM (DeepSeek) API Call ──
async function callClaude(apiKey, rawText, clientName, visitDate, history) {
  const historyBlock = history.length > 0
    ? `\n\n## 過去の記録（新しい順）\n${JSON.stringify(history, null, 2)}`
    : '\n\n## 過去の記録\nなし（初回）';

  const systemPrompt = `あなたは訪問介護の記録を構造化するアシスタントです。
ヘルパーが書いた生のメモや会話ログを読み取り、以下のJSON形式で出力してください。
プライバシー保護のため、利用者は本名ではなくニックネームで呼ばれます。出力でも"client_name"にはニックネームをそのまま入れること。

出力はJSON **のみ**。前置き・マークダウン・バッククォート一切不要。

{
  "visit_date": "${visitDate}",
  "client_name": "${clientName}",
  "tasks_performed": ["実施した作業を配列で"],
  "client_condition": "利用者の当日の身体・精神状態",
  "client_habits": "利用者の癖・好み・こだわり（新たに気づいた点）",
  "issues": ["問題点・気になった点を配列で"],
  "challenges": ["課題・改善すべき点を配列で"],
  "recommendations": ["次回ケア時の対処レコメンドを配列で"],
  "changes_from_last": "前回からの変化（過去記録がある場合のみ。なければ'初回記録'）",
  "severity": "green | yellow | red（総合的な注意レベル）",
  "summary_jp": "日本語の要約レポート（3〜5行程度、事業所の管理者が読む想定）"
}

注意:
- tasks_performed は具体的に（「入浴介助」「服薬確認」など）
- issues と challenges は分けて記載。issuesは当日の問題、challengesは継続的な課題
- recommendations は具体的なアクションを記載
- severity: 通常=green、要注意=yellow、緊急対応要=red
- 過去の記録がある場合、changes_from_last で前回との差分を必ず記載`;

  const userMessage = `## 利用者: ${clientName}
## 訪問日: ${visitDate}

## 本日の記録（生テキスト）
${rawText}
${historyBlock}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`LLM API error: ${JSON.stringify(data)}`);
  }

  const text = data.choices[0].message.content.replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

// ── Client List ──
async function handleClients(env, cors) {
  const result = await env.DB.prepare(
    'SELECT c.public_id, c.name, COUNT(r.record_id) as record_count, MAX(r.visit_date) as last_visit FROM clients c LEFT JOIN care_records r ON c.client_id = r.client_id GROUP BY c.client_id ORDER BY last_visit DESC'
  ).all();
  return Response.json({ clients: result.results }, { headers: cors });
}

// ── 利用者IDの一意生成（衝突したら再試行） ──
async function generateUniquePublicId(env) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしいI,O,0,1除外
  for (let attempt = 0; attempt < 8; attempt++) {
    let id = 'C-';
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (const b of bytes) id += chars[b % chars.length];
    const exists = await env.DB.prepare('SELECT 1 FROM clients WHERE public_id = ?').bind(id).first();
    if (!exists) return id;
  }
  throw new Error('public_id生成に失敗（衝突多発）');
}

// ── Client Rename ──
async function handleClientRename(publicId, request, env, cors) {
  const { name } = await request.json();
  const trimmed = (name || '').trim();
  if (!trimmed) return Response.json({ error: 'name required' }, { status: 400, headers: cors });
  const result = await env.DB.prepare('UPDATE clients SET name = ? WHERE public_id = ?').bind(trimmed, publicId).run();
  if (!result.meta.changes) return Response.json({ error: 'not found' }, { status: 404, headers: cors });
  return Response.json({ ok: true, public_id: publicId, name: trimmed }, { headers: cors });
}

// ── RAG: 過去対処を巡回してLLMが回答 ──
async function handleAsk(publicId, request, env, cors) {
  const { question } = await request.json();
  const q = (question || '').trim();
  if (!q) return Response.json({ error: 'question required' }, { status: 400, headers: cors });

  let client = await env.DB.prepare('SELECT client_id, public_id, name, memory_json FROM clients WHERE public_id = ?').bind(publicId).first();
  if (!client) client = await env.DB.prepare('SELECT client_id, public_id, name, memory_json FROM clients WHERE name = ?').bind(publicId).first();
  if (!client) return Response.json({ error: 'client not found' }, { status: 404, headers: cors });

  let mem = parseMemory(client.memory_json);
  // 既存データの遅延ビルド
  if (!mem.recent.length && !mem.older.length && !mem.long) {
    mem = await buildMemoryFromRecords(client.client_id, env);
    if (mem.recent.length || mem.older.length) {
      await env.DB.prepare('UPDATE clients SET memory_json = ? WHERE client_id = ?').bind(JSON.stringify(mem), client.client_id).run();
    }
  }
  if (!mem.recent.length && !mem.older.length && !mem.long) {
    return Response.json({ answer: 'この方の記録がまだありません。' }, { headers: cors });
  }

  const digest = `## 長期記憶（要約）\n${mem.long || '（まだ蓄積なし）'}\n\n## 中期記憶（${mem.older.length}件、新しい順、1行）\n${mem.older.join('\n') || '（なし）'}\n\n## 直近${mem.recent.length}件（詳細JSON）\n${JSON.stringify(mem.recent)}`;

  const systemPrompt = `あなたは訪問介護記録の分析アシスタントです。ニックネーム「${client.name}」の方の階層メモリ（長期/中期/直近詳細）を読み、ユーザーの質問に答えます。

【メモリ構造】
- 長期記憶: 過去の傾向や慢性的特性の要約
- 中期記憶: それぞれの訪問の1行サマリー（日付/severity/要点）
- 直近詳細: 直近10件のJSON（キー: d=日付, s=severity, tasks, cond=状態, habits=癖, issues, chal=課題, rec=次回提案, chg=前回比, sum=要約）

【絶対ルール】
1. メモリ内に明示的に書かれた事実のみを根拠に回答する。推測・憶測は禁止。
2. 記録に無い事実を断定してはいけない。該当無ければ「記録にはありません」と簡潔に。
3. 事実に基づく実務提案や、介護・医療・生活援助の一般知識による補足は可能。
4. ユーザーが「出典」「ソース」「どの日か」等を明示的に求めた場合のみ訪問日を添える。
5. プライバシー保護のため本名は不明。ニックネームのみで指す。

【出力スタイル】
- とにかく簡潔に。3〜5行以内が目安。
- 結論を先に。前置き・自己紹介・「ご質問ありがとうございます」等は禁止。
- 過剰な箇条書き・見出し・装飾は禁止。普通の文で短く答える。`;

  const userMessage = `# 質問\n${q}\n\n# この方の過去記録ダイジェスト（新しい順）\n${digest}`;

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.MIZUTANI_SAMPLE}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      max_tokens: 1500,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LLM error: ${JSON.stringify(data)}`);

  return Response.json({
    answer: data.choices[0].message.content,
  }, { headers: cors });
}

// ── Client Delete (cascade) ──
async function handleClientDelete(publicId, env, cors) {
  const client = await env.DB.prepare('SELECT client_id FROM clients WHERE public_id = ?').bind(publicId).first();
  if (!client) return Response.json({ error: 'not found' }, { status: 404, headers: cors });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM care_records WHERE client_id = ?').bind(client.client_id),
    env.DB.prepare('DELETE FROM clients WHERE client_id = ?').bind(client.client_id),
  ]);
  return Response.json({ ok: true }, { headers: cors });
}

// ── History ──
async function handleHistory(key, env, cors) {
  // public_id優先、なければname
  let client = await env.DB.prepare('SELECT client_id FROM clients WHERE public_id = ?').bind(key).first();
  if (!client) client = await env.DB.prepare('SELECT client_id FROM clients WHERE name = ?').bind(key).first();
  if (!client) {
    return Response.json({ history: [] }, { headers: cors });
  }
  const records = await env.DB.prepare(
    'SELECT visit_date, report_json, created_at FROM care_records WHERE client_id = ? ORDER BY visit_date DESC LIMIT 20'
  ).bind(client.client_id).all();

  const history = records.results.map(r => ({
    visit_date: r.visit_date,
    created_at: r.created_at,
    ...JSON.parse(r.report_json),
  }));

  return Response.json({ history }, { headers: cors });
}
