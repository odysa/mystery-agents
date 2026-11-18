// MCP 端点（Streamable HTTP，零依赖）：让 Claude Code、Cursor 等客户端一条命令接入。
//   claude mcp add --transport http mystery-agents http://<服务器>/mcp
// 每个工具都只是调用本服务器的公开 HTTP API，所以 MCP 和 HTTP 两种接入的权限完全一致。
import { agentGuide } from './agent-docs.js';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'list_scenarios',
    description: '列出所有剧本（id、标题、人数、难度）。List all murder-mystery scenarios.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_scenario',
    description: '查看某个剧本的公开信息：背景、角色 id 与公开简介、地点。Public info of one scenario (character ids for seating).',
    inputSchema: { type: 'object', properties: { scenarioId: { type: 'string' } }, required: ['scenarioId'] },
  },
  {
    name: 'list_open_seats',
    description: '列出别人开的、等待 Agent 加入的空位。List open seats waiting for an agent.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'join_game',
    description: '认领一局里的空位，返回你的角色和 token。Claim an open seat and get your token.',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' }, pid: { type: 'string', description: '可选：指定角色 id' }, agentName: { type: 'string', description: '你的名字，会显示给其他玩家' } }, required: ['gameId'] },
  },
  {
    name: 'create_game',
    description: '开一局。mySeats 里的角色由你扮演（返回 token）；openSeats 留给别的 Agent；humanSeats 留给浏览器里的真人；其余由内置 AI 扮演。Create a game.',
    inputSchema: {
      type: 'object',
      properties: {
        scenarioId: { type: 'string' },
        mySeats: { type: 'array', items: { type: 'string' }, description: '你要扮演的角色 id；省略则扮演第一个角色' },
        openSeats: { type: 'array', items: { type: 'string' } },
        humanSeats: { type: 'array', items: { type: 'string' } },
        others: { type: 'string', description: '其余座位的内置 AI：rule（默认）/ claude / openai' },
        lang: { type: 'string', enum: ['zh', 'en'], description: '对局语言 game language' },
      },
      required: ['scenarioId'],
    },
  },
  {
    name: 'wait_turn',
    description: '等到轮到你（最长 timeoutSec 秒），返回纯文本观察：剧本、线索、新事件、允许的动作与示例。第一次不传 since 读完整剧本，之后传返回里提示的 since 只看新事件。Wait for your turn.',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' }, token: { type: 'string' }, since: { type: 'integer' }, timeoutSec: { type: 'integer', default: 30 } }, required: ['gameId', 'token'] },
  },
  {
    name: 'act',
    description: '提交一个动作，例如 {"type":"SPEAK","text":"……"}。非法动作会返回原因。Submit an action.',
    inputSchema: { type: 'object', properties: { gameId: { type: 'string' }, token: { type: 'string' }, action: { type: 'object' } }, required: ['gameId', 'token', 'action'] },
  },
  {
    name: 'get_format',
    description: '获取 OpenMystery 剧本格式规范、JSON Schema 地址和示例剧本地址，写剧本前先读。Get the scenario format spec.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_scenario',
    description: '校验剧本 JSON，返回错误、难度体检和内置 AI 试玩结果，不保存。Validate and trial-run a scenario.',
    inputSchema: { type: 'object', properties: { scenario: { type: 'object' } }, required: ['scenario'] },
  },
  {
    name: 'submit_scenario',
    description: '发布剧本到社区剧本库（会先校验并试玩）。Publish a scenario.',
    inputSchema: { type: 'object', properties: { scenario: { type: 'object' } }, required: ['scenario'] },
  },
];

async function readJson(req) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > 2e6) throw new Error('请求太大'); }
  return b ? JSON.parse(b) : null;
}

export async function handleMcp(req, res, { publicBase, internalBase, lang = 'zh' }) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }); return res.end();
  }
  let msg;
  try { msg = await readJson(req); } catch (e) { return send(res, 400, rpcError(null, -32700, e.message)); }
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map((m) => dispatch(m, { publicBase, internalBase, lang })))).filter(Boolean);
    return out.length ? send(res, 200, out) : accepted(res);
  }
  const r = await dispatch(msg, { publicBase, internalBase, lang });
  return r ? send(res, 200, r) : accepted(res);
}

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const accepted = (res) => { res.writeHead(202); res.end(); };
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

async function dispatch(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  switch (msg.method) {
    case 'initialize': {
      const v = PROTOCOL_VERSIONS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : PROTOCOL_VERSIONS[0];
      return ok(msg.id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mystery-agents', title: '谜案 MysteryAgents 剧本杀', version: '0.2.0' },
        instructions: agentGuide(ctx.publicBase, ctx.lang),
      });
    }
    case 'ping': return ok(msg.id, {});
    case 'tools/list': return ok(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const { name, arguments: args = {} } = msg.params || {};
      try {
        const text = await callTool(name, args, ctx);
        return ok(msg.id, { content: [{ type: 'text', text }] });
      } catch (e) {
        return ok(msg.id, { content: [{ type: 'text', text: `${ctx.lang === 'en' ? 'Error' : '错误'}: ${e.message}` }], isError: true });
      }
    }
    default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function callTool(name, a, { publicBase, internalBase, lang: endpointLang }) {
  // 开局时显式指定了对局语言，就用它回复（否则跟随 /mcp?lang=）
  const lang = (name === 'create_game' && ['zh', 'en'].includes(a.lang) && a.lang) || endpointLang;
  const z = lang === 'en' ? (zh, en) => en : (zh) => zh;
  const headers = { 'content-type': 'application/json', 'x-ma-lang': lang };
  const api = async (path, body, { raw = false } = {}) => {
    const res = await fetch(internalBase + path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
    const t = await res.text();
    if (!res.ok) { let m = t; try { m = JSON.parse(t).error || (JSON.parse(t).errors || []).join('\n') || t; } catch { /* 纯文本 */ } throw new Error(m); }
    return raw ? t : JSON.parse(t);
  };
  const pretty = (x) => JSON.stringify(x, null, 2);
  const enc = encodeURIComponent;
  switch (name) {
    case 'list_scenarios':
      return (await api('/api/scenarios')).map((s) => z(`- ${s.id}《${s.title}》${s.players} 人 · ${s.difficulty} · ${s.subtitle}`, `- ${s.id} "${s.i18n?.en?.title || s.title}" · ${s.players} players · ${s.difficulty} · languages: ${(s.languages || []).join('/')}`)).join('\n');
    case 'get_scenario': {
      const s = await api(`/api/scenarios/${enc(a.scenarioId)}`);
      return [`${s.title}`, s.background, '', z('角色：', 'Characters:'), ...s.characters.map((c) => `- ${c.id}: ${c.name}, ${c.publicBio}`), '', z('地点：', 'Locations:'), ...s.locations.map((l) => `- ${l.id}: ${l.name}`)].join('\n');
    }
    case 'list_open_seats': {
      const list = await api('/api/open-seats');
      return list.length ? list.map((x) => `- gameId=${x.gameId} [${x.lang}] "${x.title}" ${z('角色', 'character')} ${x.pid} (${x.name}): ${x.publicBio}`).join('\n') : z('现在没有空位。可以用 create_game 自己开一局。', 'No open seats right now. Use create_game to start your own game.');
    }
    case 'join_game': {
      const r = await api(`/api/games/${enc(a.gameId)}/join`, { pid: a.pid, agentName: a.agentName });
      return z(`你已入座：${r.name}（${r.pid}）\ngameId=${r.gameId}\ntoken=${r.token}\n观战链接（可以发给用户）：${r.watchUrl}\n下一步：调用 wait_turn。`, `You are seated as ${r.name} (${r.pid})\ngameId=${r.gameId}\ntoken=${r.token}\nSpectator link (share with your user): ${r.watchUrl}\nNext: call wait_turn.`);
    }
    case 'create_game': {
      const s = await api(`/api/scenarios/${enc(a.scenarioId)}`);
      const ids = s.characters.map((c) => c.id);
      const mine = a.mySeats?.length ? a.mySeats : [ids[0]];
      const seats = {};
      for (const id of ids) {
        seats[id] = mine.includes(id) ? 'external' : a.openSeats?.includes(id) ? 'open' : a.humanSeats?.includes(id) ? 'human' : (a.others || 'rule');
      }
      const r = await api('/api/games', { scenarioId: a.scenarioId, seats, speedMs: 0, lang: a.lang || lang });
      const human = Object.entries(r.tokens).filter(([p]) => seats[p] === 'human');
      return [
        z(`已开局 gameId=${r.id}`, `Game created: gameId=${r.id}`),
        z(`观战链接（发给用户）：${publicBase}/#/watch/${r.id}`, `Spectator link (share with your user): ${publicBase}/#/watch/${r.id}`),
        z('你的座位与 token：', 'Your seats and tokens:'), ...Object.entries(r.tokens).filter(([p]) => seats[p] === 'external').map(([p, t]) => `- ${p}: ${t}`),
        ...(human.length ? [z('真人座位的邀请链接（发给对应的人）：', 'Invite links for human seats (send to each person):'), ...human.map(([p, t]) => `- ${p}: ${publicBase}/#/join/${r.id}/${p}/${t}`)] : []),
        ...(r.open?.length ? [z(`空位（等别的 Agent 用 join_game 加入）：${r.open.join(', ')}`, `Open seats (other agents can join_game): ${r.open.join(', ')}`)] : []),
        z('下一步：对你的每个座位调用 wait_turn。', 'Next: call wait_turn for each of your seats.'),
      ].join('\n');
    }
    case 'wait_turn': {
      const q = `token=${enc(a.token)}&format=text&timeout=${Math.max(1, Math.min(55, a.timeoutSec ?? 30))}${a.since !== undefined ? `&since=${a.since}` : ''}`;
      return api(`/api/games/${enc(a.gameId)}/turn?${q}`, null, { raw: true });
    }
    case 'act': {
      await api(`/api/games/${enc(a.gameId)}/action?token=${enc(a.token)}`, a.action);
      return z('动作已提交。下一步：调用 wait_turn（记得带上 since 只看新事件）。', 'Action submitted. Next: call wait_turn (pass since to see only new events).');
    }
    case 'get_format':
      return [
        `Spec: ${publicBase}/openmystery.md`,
        `JSON Schema：${publicBase}/schema/openmystery-1.schema.json`,
        `Example: ${publicBase}/api/scenarios/yuye-yaohuo/source`,
        '',
        await api('/openmystery.md', null, { raw: true }),
      ].join('\n');
    case 'check_scenario':
    case 'submit_scenario': {
      const res = await fetch(internalBase + (name === 'check_scenario' ? '/api/scenarios/check' : '/api/scenarios'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: a.scenario }),
      });
      const r = await res.json();
      if (r.errors?.length) return z(`❌ 未通过（${res.status}）：`, `❌ Not accepted (${res.status}):`) + `\n- ${r.errors.join('\n- ')}`;
      const head = name === 'submit_scenario' ? z(`✅ 已发布：${publicBase}/#/  （剧本 id：${r.id}）`, `✅ Published: ${publicBase}/#/ (scenario id: ${r.id})`) : z('✅ 校验通过（未保存）', '✅ Valid (not saved)');
      return `${head}\n${z('侦探胜率', 'Detective win rate')} (${r.sim.games} ${z('局试玩', 'trial games')}): ${Math.round(r.sim.goodTeamWinRate * 100)}%\n${z('统计', 'Stats')}: ${pretty(r.stats)}\n${r.warnings.length ? `${z('难度提示', 'Warnings')}:\n- ${r.warnings.join('\n- ')}` : z('没有难度提示。', 'No warnings.')}`;
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}
