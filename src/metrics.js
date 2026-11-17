// 单局评测指标（对应研究计划 §7.1）。全部基于结构化事件日志计算，可离线复算。
export function gameMetrics(game) {
  const sc = game.scenario;
  const ev = game.events;
  const res = game.state.result;
  const murderer = sc.truth.murderer;
  const detectives = sc.characters.filter((c) => !c.isMurderer).map((c) => c.id);
  const decisions = ev.filter((e) => e.type === 'agent_decision');
  const rejected = ev.filter((e) => e.type === 'action_rejected');
  const playerActions = ev.filter((e) => ['ready', 'passed', 'searched', 'spoke', 'questioned', 'responded', 'accused', 'voted'].includes(e.type) || (e.type === 'evidence_shared' && !e.data.withResponse));
  const found = ev.filter((e) => e.type === 'clue_found');
  const usefulFound = found.filter((e) => e.data.clue && Object.keys(sc.clues.find((c) => c.id === e.data.clue.id).implicates || {}).length);
  const keyIds = new Set(sc.clues.filter((c) => c.key).map((c) => c.id));
  const publicKey = Object.keys(game.state.publicClues).filter((id) => keyIds.has(id));

  return {
    completed: game.ended,
    convicted: res?.convicted ?? null,
    goodWin: !!res?.goodWin,
    detectiveVoteAccuracy: detectives.filter((d) => game.state.votes[d] === murderer).length / detectives.length,
    ruleViolationRate: rejected.length / Math.max(1, playerActions.length + rejected.length),
    llmFallbacks: decisions.filter((d) => String(d.data.provider || '').includes('→rule')).length,
    decisions: decisions.length,
    cluesFound: found.filter((e) => e.data.clue).length,
    investigationEfficiency: usefulFound.length / Math.max(1, found.length),
    cluesPublic: Object.keys(game.state.publicClues).length,
    keyCluesPublic: publicKey.length,
    sideObjectives: Object.fromEntries(Object.entries(res?.players || {}).map(([pid, p]) => [pid, p.objectives.filter((o) => !['find_murderer', 'escape'].includes(o.type)).every((o) => o.done)])),
    tokens: decisions.reduce((s, d) => s + (d.data.usage?.input || 0) + (d.data.usage?.output || 0), 0),
  };
}

export function aggregate(list) {
  const n = list.length;
  const mean = (f) => list.reduce((s, m) => s + f(m), 0) / Math.max(1, n);
  const sd = (f) => { const mu = mean(f); return Math.sqrt(list.reduce((s, m) => s + (f(m) - mu) ** 2, 0) / Math.max(1, n - 1)); };
  const ci = (f) => 1.96 * sd(f) / Math.sqrt(Math.max(1, n));
  const side = {};
  for (const m of list) for (const [pid, ok] of Object.entries(m.sideObjectives)) side[pid] = (side[pid] || 0) + (ok ? 1 : 0) / n;
  return {
    games: n,
    completionRate: mean((m) => +m.completed),
    goodTeamWinRate: mean((m) => +m.goodWin), goodTeamWinRateCI95: ci((m) => +m.goodWin),
    detectiveVoteAccuracy: mean((m) => m.detectiveVoteAccuracy), detectiveVoteAccuracyCI95: ci((m) => m.detectiveVoteAccuracy),
    ruleViolationRate: mean((m) => m.ruleViolationRate),
    investigationEfficiency: mean((m) => m.investigationEfficiency),
    avgCluesPublic: mean((m) => m.cluesPublic),
    avgKeyCluesPublic: mean((m) => m.keyCluesPublic),
    sideObjectiveRate: side,
    totalTokens: list.reduce((s, m) => s + m.tokens, 0),
  };
}
