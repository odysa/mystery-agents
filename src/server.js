#!/usr/bin/env node
// HTTP 服务器（零依赖）：静态前端 + REST API + SSE 实时推送。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { GameRunner, TOKEN_SEATS } from './runner.js';
import { simulate } from './simulate.js';
import { FileStore } from './store.js';
import { listScenarios, loadScenario, publicScenarioView, validateScenario, lintScenario, findScenario, addScenarioDir, FORMAT, localizeScenario, scenarioLangs } from './engine/scenario.js';
import { availableProviders } from './agents/providers.js';
import { gameMetrics } from './metrics.js';
import { renderObservationText } from './agent-text.js';
import { tr, trMsg, langOf, normLang } from './i18n.js';
import { agentGuide, llmsTxt } from './agent-docs.js';
import { handleMcp } from './mcp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };

const SCHEMA_FILE = join(ROOT, 'schema', 'openjubensha-1.schema.json');
const MAX_COMMUNITY = Number(process.env.MA_MAX_COMMUNITY_SCENARIOS || 500);

export function createApp({
  dataDir = process.env.MA_DATA_DIR || join(ROOT, 'data', 'games'),
  scenarioDir = process.env.MA_SCENARIO_DIR || join(dirname(dataDir), 'scenarios'),
  resume = true,
  allowSubmit = process.env.MA_ALLOW_SUBMIT !== '0',
  allowWebhook = process.env.MA_ALLOW_WEBHOOK === '1',
} = {}) {
  const store = new FileStore(dataDir);
  const runners = new Map();
  // 社区剧本：投稿后存放在这里，和内置剧本一起出现在大厅
  addScenarioDir(scenarioDir);

  // 重启后恢复对局
  if (resume) {
    for (const id of store.list()) {
      try {
        const { meta, events } = store.load(id);
        const r = new GameRunner(meta, { events, store });
        runners.set(id, r);
        if (!r.game.ended) r.loop();
      } catch (e) { console.warn(`无法恢复对局 ${id}: ${e.message}`); }
    }
  }

  const baseOf = (req) => {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0] || 'http';
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1'}`;
  };
  const text = (res, code, body, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(body); };
  const tokenPid = (runner, token) => (token ? Object.entries(runner.meta.tokens || {}).find(([, t]) => t === token)?.[0] : null);
  const openSeats = (r) => (r.game.ended ? [] : (r.meta.open || []));
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  const readBody = (req) => new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });

  function viewerOf(runner, q) {
    const token = q.get('token');
    if (token) {
      const pid = tokenPid(runner, token);
      if (!pid) return { error: '无效的玩家凭证' };
      const joined = (runner.joined ||= new Set());
      if (!joined.has(pid)) { joined.add(pid); setTimeout(() => runner.notify(), 0); }
      return { kind: 'player', pid };
    }
    if (q.get('view') === 'god') {
      if (runner.humans.length && !runner.game.ended) return { error: '有真人玩家的对局在结束前不能使用上帝视角' };
      return { kind: 'god' };
    }
    return { kind: 'spectator' };
  }

  function buildView(runner, viewer) {
    const g = runner.game;
    const base = viewer.kind === 'player' ? g.observe(viewer.pid) : viewer.kind === 'god' ? g.godView() : g.spectate();
    return {
      ...base,
      meta: {
        id: runner.meta.id, seats: runner.meta.seats, paused: runner.paused, speedMs: runner.meta.speedMs,
        thinking: runner.thinking, hasHumans: runner.humans.length > 0, createdAt: runner.meta.createdAt,
        godAllowed: !runner.humans.length || g.ended,
        humans: runner.humans, joined: [...(runner.joined || [])], watchers: runner.watchers || 0,
        open: openSeats(runner), agentNames: runner.meta.agentNames || {}, lang: runner.lang,
      },
      ...(g.ended ? { metrics: gameMetrics(g) } : {}),
    };
  }

  function summary(r) {
    const g = r.game;
    return {
      id: r.meta.id, scenarioId: r.meta.scenarioId, title: r.scenario.title, createdAt: r.meta.createdAt,
      phase: g.state.phase, round: g.state.round, seats: r.meta.seats, ended: g.ended,
      watchers: r.watchers || 0, open: openSeats(r), lang: r.lang,
      result: g.ended ? { convicted: g.state.result.convicted, goodWin: g.state.result.goodWin } : null,
    };
  }

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const q = url.searchParams;
    const L = langOf(req, q);
    const t = (zh, vars) => tr(L, zh, vars);
    if (req.method === 'GET' && parts[1] === 'format') {
      return json(res, 200, { format: FORMAT, agentProtocol: 'openjubensha-agent/1', schema: JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) });
    }
    if (req.method === 'POST' && parts[1] === 'scenarios' && (parts[2] === 'check' || !parts[2])) {
      if (!allowSubmit) return json(res, 403, { error: t('这台服务器关闭了剧本投稿（MA_ALLOW_SUBMIT=0）') });
      const body = await readBody(req);
      const sc = body.scenario;
      const errors = validateScenario(sc).map((e) => trMsg(L, e));
      if (errors.length) return json(res, 422, { ok: false, errors });
      const existing = findScenario(sc.id);
      const lint = lintScenario(sc);
      // 用离线规则型 AI 试玩若干局，估计难度并确认引擎能跑通
      const games = Math.max(1, Math.min(50, Number(body.games) || 30));
      const { report } = await simulate(sc, { games, seed: 1 });
      const result = { ok: true, errors: [], warnings: lint.warnings.map((w) => trMsg(L, w)), stats: lint.stats, sim: report, idTaken: !!existing };
      if (parts[2] === 'check') return json(res, 200, result);
      // 发布
      if (existing) return json(res, 409, { ...result, ok: false, errors: [t('剧本 id「{id}」已被占用，请换一个 id', { id: sc.id })] });
      if (report.accessControlViolations > 0 || report.completionRate < 1) return json(res, 422, { ...result, ok: false, errors: [t('试玩未能正常完成，暂不接受发布')] });
      mkdirSync(scenarioDir, { recursive: true });
      if (readdirSync(scenarioDir).length >= MAX_COMMUNITY) return json(res, 507, { ...result, ok: false, errors: [t('社区剧本数量已达上限')] });
      const saved = { format: FORMAT, ...sc, submittedAt: new Date().toISOString() };
      writeFileSync(join(scenarioDir, `${sc.id}.json`), JSON.stringify(saved, null, 2));
      return json(res, 201, { ...result, id: sc.id });
    }
    if (req.method === 'GET' && parts[1] === 'scenarios' && parts[2] && parts[3] === 'source') {
      // 只开放内置剧本的源文件（仓库里本来就公开），作为投稿模板；社区剧本不提供，避免剧透
      const f = findScenario(parts[2]);
      if (!f || f.source !== 'builtin') return json(res, 404, { error: t('只能下载内置剧本作为模板') });
      return json(res, 200, JSON.parse(readFileSync(f.file, 'utf8')));
    }
    if (req.method === 'GET' && parts[1] === 'scenarios' && parts[2]) {
      try { const raw = loadScenario(parts[2]); return json(res, 200, { ...publicScenarioView(localizeScenario(raw, L)), source: findScenario(parts[2])?.source, languages: scenarioLangs(raw), lang: L }); } catch { return json(res, 404, { error: t('剧本不存在') }); }
    }
    if (req.method === 'GET' && parts[1] === 'scenarios') return json(res, 200, listScenarios());
    if (req.method === 'GET' && parts[1] === 'providers') return json(res, 200, await availableProviders(L));
    if (req.method === 'GET' && parts[1] === 'open-seats') {
      const out = [];
      for (const r of runners.values()) {
        for (const pid of openSeats(r)) {
          const c = r.scenario.characters.find((x) => x.id === pid);
          out.push({ gameId: r.meta.id, scenarioId: r.meta.scenarioId, lang: r.lang, title: r.scenario.title, pid, name: c.name, publicBio: c.publicBio, players: r.scenario.characters.length, createdAt: r.meta.createdAt, joinUrl: `${baseOf(req)}/api/games/${r.meta.id}/join` });
        }
      }
      return json(res, 200, out.sort((a, b) => b.createdAt - a.createdAt));
    }
    if (parts[1] !== 'games') return json(res, 404, { error: t('未找到') });

    if (parts.length === 2 && req.method === 'GET') {
      return json(res, 200, [...runners.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt));
    }
    if (parts.length === 2 && req.method === 'POST') {
      const body = await readBody(req);
      const scenarioId = body.scenarioId || 'yuye-yaohuo';
      let sc;
      try { sc = loadScenario(scenarioId); } catch (e) { return json(res, 400, { error: e.message }); }
      const providers = Object.fromEntries((await availableProviders(L)).map((p) => [p.id, p]));
      const seats = {};
      const webhooks = {};
      for (const c of sc.characters) {
        const k = body.seats?.[c.id] || 'rule';
        if (k === 'webhook') {
          // 服务器会主动请求这个 URL，公开部署时有 SSRF 风险，所以默认关闭
          if (!allowWebhook) return json(res, 403, { error: t('webhook 智能体默认关闭，启动服务器时设置 MA_ALLOW_WEBHOOK=1 开启；也可以用 external 座位通过 HTTP 拉取观察') });
          const u = body.webhooks?.[c.id];
          if (!/^https?:\/\/\S+$/.test(String(u || ''))) return json(res, 400, { error: t('{name} 的 webhook URL 无效', { name: c.name }) });
          webhooks[c.id] = u;
        } else if (k !== 'open' && !TOKEN_SEATS.includes(k) && !providers[k]?.ready) {
          return json(res, 400, { error: t('{name} 的智能体「{kind}」当前不可用：{hint}', { name: c.name, kind: k, hint: providers[k]?.hint || t('未知类型') }) });
        }
        seats[c.id] = k;
      }
      // 空位：先当作外部智能体座位，等任何人的 Agent 通过 /join 认领
      const open = Object.keys(seats).filter((p) => seats[p] === 'open');
      for (const p of open) seats[p] = 'external';
      const id = `g_${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
      const tokens = Object.fromEntries(Object.entries(seats).filter(([, k]) => TOKEN_SEATS.includes(k)).map(([pid]) => [pid, randomBytes(12).toString('hex')]));
      const meta = {
        id, scenarioId, lang: normLang(body.lang) || L, seed: Number.isFinite(body.seed) ? body.seed : Math.floor(Math.random() * 1e9),
        seats, ...(Object.keys(webhooks).length ? { webhooks } : {}), ...(open.length ? { open } : {}), agentNames: {}, tokens, hostToken: randomBytes(12).toString('hex'), speedMs: Number.isFinite(body.speedMs) ? body.speedMs : 1200, createdAt: Date.now(), paused: false,
      };
      store.saveMeta(meta);
      const r = new GameRunner(meta, { store });
      runners.set(id, r);
      r.start();
      // 空位的 token 不发给创建者，只发给来认领的 Agent
      const given = Object.fromEntries(Object.entries(tokens).filter(([p]) => !open.includes(p)));
      return json(res, 201, { id, tokens: given, hostToken: meta.hostToken, open, watchUrl: `${baseOf(req)}/#/watch/${id}`, agentGuide: `${baseOf(req)}/agent.md` });
    }

    const runner = runners.get(parts[2]);
    if (!runner) return json(res, 404, { error: t('对局不存在') });
    const sub = parts[3];

    if (sub === 'join' && req.method === 'POST') {
      const body = await readBody(req);
      const open = openSeats(runner);
      if (!open.length) return json(res, 409, { error: t('这局没有空位了') });
      const pid = body.pid ? (open.includes(body.pid) ? body.pid : null) : open[0];
      if (!pid) return json(res, 409, { error: t('角色 {pid} 不是空位，可选：{list}', { pid: body.pid, list: open.join(', ') }) });
      runner.meta.open = open.filter((p) => p !== pid);
      runner.meta.agentNames = { ...(runner.meta.agentNames || {}), [pid]: String(body.agentName || 'Agent').slice(0, 40) };
      store.saveMeta(runner.meta);
      runner.notify();
      const c = runner.scenario.characters.find((x) => x.id === pid);
      const base = baseOf(req);
      return json(res, 200, {
        gameId: runner.meta.id, pid, name: c.name, token: runner.meta.tokens[pid],
        next: `${base}/api/games/${runner.meta.id}/turn?token=${runner.meta.tokens[pid]}&format=text&timeout=30`,
        act: `POST ${base}/api/games/${runner.meta.id}/action?token=${runner.meta.tokens[pid]}`,
        guide: `${base}/agent.md`, watchUrl: `${base}/#/watch/${runner.meta.id}`,
      });
    }
    if (sub === 'view' && req.method === 'GET') {
      const v = viewerOf(runner, q); if (v.error) return json(res, 403, { error: t(v.error) });
      if (q.get('format') === 'text' && v.kind === 'player') return text(res, 200, renderObservationText(buildView(runner, v), { since: Number(q.get('since') || 0), full: !q.get('since'), lang: runner.lang }));
      return json(res, 200, buildView(runner, v));
    }
    if (sub === 'turn' && req.method === 'GET') {
      // 长轮询：一直等到轮到该玩家行动（或对局结束、超时）再返回观察。给外部智能体用。
      const v = viewerOf(runner, q); if (v.error) return json(res, 403, { error: t(v.error) });
      if (v.kind !== 'player') return json(res, 400, { error: t('需要玩家凭证 token') });
      const timeoutMs = Math.max(0, Math.min(60000, Number(q.get('timeout') ?? 30) * 1000));
      const ready = () => runner.game.ended || runner.game.currentActor() === v.pid;
      const reply = () => {
        const view = buildView(runner, v);
        const yourTurn = !runner.game.ended && runner.game.currentActor() === v.pid;
        if (q.get('format') === 'text') {
          const since = Number(q.get('since') || 0);
          const head = yourTurn || runner.game.ended ? '' : `${tr(runner.lang, '（还没轮到你：再次请求本地址继续等待）')}\n`;
          return text(res, 200, head + renderObservationText(view, { since, full: !q.get('since'), lang: runner.lang }));
        }
        return json(res, 200, { yourTurn, ...view });
      };
      if (ready()) return reply();
      await new Promise((resolve) => {
        let off = () => {};
        const done = () => { off(); clearTimeout(t); resolve(); };
        off = runner.onChange(() => { if (ready()) done(); });
        const t = setTimeout(done, timeoutMs);
        req.on('close', done);
      });
      if (!res.writableEnded && !req.destroyed) reply();
      return;
    }
    if (sub === 'stream' && req.method === 'GET') {
      const v = viewerOf(runner, q); if (v.error) return json(res, 403, { error: t(v.error) });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      let timer = null;
      const push = () => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; res.write(`event: view\ndata: ${JSON.stringify(buildView(runner, v))}\n\n`); }, 60);
      };
      runner.watchers = (runner.watchers || 0) + (v.kind === 'player' ? 0 : 1);
      if (v.kind !== 'player') runner.notify();
      push();
      const off = runner.onChange(push);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        off(); clearInterval(ping); clearTimeout(timer);
        if (v.kind !== 'player') { runner.watchers--; runner.notify(); }
      });
      return;
    }
    if (sub === 'action' && req.method === 'POST') {
      const body = await readBody(req);
      // 两种写法都接受：{token, action} 或 ?token=... + 请求体直接是动作
      const pid = tokenPid(runner, body.token || q.get('token'));
      if (!pid) return json(res, 403, { error: t('无效的玩家凭证') });
      const action = body.action || (body.type ? body : null);
      if (!action) return json(res, 400, { error: t('缺少 action，例如 {"type":"SPEAK","text":"……"}') });
      const r = runner.submitHuman(pid, action);
      return json(res, r.ok ? 200 : 400, r);
    }
    if (sub === 'control' && req.method === 'POST') {
      const body = await readBody(req);
      if (runner.meta.hostToken && body.hostToken !== runner.meta.hostToken) return json(res, 403, { error: t('只有创建对局的人才能暂停或调整速度') });
      if (runner.humans.length && body.op !== 'speed') return json(res, 403, { error: t('有真人玩家的对局不能暂停') });
      if (body.op === 'pause') runner.setPaused(true);
      else if (body.op === 'resume') runner.setPaused(false);
      else if (body.op === 'speed' && Number.isFinite(body.speedMs)) { runner.meta.speedMs = Math.max(0, Math.min(10000, body.speedMs)); store.saveMeta(runner.meta); runner.notify(); }
      else return json(res, 400, { error: t('未知操作') });
      return json(res, 200, { ok: true });
    }
    if (sub === 'log' && req.method === 'GET') {
      if (runner.humans.length && !runner.game.ended) return json(res, 403, { error: t('对局结束后才能下载完整日志') });
      const { tokens, hostToken, webhooks, ...meta } = runner.meta;
      return json(res, 200, { meta, events: runner.game.events, metrics: runner.game.ended ? gameMetrics(runner.game) : null });
    }
    return json(res, 404, { error: t('未找到') });
  }

  function serveStatic(req, res, url) {
    // 开放格式的 JSON Schema 也作为静态文件提供，方便编辑器引用
    if (url.pathname === '/schema/openjubensha-1.schema.json') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'access-control-allow-origin': '*' });
      return res.end(readFileSync(SCHEMA_FILE));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    const file = join(PUBLIC, p);
    if (!file.startsWith(PUBLIC) || !existsSync(file) || statSync(file).isDirectory()) {
      // 单页应用：未知路径回到首页
      res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(readFileSync(join(PUBLIC, 'index.html')));
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/agent.md' || url.pathname === '/AGENTS.md') return text(res, 200, agentGuide(baseOf(req), langOf(req, url.searchParams)), 'text/markdown; charset=utf-8');
      if (url.pathname === '/llms.txt') return text(res, 200, llmsTxt(baseOf(req), langOf(req, url.searchParams)));
      if (url.pathname === '/openjubensha.md') return text(res, 200, readFileSync(join(ROOT, 'docs', 'openjubensha.md'), 'utf8'), 'text/markdown; charset=utf-8');
      if (url.pathname === '/mcp') {
        const port = server.address().port;
        return await handleMcp(req, res, { publicBase: baseOf(req), internalBase: `http://127.0.0.1:${port}`, lang: normLang(url.searchParams.get('lang')) || 'zh' });
      }
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e.message });
    }
  });
  return { server, runners, store };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const { server } = createApp();
  server.listen(port, host, () => {
    console.log(`\n  🕯️  MysteryAgents 剧本杀平台已启动`);
    console.log(`  ➜  http://${host}:${port}\n`);
  });
}
