// 批量模拟：给定剧本与智能体配置，跑 N 局 AI 对局并汇总指标。sim CLI、投稿试玩与测试共用。
import { GameRunner } from './runner.js';
import { auditObservation } from './engine/audit.js';
import { gameMetrics, aggregate } from './metrics.js';

/**
 * @param {object} scenario   已校验的剧本对象
 * @param {object} opts
 *   games, seed, agents（默认 'rule'）, murdererAgent, webhookUrl（agents 为 webhook 时）, onGame(metrics, i)
 */
export async function simulate(scenario, { games = 20, seed = 1, agents = 'rule', murdererAgent = agents, webhookUrl, onGame, lang = 'zh' } = {}) {
  const results = [];
  let leaks = 0;
  for (let i = 0; i < games; i++) {
    const seats = Object.fromEntries(scenario.characters.map((c) => [c.id, c.isMurderer ? murdererAgent : agents]));
    const webhooks = webhookUrl ? Object.fromEntries(Object.entries(seats).filter(([, k]) => k === 'webhook').map(([p]) => [p, webhookUrl])) : undefined;
    const runner = new GameRunner({ id: `sim_${seed + i}`, scenarioId: scenario.id, scenarioData: scenario, seed: seed + i, seats, webhooks, speedMs: 0, lang });
    // 每个阶段切换时审计所有玩家的观察
    runner.game.onEvent((e) => {
      if (e.type !== 'phase_changed') return;
      for (const pid of runner.game.charIds) leaks += auditObservation(runner.game, pid).length;
    });
    const g = await runner.runToEnd();
    const m = gameMetrics(g);
    results.push(m);
    onGame?.(m, i, seed + i);
  }
  return {
    report: { scenario: scenario.id, lang, agents, murdererAgent, seeds: [seed, seed + games - 1], ...aggregate(results), accessControlViolations: leaks },
    games: results,
  };
}
