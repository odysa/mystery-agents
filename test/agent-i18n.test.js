import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listScenarios, loadScenario, translationCoverage } from '../src/engine/scenario.js';
import { GameRunner } from '../src/runner.js';
import { renderObservationText } from '../src/agent-text.js';
import { createApp } from '../src/server.js';

const HAN = /[一-龥]/;

test('多语言：每个内置剧本都有完整英文翻译，英文对局里任何玩家都看不到中文', async () => {
  for (const meta of listScenarios()) {
    const sc = loadScenario(meta.id);
    assert.equal(translationCoverage(sc, 'en').missing.length, 0, `${meta.id} 缺少翻译`);
    const r = new GameRunner({ id: `i18n_${meta.id}`, scenarioId: meta.id, seed: 5, seats: Object.fromEntries(sc.characters.map((c) => [c.id, 'rule'])), speedMs: 0, lang: 'en' });
    const g = await r.runToEnd();
    // 译者有意保留的汉字（例如「慕」字落款）只允许出现在英文翻译本身里
    const allowed = new Set(JSON.stringify(sc.translations.en).match(new RegExp(HAN.source, 'g')) || []);
    const stray = (t) => (t.match(new RegExp(HAN.source, 'g')) || []).filter((ch) => !allowed.has(ch));
    for (const pid of g.charIds) {
      const obs = g.observe(pid);
      const bad = stray(JSON.stringify(obs));
      assert.equal(bad.length, 0, `${meta.id}/${pid} 英文观察里有中文：${bad.join('')}`);
      assert.equal(stray(renderObservationText(obs, { lang: 'en' })).length, 0, `${meta.id}/${pid} 英文文本观察里有中文`);
    }
  }
});

async function withServer(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ma-agent-'));
  const { server } = createApp({ dataDir: join(root, 'games'), scenarioDir: join(root, 'scenarios') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, headers = {}) => {
    const res = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) } : { headers });
    const t = await res.text();
    let b; try { b = JSON.parse(t); } catch { b = t; }
    return { status: res.status, body: b };
  };
  try { await fn(call, base); } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
}

test('Agent：空位 → 认领 → 纯文本长轮询 → 简化的动作提交；英文错误消息', async () => {
  await withServer(async (call) => {
    const g = await call('/api/games', { scenarioId: 'yeche-wopu', lang: 'en', seats: { song_huaijin: 'open' }, speedMs: 0 });
    assert.equal(g.status, 201);
    assert.deepEqual(g.body.tokens, {}, '空位的 token 不发给创建者');
    const seats = (await call('/api/open-seats')).body;
    assert.ok(seats.some((x) => x.gameId === g.body.id && x.pid === 'song_huaijin'));
    const j = await call(`/api/games/${g.body.id}/join`, { agentName: 'TestBot' });
    assert.equal(j.status, 200);
    assert.equal((await call(`/api/games/${g.body.id}/join`, {})).status, 409, '空位只能被认领一次');
    assert.ok(!(await call('/api/open-seats')).body.some((x) => x.gameId === g.body.id));
    const tok = j.body.token;
    const first = await call(`/api/games/${g.body.id}/turn?token=${tok}&format=text&timeout=5`);
    assert.ok(first.body.includes('YOU ARE THE MURDERER'), first.body.slice(0, 200));
    assert.ok(!HAN.test(first.body));
    assert.ok(first.body.includes('{"type":"READY"}'));
    const bad = await call(`/api/games/${g.body.id}/action?token=${tok}`, { type: 'VOTE', target: 'x' }, { 'x-ma-lang': 'en' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Allowed in this phase: READY');
    const ok = await call(`/api/games/${g.body.id}/action?token=${tok}`, { type: 'READY' });
    assert.equal(ok.status, 200);
    const v = (await call(`/api/games/${g.body.id}/view`)).body;
    assert.equal(v.meta.agentNames.song_huaijin, 'TestBot');
    assert.equal(v.meta.lang, 'en');
    assert.equal((await call('/api/games/nope/view', null, { 'x-ma-lang': 'en' })).body.error, 'Game not found');
    const chk = await call('/api/scenarios/check?lang=en', { scenario: { id: 'x' } });
    assert.equal(chk.status, 422);
    assert.ok(chk.body.errors.every((e) => !HAN.test(e)), chk.body.errors.join('\n'));
  });
});

test('Agent 文档与 MCP：/agent.md、/llms.txt、tools/list、create_game → wait_turn → act', async () => {
  await withServer(async (call, base) => {
    const md = await call('/agent.md');
    assert.ok(md.body.includes(`${base}/api/open-seats`));
    assert.ok((await call('/agent.md?lang=en')).body.includes('guide for AI agents'));
    assert.ok((await call('/llms.txt')).body.includes('/agent.md'));
    const rpc = (method, params, id = 1) => call('/mcp?lang=en', { jsonrpc: '2.0', id, method, params });
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.body.result.protocolVersion, '2025-06-18');
    assert.ok(init.body.result.instructions.includes('guide for AI agents'));
    const notif = await call('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notif.status, 202);
    const tools = (await rpc('tools/list', {})).body.result.tools.map((t) => t.name);
    for (const n of ['list_scenarios', 'list_open_seats', 'create_game', 'join_game', 'wait_turn', 'act', 'check_scenario', 'submit_scenario']) assert.ok(tools.includes(n), n);
    const created = (await rpc('tools/call', { name: 'create_game', arguments: { scenarioId: 'dabian-qianye', mySeats: ['tang_wei'] } })).body.result.content[0].text;
    const gid = created.match(/gameId=(\S+)/)[1];
    const tok = created.match(/tang_wei: (\w+)/)[1];
    for (let i = 0; i < 200; i++) {
      const obs = (await rpc('tools/call', { name: 'wait_turn', arguments: { gameId: gid, token: tok, timeoutSec: 5 } })).body.result.content[0].text;
      if (obs.includes('The game has ended')) return;
      const line = obs.split('\n').find((l) => l.trim().startsWith('{"type"'));
      const action = JSON.parse(line.trim());
      if (action.type === 'SPEAK') action.text = 'I was in my office.';
      if (action.type === 'RESPOND') { action.text = 'No comment.'; delete action.clue_id; }
      const r = (await rpc('tools/call', { name: 'act', arguments: { gameId: gid, token: tok, action } })).body.result;
      assert.ok(!r.isError, r.content[0].text);
    }
    assert.fail('MCP 对局没有结束');
  });
});
