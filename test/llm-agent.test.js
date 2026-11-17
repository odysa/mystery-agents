// 用一个本地假的 OpenAI 兼容服务器测试大模型智能体的完整链路（不花钱、不联网）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GameRunner } from '../src/runner.js';
import { LLMAgent, buildPrompt, parseAction } from '../src/agents/llm.js';
import { OpenAICompatProvider } from '../src/agents/providers.js';
import { loadScenario } from '../src/engine/scenario.js';
import { Game } from '../src/engine/game.js';

const sc = loadScenario('yuye-yaohuo');

function fakeLLM(handler) {
  return new Promise((resolve) => {
    const prompts = [];
    const srv = createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const body = JSON.parse(b);
        prompts.push(body.messages);
        const content = handler(body.messages, prompts.length);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ model: 'fake', choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, prompts, url: `http://127.0.0.1:${srv.address().port}/v1` }));
  });
}

// 一个「笨」模型：根据提示里的可用动作给出合法 JSON
function naiveModel(messages) {
  const u = messages[1].content;
  const allowed = u.match(/(?:可用动作|Allowed actions)[：:] ?(.*)/)[1].split(', ');
  const ids = [...u.matchAll(/^- (\w+)[：:]/gm)].map((m) => m[1]);
  const locs = ids.filter((x) => ['studio', 'kiln', 'library', 'garden'].includes(x));
  const chars = ids.filter((x) => !locs.includes(x));
  let action = allowed[0];
  if (allowed.includes('SPEAK')) action = 'SPEAK';
  const out = { thought: '先看看', action, target: chars[0] || '', location: locs[0] || 'studio', clue_id: '', text: '我觉得大家都要说清楚自己的行踪。', suspicion: Object.fromEntries(chars.map((c) => [c, 20])) };
  if (action === 'VOTE') out.target = chars.includes('lu_yuan') ? 'lu_yuan' : chars[0];
  return JSON.stringify(out);
}

test('解析模型输出', () => {
  const p = parseAction('好的：```json\n{"action":"question","target":"lu_yuan","text":"你在哪？","thought":"x","suspicion":{}}\n```');
  assert.equal(p.action.type, 'QUESTION');
  assert.equal(p.action.target, 'lu_yuan');
});

test('提示词只包含本角色的剧本，不含他人剧本与真相', () => {
  const g = new Game(sc, { id: 'p', seed: 1 }); g.start();
  const pid = g.currentActor();
  const { system, user, schema } = buildPrompt(g.observe(pid));
  const all = system + user;
  for (const c of sc.characters) {
    if (c.id === pid) assert.ok(all.includes(c.script.slice(0, 30)));
    else assert.ok(!all.includes(c.script.slice(0, 30)), `泄漏了 ${c.id} 的剧本`);
  }
  assert.ok(!all.includes(sc.truth.summary.slice(0, 20)));
  assert.deepEqual(Object.keys(schema.properties.suspicion.properties).sort(), sc.characters.map((c) => c.id).filter((x) => x !== pid).sort());
});

test('大模型智能体（OpenAI 兼容接口）可以完成整局', async () => {
  const { srv, prompts, url } = await fakeLLM(naiveModel);
  try {
    process.env.OPENAI_BASE_URL = url;
    process.env.OPENAI_API_KEY = 'test';
    const seats = Object.fromEntries(sc.characters.map((c) => [c.id, 'openai']));
    const r = new GameRunner({ id: 'llm1', scenarioId: sc.id, seed: 11, seats, speedMs: 0 });
    const g = await r.runToEnd();
    assert.equal(g.state.phase, 'ended');
    assert.ok(prompts.length > 20);
    const decisions = g.events.filter((e) => e.type === 'agent_decision');
    assert.ok(decisions.some((d) => d.data.provider === 'openai' && d.data.raw && d.data.promptVersion));
    assert.ok(decisions.every((d) => d.vis === 'system'));
  } finally { srv.close(); delete process.env.OPENAI_BASE_URL; delete process.env.OPENAI_API_KEY; }
});

test('模型输出非法时先自我纠正，再失败则退回规则型智能体', async () => {
  let n = 0;
  const { srv, url } = await fakeLLM((messages) => { n++; return n === 1 ? 'not json at all' : naiveModel(messages); });
  const bad = await fakeLLM(() => '{"action":"VOTE","target":"nobody"}');
  try {
    const g = new Game(sc, { id: 'fix', seed: 2 }); g.start();
    for (const pid of [...g.state.turnOrder]) g.submit(pid, { type: 'READY' });
    const pid = g.currentActor();
    const agent = new LLMAgent({ scenario: sc, pid, provider: new OpenAICompatProvider({ baseUrl: url, apiKey: 'x', model: 'm' }) });
    const d = await agent.decide(g.observe(pid), { validate: (a) => g.validate(pid, a) });
    assert.equal(d.meta.attempts, 2, '第二次输出合法');
    const agent2 = new LLMAgent({ scenario: sc, pid, provider: new OpenAICompatProvider({ baseUrl: bad.url, apiKey: 'x', model: 'm' }) });
    const d2 = await agent2.decide(g.observe(pid), { validate: (a) => g.validate(pid, a) });
    assert.equal(d2.meta.provider, 'openai→rule');
    assert.equal(g.validate(pid, d2.action), null, '回退动作必须合法');
  } finally { srv.close(); bad.srv.close(); }
});
