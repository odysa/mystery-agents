// Webhook 智能体：每次轮到该角色时，把观察 POST 给外部服务，由对方返回动作。
// 协议见 docs/agent-api.md（openjubensha-agent/1）。任何语言写的智能体都能这样接入。
import { RuleAgent } from './rule.js';

export const AGENT_PROTOCOL = 'openjubensha-agent/1';

export class WebhookAgent {
  constructor({ url, scenario, pid, seed, lang = 'zh', timeoutMs = Number(process.env.MA_WEBHOOK_TIMEOUT_MS || 60000) }) {
    this.kind = 'webhook';
    this.url = url; this.pid = pid; this.timeoutMs = timeoutMs;
    this.fallback = new RuleAgent({ scenario, pid, seed, lang });
    this.lang = lang;
  }

  async call(body) {
    const res = await fetch(this.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.action !== 'object') throw new Error('响应里缺少 action 对象');
    return data;
  }

  async decide(obs, { validate } = {}) {
    const base = { protocol: AGENT_PROTOCOL, pid: this.pid, lang: this.lang, gameId: obs.gameId, allowed: obs.allowed, observation: obs };
    const attempts = [];
    let error = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await this.call(attempt ? { ...base, retry: { previousAction: attempts.at(-1), error } } : base);
        attempts.push(data.action);
        error = validate ? validate(data.action) : null;
        if (!error) {
          return { action: data.action, meta: { provider: 'webhook', thought: data.thought, suspicion: data.suspicion, attempts: attempt + 1 } };
        }
      } catch (e) { error = e.message; attempts.push(null); }
    }
    const fb = await this.fallback.decide(obs);
    return { action: fb.action, meta: { ...fb.meta, provider: 'webhook→rule', fallbackReason: error, attempts: attempts.length } };
  }
}
