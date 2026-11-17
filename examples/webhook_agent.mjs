#!/usr/bin/env node
// Webhook 智能体示例（Node，零依赖）：平台每次轮到该角色时 POST 观察过来，这里返回一个动作。
// 协议：openmystery-agent/1（见 docs/agent-api.md）
//
//   node examples/webhook_agent.mjs 8787
//   npm run sim -- --agents webhook --webhook-url http://127.0.0.1:8787 --games 5
//   # 或者只让它演凶手、其余是规则型 AI：
//   npm run sim -- --agents rule --murderer-agent webhook --webhook-url http://127.0.0.1:8787
import { createServer } from 'node:http';

function decide(obs) {
  const { allowed, you, locations, myClues, accusations, scenario } = obs;
  const others = scenario.characters.map((c) => c.id).filter((id) => id !== you.id);
  if (allowed.includes('READY')) return { type: 'READY' };
  if (allowed.includes('INVESTIGATE')) {
    const spots = locations.filter((l) => l.remaining > 0);
    return { type: 'INVESTIGATE', location: (spots[0] || locations[0]).id };
  }
  if (allowed.includes('RESPOND')) return { type: 'RESPOND', text: you.coverStory || '我没什么好隐瞒的。' };
  if (allowed.includes('VOTE')) {
    const n = (p) => accusations.filter((a) => a.to === p).length;
    return { type: 'VOTE', target: others.sort((a, b) => n(b) - n(a))[0] };
  }
  const unshared = myClues.filter((c) => !c.public);
  if (unshared.length && !you.isMurderer) return { type: 'SHARE_EVIDENCE', clue_id: unshared[0].id };
  return { type: 'SPEAK', text: you.coverStory || '我还在整理线索。' };
}

const port = Number(process.argv[2] || 8787);
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const msg = JSON.parse(body || '{}');
    // msg = { protocol, pid, gameId, allowed, observation, retry? }；retry 里有上次被拒绝的原因
    const action = decide(msg.observation);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ action, thought: '示例智能体：按固定策略行动' }));
  });
}).listen(port, '127.0.0.1', () => console.log(`webhook 智能体监听 http://127.0.0.1:${port}`));
