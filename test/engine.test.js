import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScenario, validateScenario } from '../src/engine/scenario.js';
import { Game } from '../src/engine/game.js';
import { auditObservation } from '../src/engine/audit.js';
import { GameRunner } from '../src/runner.js';
import { makeRng } from '../src/engine/rng.js';

const sc = loadScenario('yuye-yaohuo');
const allRule = Object.fromEntries(sc.characters.map((c) => [c.id, 'rule']));

test('剧本通过结构与可解性校验', () => {
  assert.deepEqual(validateScenario(sc), []);
});

test('校验器能发现不可解的剧本', () => {
  const broken = structuredClone(sc);
  for (const c of broken.clues) c.implicates = {};
  for (const ch of broken.characters) for (const k of ch.knowledge) k.implicates = {};
  assert.ok(validateScenario(broken).some((e) => e.includes('不可解')));
});

test('校验器能发现依赖成环的线索', () => {
  const broken = structuredClone(sc);
  broken.clues.find((c) => c.id === 'c_kilnlog').requires = ['c_ashpit'];
  assert.ok(validateScenario(broken).some((e) => e.includes('成环')));
});

test('规则型 AI 可以无人干预地完成整局', async () => {
  const r = new GameRunner({ id: 't1', scenarioId: sc.id, seed: 42, seats: allRule, speedMs: 0 });
  const g = await r.runToEnd();
  assert.equal(g.state.phase, 'ended');
  assert.ok(g.state.result);
  assert.equal(Object.keys(g.state.votes).length, 5);
  assert.equal(g.events.filter((e) => e.type === 'action_rejected').length, 0);
});

test('事件日志可以完整重建状态（回放确定性）', async () => {
  const r = new GameRunner({ id: 't2', scenarioId: sc.id, seed: 7, seats: allRule, speedMs: 0 });
  const g = await r.runToEnd();
  const g2 = Game.fromEvents(sc, { id: g.id, seed: g.seed }, structuredClone(g.events));
  const strip = (s) => JSON.parse(JSON.stringify(s));
  assert.deepEqual(strip(g2.state), strip(g.state));
  for (const pid of g.charIds) assert.deepEqual(strip(g2.observe(pid)), strip(g.observe(pid)));
});

test('相同种子产生相同的对局', async () => {
  const run = async () => {
    const r = new GameRunner({ id: 'same', scenarioId: sc.id, seed: 99, seats: allRule, speedMs: 0 });
    const g = await r.runToEnd();
    return g.events.map(({ ts, ...e }) => e);
  };
  const a = await run();
  const b = await run();
  // 决策耗时不参与比较
  const clean = (es) => es.map((e) => (e.type === 'agent_decision' ? { ...e, data: { ...e.data, latencyMs: 0 } } : e));
  assert.deepEqual(clean(a), clean(b));
});

test('访问控制：任何时刻任何玩家都看不到无权信息（随机动作模糊测试）', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const g = new Game(sc, { id: `fz${seed}`, seed });
    const rng = makeRng(seed * 31);
    g.start();
    let steps = 0;
    while (!g.ended && steps++ < 500) {
      const pid = g.currentActor();
      const allowed = g.allowedActions(pid);
      const type = allowed[Math.floor(rng() * allowed.length)];
      const obs = g.observe(pid);
      const others = g.charIds.filter((c) => c !== pid);
      const mine = obs.myClues.filter((c) => !c.public);
      const action = {
        type,
        location: sc.locations[Math.floor(rng() * sc.locations.length)].id,
        target: others[Math.floor(rng() * others.length)],
        clue_id: mine.length ? mine[Math.floor(rng() * mine.length)].id : 'c_nope',
        text: '测试发言',
      };
      // 偶尔故意提交非法动作
      if (rng() < 0.1) g.submit(others[0], { type: 'SPEAK', text: '插队' });
      const res = g.submit(pid, action);
      if (!res.ok) g.submit(pid, allowed.includes('PASS') ? { type: 'PASS' } : { type: allowed[0], target: others[0], text: '好', location: 'studio' });
      for (const p of g.charIds) assert.deepEqual(auditObservation(g, p), [], `seed=${seed} step=${steps} 玩家 ${p}`);
    }
    assert.ok(g.ended, `seed=${seed} 未能结束`);
  }
});

test('观众视角只包含公开事件，且不含任何私有字段', async () => {
  const r = new GameRunner({ id: 't3', scenarioId: sc.id, seed: 3, seats: allRule, speedMs: 0 });
  r.start();
  // 推进到第二轮讨论中途
  while (!(r.game.state.phase === 'discuss' && r.game.state.round === 2)) await r.step();
  const v = r.game.spectate();
  assert.ok(v.events.every((e) => e.vis === 'public'));
  const s = JSON.stringify(v);
  assert.ok(!s.includes('"implicates"'));
  assert.ok(!s.includes(sc.truth.summary.slice(0, 20)));
  for (const c of sc.characters) assert.ok(!s.includes(c.script.slice(0, 40)));
});

test('规则校验：拒绝越权与非法动作', () => {
  const g = new Game(sc, { id: 'v', seed: 1 });
  g.start();
  const first = g.currentActor();
  const other = g.charIds.find((c) => c !== first);
  assert.equal(g.submit(other, { type: 'READY' }).ok, false, '不是自己的回合');
  assert.equal(g.submit(first, { type: 'VOTE', target: other }).ok, false, '阶段不允许');
  for (const pid of [...g.state.turnOrder]) assert.ok(g.submit(pid, { type: 'READY' }).ok);
  assert.equal(g.state.phase, 'investigate');
  const p = g.currentActor();
  assert.equal(g.submit(p, { type: 'INVESTIGATE', location: 'moon' }).ok, false, '未知地点');
  assert.ok(g.submit(p, { type: 'INVESTIGATE', location: 'kiln' }).ok);
  // 冷窑灰坑需要先拿到窑温记录才可能被搜到
  const ashOwner = g.state.clueOwner.c_ashpit;
  assert.equal(ashOwner, undefined);
  assert.equal(g.events.filter((e) => e.type === 'action_rejected').length, 3);
  assert.ok(g.events.filter((e) => e.type === 'action_rejected').every((e) => e.vis === 'system'));
});

test('前置线索：没有窑温记录时搜不到灰坑里的镇纸', () => {
  const g = new Game(sc, { id: 'req', seed: 5 });
  const avail = g.availableClues('lu_yuan', 'kiln').map((c) => c.id);
  assert.ok(!avail.includes('c_ashpit'));
  g.state.clueOwner.c_kilnlog = 'lu_yuan';
  assert.ok(g.availableClues('lu_yuan', 'kiln').map((c) => c.id).includes('c_ashpit'));
  assert.ok(!g.availableClues('shen_qing', 'kiln').map((c) => c.id).includes('c_ashpit'), '别人私藏的前置线索不会解锁');
  g.state.publicClues.c_kilnlog = 'lu_yuan';
  assert.ok(g.availableClues('shen_qing', 'kiln').map((c) => c.id).includes('c_ashpit'), '公开后所有人都能解锁');
});

test('投票平票时凶手逃脱', () => {
  const g = new Game(sc, { id: 'tie', seed: 1 });
  g.state.votes = { shen_qing: 'lu_yuan', lu_yuan: 'zhou_man', zhou_man: 'lu_yuan', han_ziheng: 'zhou_man', lin_xiulan: 'han_ziheng' };
  g.state.phase = 'vote';
  g.finish();
  assert.equal(g.state.result.convicted, null);
  assert.equal(g.state.result.goodWin, false);
  assert.equal(g.state.result.players.lu_yuan.win, true);
});
