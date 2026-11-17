import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listScenarios, loadScenario, validateScenario, lintScenario } from '../src/engine/scenario.js';
import { simulate } from '../src/simulate.js';
import { createApp } from '../src/server.js';

// 投稿测试用的剧本：去掉包内媒体文件引用（投稿只能用 data URI 或 https）
const yuye = () => {
  const s = JSON.parse(readFileSync(new URL('../scenarios/yuye-yaohuo.json', import.meta.url), 'utf8'));
  delete s.assets; delete s.cover; delete s.victim.portrait;
  for (const c of s.characters) { delete c.portrait; delete c.media; }
  for (const l of s.locations) delete l.image;
  for (const c of s.clues) delete c.media;
  for (const t of Object.values(s.translations || {})) delete t.assets;
  return s;
};

test('所有内置剧本都通过校验，并能被 AI 完整跑完、零越权', async () => {
  const list = listScenarios();
  assert.ok(list.length >= 11, `内置剧本数量 ${list.length}`);
  for (const meta of list) {
    const sc = loadScenario(meta.id);
    const { report } = await simulate(sc, { games: 4, seed: 7 });
    assert.equal(report.completionRate, 1, meta.id);
    assert.equal(report.accessControlViolations, 0, meta.id);
    assert.equal(report.ruleViolationRate, 0, meta.id);
  }
});

test('校验器能拒绝不合法或恶意的投稿而不崩溃', () => {
  for (const bad of [null, [], 'x', 1, {}, { id: 'a', characters: 'x' }, { ...yuye(), characters: [{}] }]) {
    const errs = validateScenario(bad);
    assert.ok(Array.isArray(errs) && errs.length > 0, JSON.stringify(bad)?.slice(0, 40));
  }
  const xss = yuye(); xss.characters[0].color = 'red;"><script>alert(1)</script>';
  assert.ok(validateScenario(xss).some((e) => e.includes('color')));
  const badId = yuye(); badId.clues[0].id = '"><img src=x>';
  assert.ok(validateScenario(badId).some((e) => e.includes('clues[0].id')));
  const badFmt = yuye(); badFmt.format = 'other/9';
  assert.ok(validateScenario(badFmt).some((e) => e.includes('format')));
  const badTime = yuye(); badTime.clues[0].time = '晚上十点';
  assert.ok(validateScenario(badTime).some((e) => e.includes('time')));
});

test('难度体检：旧剧本《雨夜窑火》会被提示太容易', () => {
  const { stats, warnings } = lintScenario(yuye());
  assert.ok(stats.murdererShare > 0.5);
  assert.ok(warnings.some((w) => w.includes('太容易')));
});

async function withServer(fn, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ma-fmt-'));
  const { server } = createApp({ dataDir: join(root, 'games'), scenarioDir: join(root, 'scenarios'), ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const res = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call, base); } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
}

test('投稿：校验 → 发布 → 出现在剧本库 → 可以开局；重复 id 被拒绝', async () => {
  await withServer(async (call, base) => {
    const sc = yuye(); sc.id = 'my-test-case'; sc.title = '测试投稿';
    const bad = await call('/api/scenarios/check', { scenario: { ...sc, players: 99 } });
    assert.equal(bad.status, 422);
    const chk = await call('/api/scenarios/check', { scenario: sc, games: 5 });
    assert.equal(chk.status, 200);
    assert.equal(chk.body.sim.completionRate, 1);
    assert.ok(chk.body.stats.murdererShare > 0.5);
    const pub = await call('/api/scenarios', { scenario: sc, games: 5 });
    assert.equal(pub.status, 201, JSON.stringify(pub.body.errors));
    const list = (await call('/api/scenarios')).body;
    assert.equal(list.find((x) => x.id === 'my-test-case')?.source, 'community');
    assert.equal((await call('/api/scenarios', { scenario: sc, games: 5 })).status, 409);
    const builtinClash = yuye();
    assert.equal((await call('/api/scenarios', { scenario: builtinClash, games: 5 })).status, 409);
    // 社区剧本不提供源文件（防剧透），内置剧本可以作为模板下载
    assert.equal((await call('/api/scenarios/my-test-case/source')).status, 404);
    assert.equal((await call('/api/scenarios/yuye-yaohuo/source')).status, 200);
    const g = await call('/api/games', { scenarioId: 'my-test-case', seats: {}, speedMs: 0 });
    assert.equal(g.status, 201);
    const schema = await fetch(`${base}/schema/openmystery-1.schema.json`).then((r) => r.json());
    assert.equal(schema.properties.format.const, 'openmystery/1');
    const fmt = await call('/api/format');
    assert.equal(fmt.body.agentProtocol, 'openmystery-agent/1');
  });
});

test('外部智能体：external 座位 + 长轮询 /turn 打完整局', async () => {
  await withServer(async (call) => {
    const g = await call('/api/games', { scenarioId: 'dabian-qianye', seats: { tang_wei: 'external' }, speedMs: 0, seed: 2 });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    const tok = g.body.tokens.tang_wei;
    assert.equal((await call(`/api/games/${g.body.id}/view?view=god`)).status, 403, '有外部智能体时禁止上帝视角');
    for (let i = 0; i < 200; i++) {
      const v = (await call(`/api/games/${g.body.id}/turn?token=${tok}&timeout=5`)).body;
      if (v.phase === 'ended') { assert.ok(v.result); return; }
      assert.equal(v.yourTurn, true);
      const a = v.allowed;
      const action = a.includes('READY') ? { type: 'READY' } : a.includes('INVESTIGATE') ? { type: 'INVESTIGATE', location: v.locations[0].id }
        : a.includes('RESPOND') ? { type: 'RESPOND', text: '我在办公室。' } : a.includes('VOTE') ? { type: 'VOTE', target: v.turnOrder.find((p) => p !== 'tang_wei') } : { type: 'PASS' };
      assert.equal((await call(`/api/games/${g.body.id}/action`, { token: tok, action })).status, 200);
    }
    assert.fail('没有打完');
  });
});

test('webhook 智能体：模拟器把观察 POST 给外部服务；服务器默认禁止 webhook 座位', async () => {
  let calls = 0;
  const hook = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      calls++;
      const msg = JSON.parse(b);
      assert.equal(msg.protocol, 'openmystery-agent/1');
      assert.ok(!JSON.stringify(msg).includes('"implicates"'), '观察里不能有作者标注');
      const a = msg.allowed;
      // 第一次故意给一个非法动作，测试重试
      const action = msg.retry ? { type: a[a.length - 1] === 'PASS' ? 'PASS' : a[0] } : { type: 'FLY' };
      if (action.type === 'INVESTIGATE') action.location = msg.observation.locations[0].id;
      if (action.type === 'VOTE') action.target = msg.observation.turnOrder.find((p) => p !== msg.pid);
      if (action.type === 'RESPOND') action.text = '……';
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ action }));
    });
  });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${hook.address().port}`;
  try {
    const sc = loadScenario('shuchang-xianxian');
    const { report } = await simulate(sc, { games: 1, seed: 4, agents: 'rule', murdererAgent: 'webhook', webhookUrl: url });
    assert.equal(report.completionRate, 1);
    assert.ok(calls > 0);
    await withServer(async (call) => {
      const r = await call('/api/games', { scenarioId: 'shuchang-xianxian', seats: { qian_deshun: 'webhook' }, webhooks: { qian_deshun: url } });
      assert.equal(r.status, 403);
    });
  } finally { hook.close(); }
});
