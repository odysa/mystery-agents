import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';

async function withServer(fn, dataDir = mkdtempSync(join(tmpdir(), 'ma-'))) {
  const { server } = createApp({ dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const res = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call, base, dataDir); } finally { server.close(); }
  return dataDir;
}

const waitFor = async (fn, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('超时');
};

test('API：AI 对局自动完成，可下载日志', async () => {
  const dir = await withServer(async (call) => {
    const sc = await call('/api/scenarios');
    assert.equal(sc.body[0].id, 'yuye-yaohuo');
    const pub = await call('/api/scenarios/yuye-yaohuo');
    assert.ok(!JSON.stringify(pub.body).includes('"truth"'));
    assert.equal((await call('/api/scenarios/..%2Fpackage')).status, 404);
    const g = await call('/api/games', { seats: {}, speedMs: 0, seed: 5 });
    assert.equal(g.status, 201);
    const view = await waitFor(async () => { const v = await call(`/api/games/${g.body.id}/view?view=god`); return v.body.phase === 'ended' && v.body; });
    assert.ok(view.metrics);
    const log = await call(`/api/games/${g.body.id}/log`);
    assert.ok(log.body.events.length > 50);
    assert.ok(!('tokens' in log.body.meta));
    assert.ok(!('hostToken' in log.body.meta));
    assert.equal((await call(`/api/games/${g.body.id}/control`, { op: 'speed', speedMs: 500 })).status, 403, '观众不能调速度');
    assert.equal((await call(`/api/games/${g.body.id}/control`, { op: 'speed', speedMs: 500, hostToken: g.body.hostToken })).status, 200);
  });
  rmSync(dir, { recursive: true, force: true });
});

test('API：真人对局的访问控制与回合', async () => {
  const dir = await withServer(async (call) => {
    const g = await call('/api/games', { seats: { lu_yuan: 'human' }, speedMs: 0, seed: 8 });
    const { id, tokens } = g.body;
    const tok = tokens.lu_yuan;
    assert.ok(tok);
    assert.equal((await call(`/api/games/${id}/view?view=god`)).status, 403, '真人对局进行中禁止上帝视角');
    assert.equal((await call(`/api/games/${id}/view?token=wrong`)).status, 403);
    assert.equal((await call(`/api/games/${id}/log`)).status, 403);
    assert.equal((await call(`/api/games/${id}/control`, { op: 'pause' })).status, 403);
    const spect = await call(`/api/games/${id}/view`);
    assert.ok(spect.body.events.every((e) => e.vis === 'public'));
    assert.ok(!('you' in spect.body));
    // 玩到结束：每次轮到陆远就做一个简单合法动作
    let guard = 0;
    while (guard++ < 200) {
      const v = (await waitFor(async () => {
        const r = await call(`/api/games/${id}/view?token=${tok}`);
        return (r.body.phase === 'ended' || r.body.turn?.pid === 'lu_yuan') && r.body;
      }));
      if (v.phase === 'ended') break;
      assert.equal(v.you.id, 'lu_yuan');
      assert.equal(v.you.isMurderer, true);
      assert.ok(!JSON.stringify(v).includes('"implicates"'));
      const k = v.turn.kind;
      const action = k === 'ready' ? { type: 'READY' } : k === 'investigate' ? { type: 'INVESTIGATE', location: 'kiln' }
        : k === 'respond' ? { type: 'RESPOND', text: '我整晚都在窑房烧窑。' } : k === 'vote' ? { type: 'VOTE', target: 'lin_xiulan' } : { type: 'SPEAK', text: '我一直在窑房。' };
      const bad = await call(`/api/games/${id}/action`, { token: tok, action: { type: 'VOTE', target: 'lu_yuan' } });
      assert.equal(bad.status, 400);
      const ok = await call(`/api/games/${id}/action`, { token: tok, action });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    }
    const end = await call(`/api/games/${id}/view?view=god`);
    assert.equal(end.body.phase, 'ended');
    assert.equal(end.status, 200, '结束后允许上帝视角');
  });
  // 重启服务器后能从磁盘恢复
  await withServer(async (call) => {
    const list = await call('/api/games');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].ended, true);
  }, dir);
  rmSync(dir, { recursive: true, force: true });
});

test('API：两名真人同局，各自只看到自己的角色，并能打完整局', async () => {
  const dir = await withServer(async (call) => {
    const g = await call('/api/games', { seats: { lu_yuan: 'human', shen_qing: 'human' }, speedMs: 0, seed: 11 });
    const { id, tokens } = g.body;
    assert.deepEqual(Object.keys(tokens).sort(), ['lu_yuan', 'shen_qing']);
    const a = await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`);
    assert.equal(a.body.you.id, 'lu_yuan');
    assert.deepEqual(a.body.meta.joined, ['lu_yuan']);
    assert.ok(!JSON.stringify(a.body).includes(tokens.shen_qing), '看不到别人的凭证');
    const b = await call(`/api/games/${id}/view?token=${tokens.shen_qing}`);
    assert.equal(b.body.you.id, 'shen_qing');
    assert.ok(a.body.you.script && !JSON.stringify(b.body).includes(a.body.you.script), '看不到陆远的剧本');
    assert.deepEqual(b.body.meta.joined.sort(), ['lu_yuan', 'shen_qing']);
    let guard = 0;
    while (guard++ < 400) {
      const v = await waitFor(async () => {
        const r = await call(`/api/games/${id}/view`);
        return (r.body.phase === 'ended' || ['lu_yuan', 'shen_qing'].includes(r.body.turn?.pid)) && r.body;
      });
      if (v.phase === 'ended') break;
      const pid = v.turn.pid; const k = v.turn.kind;
      const action = k === 'ready' ? { type: 'READY' } : k === 'investigate' ? { type: 'INVESTIGATE', location: 'studio' }
        : k === 'respond' ? { type: 'RESPOND', text: '我不清楚。' } : k === 'vote' ? { type: 'VOTE', target: pid === 'lu_yuan' ? 'lin_xiulan' : 'lu_yuan' } : { type: 'PASS' };
      const wrong = await call(`/api/games/${id}/action`, { token: tokens[pid === 'lu_yuan' ? 'shen_qing' : 'lu_yuan'], action });
      assert.equal(wrong.status, 400, '不能替别人行动');
      const ok = await call(`/api/games/${id}/action`, { token: tokens[pid], action });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    }
    assert.equal((await call(`/api/games/${id}/view?view=god`)).body.phase, 'ended');
  });
  rmSync(dir, { recursive: true, force: true });
});

test('API：观战人数随 SSE 连接增减，观众只拿到公开事件', async () => {
  await withServer(async (call, base) => {
    const g = await call('/api/games', { seats: { lu_yuan: 'human' }, speedMs: 0, seed: 3 });
    const ac = new AbortController();
    const res = await fetch(`${base}/api/games/${g.body.id}/stream`, { signal: ac.signal });
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    const view = JSON.parse(first.split('data: ')[1]);
    assert.ok(view.events.every((e) => e.vis === 'public'));
    assert.ok(!('you' in view));
    assert.equal((await call(`/api/games/${g.body.id}/view`)).body.meta.watchers, 1);
    assert.equal((await call('/api/games')).body[0].watchers, 1);
    ac.abort();
    await waitFor(async () => (await call(`/api/games/${g.body.id}/view`)).body.meta.watchers === 0);
  });
});

test('API：长轮询 /view?wait= 在有新事件时返回，并计入观众数（给会缓冲 SSE 的代理用）', async () => {
  const dir = await withServer(async (call) => {
    const g = await call('/api/games', { seats: { lu_yuan: 'human' }, speedMs: 0, seed: 3 });
    const { id, tokens } = g.body;
    const first = await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`);
    const n = first.body.events.length;
    // 没有新事件：最多等 wait 秒后返回原样
    const t0 = Date.now();
    const idle = await call(`/api/games/${id}/view?token=${tokens.lu_yuan}&wait=1&since=${n}`);
    assert.equal(idle.status, 200);
    assert.ok(Date.now() - t0 >= 900, '没有变化时应等待');
    // 等待中出现新动作：立刻返回新事件
    await waitFor(async () => (await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`)).body.turn?.pid === 'lu_yuan');
    const cur = (await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`)).body.events.length;
    const pending = call(`/api/games/${id}/view?token=${tokens.lu_yuan}&wait=10&since=${cur}`);
    await new Promise((r) => setTimeout(r, 200));
    const t1 = Date.now();
    const turn = (await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`)).body.turn;
    const action = turn.kind === 'ready' ? { type: 'READY' } : turn.kind === 'investigate' ? { type: 'PASS' } : { type: 'PASS' };
    assert.equal((await call(`/api/games/${id}/action`, { token: tokens.lu_yuan, action })).status, 200);
    const got = await pending;
    assert.ok(got.body.events.length > cur, '应返回新事件');
    assert.ok(Date.now() - t1 < 3000, '应在变化后很快返回');
    // 观众长轮询计入在线人数
    await call(`/api/games/${id}/view?wait=0&cid=viewer1`);
    const meta = (await call(`/api/games/${id}/view`)).body.meta;
    assert.equal(meta.watchers, 1);
  });
  rmSync(dir, { recursive: true, force: true });
});

test('API：长轮询带 rev 时，没有新事件的变化（好友加入）也会立刻返回', async () => {
  const dir = await withServer(async (call) => {
    const g = await call('/api/games', { seats: { lu_yuan: 'human', shen_qing: 'human' }, speedMs: 0, seed: 3 });
    const { id, tokens } = g.body;
    const first = await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`);
    await new Promise((r) => setTimeout(r, 100));
    const cur = (await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`)).body;
    assert.equal(typeof cur.meta.rev, 'number');
    assert.ok(cur.meta.rev >= first.body.meta.rev);
    // 没有变化：等满 wait 秒
    const t0 = Date.now();
    await call(`/api/games/${id}/view?token=${tokens.lu_yuan}&wait=1&rev=${cur.meta.rev}`);
    assert.ok(Date.now() - t0 >= 900, '没有变化时应等待');
    // 等待中好友加入：事件数不变，但应很快返回且看到已加入
    const pending = call(`/api/games/${id}/view?token=${tokens.lu_yuan}&wait=10&rev=${cur.meta.rev}`);
    await new Promise((r) => setTimeout(r, 200));
    const t1 = Date.now();
    await call(`/api/games/${id}/view?token=${tokens.shen_qing}`);
    const got = await pending;
    assert.ok(Date.now() - t1 < 3000, '好友加入后应很快返回');
    assert.ok(got.body.meta.joined.includes('shen_qing'));
  });
  rmSync(dir, { recursive: true, force: true });
});
