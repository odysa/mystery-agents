// 访问控制审计：检查某玩家的观察中是否出现了他无权知道的信息。
// 返回发现的问题列表（空数组 = 没有泄漏）。测试与模拟器都会调用它。
export function auditObservation(game, pid, obs = game.observe(pid)) {
  const problems = [];
  const sc = game.scenario;
  const str = JSON.stringify(obs);
  if (!game.ended) {
    if (str.includes(sc.truth.summary.slice(0, 20))) problems.push('真相摘要泄漏');
    for (const t of sc.truth.timeline) if (str.includes(t.text)) problems.push(`真相时间线泄漏: ${t.text.slice(0, 12)}`);
  }
  for (const c of sc.characters) {
    if (c.id === pid || game.ended) continue; // 终局时所有剧本按规则公开
    if (str.includes(c.script.slice(0, 40))) problems.push(`看到了 ${c.id} 的剧本`);
    for (const k of c.knowledge || []) {
      // 别人的秘密证词，只有在对方亲口说出（出现在公开发言里）时才可见
      if (k.secret && str.includes(k.text)) problems.push(`看到了 ${c.id} 的秘密 ${k.id}`);
    }
  }
  const internal = ['"implicates"', '"requires"', '"roles"', ...(game.ended ? [] : ['"truth"', '"clueOwner"'])];
  for (const key of internal) if (str.includes(key)) problems.push(`观察中包含内部字段 ${key}`);
  for (const e of obs.events) {
    if (e.vis === 'system') problems.push(`看到系统事件 ${e.type}`);
    if (Array.isArray(e.vis) && !e.vis.includes(pid)) problems.push(`看到他人私有事件 ${e.type}#${e.seq}`);
  }
  const mine = new Set(Object.entries(game.state.clueOwner).filter(([, o]) => o === pid).map(([id]) => id));
  for (const c of obs.myClues) if (!mine.has(c.id)) problems.push(`myClues 中有不属于自己的线索 ${c.id}`);
  for (const c of obs.publicClues) if (!game.state.publicClues[c.id]) problems.push(`publicClues 中有未公开线索 ${c.id}`);
  return problems;
}
