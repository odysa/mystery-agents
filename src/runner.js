// 对局运行器：驱动 AI 回合、等待人类回合、记录每一次智能体决策，并把事件持久化。
import { Game } from './engine/game.js';
import { loadScenario, localizeScenario } from './engine/scenario.js';
import { tr } from './i18n.js';
import { RuleAgent } from './agents/rule.js';
import { LLMAgent } from './agents/llm.js';
import { makeProvider } from './agents/providers.js';
import { WebhookAgent } from './agents/webhook.js';

/** 由外部（浏览器里的人，或通过 HTTP 拉取观察的外部智能体）操作的座位，凭 token 行动。 */
export const TOKEN_SEATS = ['human', 'external'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeAgent(kind, { scenario, pid, seed, url, lang = 'zh' }) {
  if (kind === 'rule') return new RuleAgent({ scenario, pid, seed, lang });
  if (kind === 'webhook') {
    if (!url) throw new Error(`座位 ${pid} 是 webhook 智能体，但没有提供 URL`);
    return new WebhookAgent({ scenario, pid, seed, url, lang });
  }
  return new LLMAgent({ scenario, pid, seed, lang, provider: makeProvider(kind) });
}

export class GameRunner {
  /**
   * meta: { id, scenarioId, scenarioData?, seed, seats: {pid: 'human'|'external'|'rule'|'claude'|'openai'|'webhook'}, webhooks?: {pid: url}, tokens, speedMs }
   * scenarioData 仅用于模拟（不落盘的临时剧本，例如投稿试玩）。
   */
  constructor(meta, { events = null, store = null } = {}) {
    this.meta = meta;
    // 一局只用一种语言：剧本按 meta.lang 本地化（没有该语言的翻译时用原文）
    this.lang = meta.lang || 'zh';
    this.scenario = localizeScenario(meta.scenarioData || loadScenario(meta.scenarioId), this.lang);
    const gm = { id: meta.id, seed: meta.seed, createdAt: meta.createdAt, lang: this.lang };
    this.game = events ? Game.fromEvents(this.scenario, gm, events) : new Game(this.scenario, gm);
    this.store = store;
    this.agents = {};
    for (const [pid, kind] of Object.entries(meta.seats)) {
      if (!TOKEN_SEATS.includes(kind)) this.agents[pid] = makeAgent(kind, { scenario: this.scenario, pid, seed: meta.seed, url: meta.webhooks?.[pid], lang: this.lang });
    }
    this.paused = !!meta.paused;
    this.running = false;
    this.thinking = null; // 正在思考的 AI
    this.listeners = new Set();
    this.persisted = this.game.events.length;
    this.game.onEvent(() => this.flushSoon());
  }

  /** 凭 token 操作的座位（真人或外部智能体）。有这类座位时，结束前禁止上帝视角与暂停。 */
  get humans() { return Object.entries(this.meta.seats).filter(([, k]) => TOKEN_SEATS.includes(k)).map(([p]) => p); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) fn(); }

  flushSoon() {
    if (this._flushTimer) return;
    this._flushTimer = setImmediate(() => {
      this._flushTimer = null;
      const fresh = this.game.events.slice(this.persisted);
      this.persisted = this.game.events.length;
      if (this.store && fresh.length) this.store.append(this.meta.id, fresh);
      this.notify();
    });
  }

  start() {
    if (this.game.state.phase === 'lobby') this.game.start();
    this.loop();
  }

  setPaused(p) { this.paused = p; this.meta.paused = p; this.store?.saveMeta(this.meta); this.notify(); if (!p) this.loop(); }

  /** 人类提交动作 */
  submitHuman(pid, action) {
    if (!TOKEN_SEATS.includes(this.meta.seats[pid])) return { ok: false, error: tr(this.lang, '该座位由内置 AI 控制') };
    const r = this.game.submit(pid, action);
    if (r.ok) this.loop();
    return r;
  }

  async step() {
    const g = this.game;
    const pid = g.currentActor();
    if (!pid || TOKEN_SEATS.includes(this.meta.seats[pid])) return false;
    const agent = this.agents[pid];
    const obs = g.observe(pid);
    this.thinking = pid; this.notify();
    const t0 = Date.now();
    let decision;
    try {
      decision = await agent.decide(obs, { validate: (a) => g.validate(pid, a) });
    } catch (e) {
      decision = { action: { type: 'PASS' }, meta: { provider: agent.kind, error: e.message } };
    }
    this.thinking = null;
    // 记录决策（仅系统可见），供回放、调试与评测使用
    g.emit('agent_decision', pid, {
      action: decision.action, ...decision.meta, latencyMs: Date.now() - t0,
    }, 'system');
    let r = g.submit(pid, decision.action);
    if (!r.ok) {
      const fb = await new RuleAgent({ scenario: this.scenario, pid, seed: this.meta.seed + g.events.length, lang: this.lang }).decide(g.observe(pid));
      r = g.submit(pid, fb.action);
      if (!r.ok) g.submit(pid, { type: g.allowedActions(pid).includes('PASS') ? 'PASS' : g.allowedActions(pid)[0], target: g.charIds.find((c) => c !== pid), text: '……' });
    }
    return true;
  }

  async loop() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.game.ended && !this.paused) {
        const progressed = await this.step();
        if (!progressed) break;
        const delay = this.meta.speedMs ?? 0;
        if (delay > 0) await sleep(delay);
      }
    } finally {
      this.running = false;
      this.flushSoon();
    }
  }

  /** 运行直到结束（用于模拟与测试）。 */
  async runToEnd() {
    this.start();
    while (!this.game.ended) {
      if (this.running) { await sleep(5); continue; }
      const p = this.game.currentActor();
      if (TOKEN_SEATS.includes(this.meta.seats[p])) throw new Error('runToEnd 不能用于有真人或外部智能体的对局');
      await this.loop();
    }
    return this.game;
  }
}
