import HTML from './index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  // Upsert client
  await env.DB.prepare('INSERT OR IGNORE INTO clients (name) VALUES (?)').bind(client_name).run();
  const client = await env.DB.prepare('SELECT client_id FROM clients WHERE name = ?').bind(client_name).first();

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

  return Response.json({ report: reportJson, history }, { headers: cors });
}

// ── LLM (DeepSeek) API Call ──
async function callClaude(apiKey, rawText, clientName, visitDate, history) {
  const historyBlock = history.length > 0
    ? `\n\n## 過去の記録（新しい順）\n${JSON.stringify(history, null, 2)}`
    : '\n\n## 過去の記録\nなし（初回）';

  const systemPrompt = `あなたは訪問介護の記録を構造化するアシスタントです。
ヘルパーが書いた生のメモや会話ログを読み取り、以下のJSON形式で出力してください。

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
    'SELECT c.name, COUNT(r.record_id) as record_count, MAX(r.visit_date) as last_visit FROM clients c LEFT JOIN care_records r ON c.client_id = r.client_id GROUP BY c.client_id ORDER BY last_visit DESC'
  ).all();
  return Response.json({ clients: result.results }, { headers: cors });
}

// ── History ──
async function handleHistory(clientName, env, cors) {
  const client = await env.DB.prepare('SELECT client_id FROM clients WHERE name = ?').bind(clientName).first();
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
