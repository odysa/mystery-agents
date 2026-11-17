// 给智能体看的纯文本观察：比 JSON 省 token，聊天型 Agent 也能直接读懂。
// 内容与 observe(pid) 完全一致（只是换了一种写法），不会多给任何信息。

const pickLang = (lang) => (lang === 'en' ? (zh, en) => en : (zh) => zh);
const KIND = (z) => ({ ready: z('阅读剧本并确认', 'read your script and confirm'), investigate: z('搜证', 'investigate'), discuss: z('发言', 'discuss'), respond: z('回答质询', 'answer a question'), vote: z('投票', 'vote') });

/** 动作示例：只列出当前允许的动作。 */
export function actionExamples(obs, lang = 'zh') {
  const z = pickLang(lang);
  const me = obs.you.id;
  const other = obs.turnOrder.find((p) => p !== me) || 'someone';
  const loc = obs.locations.find((l) => l.remaining > 0)?.id || obs.locations[0]?.id;
  const clue = obs.myClues.find((c) => !c.public)?.id || z('<线索id>', '<clue id>');
  const ex = {
    READY: { type: 'READY' },
    INVESTIGATE: { type: 'INVESTIGATE', location: loc },
    PASS: { type: 'PASS' },
    SPEAK: { type: 'SPEAK', text: z('你的发言（最多 300 字）', 'what you say (max 300 chars)') },
    QUESTION: { type: 'QUESTION', target: other, text: z('你的问题', 'your question') },
    SHARE_EVIDENCE: { type: 'SHARE_EVIDENCE', clue_id: clue, text: z('可选的说明', 'optional comment') },
    ACCUSE: { type: 'ACCUSE', target: other, text: z('指控理由', 'your reasoning') },
    RESPOND: { type: 'RESPOND', text: z('你的回答', 'your answer'), clue_id: z('（可选）出示的线索id', '(optional) clue id to show') },
    VOTE: { type: 'VOTE', target: other, text: z('可选的理由', 'optional reason') },
  };
  return obs.allowed.map((t) => ex[t]);
}

export function renderObservationText(obs, { since = 0, full = true, lang = 'zh' } = {}) {
  const z = pickLang(lang);
  const sc = obs.scenario;
  const name = (id) => sc.characters.find((c) => c.id === id)?.name || (id === sc.victim?.id ? sc.victim.name : id || z('主持人', 'Host'));
  const loc = (id) => sc.locations.find((l) => l.id === id)?.name || id;
  const L = [];
  const me = obs.you;
  const PH = { investigate: z('搜证', 'Investigation'), discuss: z('讨论', 'Discussion'), vote: z('投票', 'Voting'), ended: z('结局', 'Ending') };

  L.push(z(`# 《${sc.title}》 你是：${me.name}（${me.id}）${me.isMurderer ? ' —— 你是凶手' : ''}`, `# "${sc.title}" — you are ${me.name} (${me.id})${me.isMurderer ? ' — YOU ARE THE MURDERER' : ''}`));
  L.push(z(`阶段：${obs.phase}${obs.round ? ` 第 ${obs.round}/${obs.totalRounds} 轮` : ''}；`, `Phase: ${obs.phase}${obs.round ? `, round ${obs.round}/${obs.totalRounds}` : ''}. `) +
    (obs.phase === 'ended' ? z('对局已结束。', 'The game has ended.') : obs.turn ? z(`现在轮到 ${name(obs.turn.pid)}（${KIND(z)[obs.turn.kind]}）。`, `Now: ${name(obs.turn.pid)} (${KIND(z)[obs.turn.kind]}).`) : ''));

  if (full) {
    L.push('', z('## 背景', '## Background'), sc.background);
    L.push('', z('## 角色（公开简介）', '## Characters (public)'));
    for (const c of sc.characters) L.push(`- ${c.name} (${c.id}): ${c.publicBio}`);
    L.push(z(`- 死者：${sc.victim?.name}`, `- Victim: ${sc.victim?.name}`));
    L.push('', z('## 你的剧本（只有你能看到）', '## Your script (only you can see this)'), me.script);
    if (me.coverStory) L.push(z(`对外说法：${me.coverStory}`, `Your public story: ${me.coverStory}`));
    if (me.knowledge.length) {
      L.push(z('你记得的事：', 'What you remember:'));
      for (const k of me.knowledge) L.push(`- ${k.time ? `[${k.time}] ` : ''}${k.text}${k.secret ? z('（秘密，不想说）', ' (secret — you would rather not say)') : ''}${k.lie ? z('（这是你的谎言）', ' (this is your lie)') : ''}`);
    }
    L.push(z('你的任务：', 'Your objectives:'), ...me.objectives.map((o) => `- ${o}`));
    L.push('', z('## 搜证地点（id：名称，剩余线索/总数）', '## Locations (id: name, clues left/total)'), ...obs.locations.map((l) => `- ${l.id}: ${l.name}, ${l.remaining}/${l.total}`));
  }

  L.push('', z(`## 你的线索（${obs.myClues.length}）`, `## Your clues (${obs.myClues.length})`));
  for (const c of obs.myClues) L.push(`- [${c.id}] ${c.title} (${c.locationName}${c.time ? ` ${c.time}` : ''})${c.public ? z('［已公开］', ' [public]') : ''}: ${c.text}`);
  const others = obs.publicClues.filter((c) => c.sharedBy !== me.id);
  if (others.length) {
    L.push('', z('## 别人公开的线索', '## Clues revealed by others'));
    for (const c of others) L.push(`- [${c.id}] ${c.title} (${z(`${name(c.sharedBy)} 公开`, `revealed by ${name(c.sharedBy)}`)}): ${c.text}`);
  }

  const evs = obs.events.filter((e) => e.seq >= since);
  const nextSince = (obs.events.at(-1)?.seq ?? -1) + 1;
  L.push('', z(`## 发生了什么（事件 #${since} 起，共 ${evs.length} 条；下次可用 since=${nextSince} 只看新的）`, `## What happened (events from #${since}, ${evs.length} total; next time use since=${nextSince} to see only new ones)`));
  for (const e of evs) {
    const d = e.data; const who = name(e.actor);
    const line = {
      narration: () => z(`【主持人】${d.text}`, `[Host] ${d.text}`),
      phase_changed: () => z(`—— 进入${PH[d.phase] || d.phase}${d.round ? ` 第 ${d.round} 轮` : ''} ——`, `—— ${PH[d.phase] || d.phase}${d.round ? `, round ${d.round}` : ''} ——`),
      searched: () => z(`${who} 搜查了 ${loc(d.location)}`, `${who} searched the ${loc(d.location)}`),
      clue_found: () => (d.clue ? z(`你在 ${loc(d.location)} 找到线索 [${d.clue.id}] ${d.clue.title}`, `You found clue [${d.clue.id}] ${d.clue.title} in the ${loc(d.location)}`) : z(`你在 ${loc(d.location)} 什么也没找到`, `You found nothing in the ${loc(d.location)}`)),
      spoke: () => `${who}: ${d.text}`,
      questioned: () => z(`${who} 质询 ${name(d.target)}：${d.text}`, `${who} questions ${name(d.target)}: ${d.text}`),
      responded: () => z(`${who} 回答：${d.text}`, `${who} answers: ${d.text}`),
      evidence_shared: () => z(`${who} 公开线索 [${d.clue.id}] ${d.clue.title}${d.text ? `：${d.text}` : ''}`, `${who} reveals clue [${d.clue.id}] ${d.clue.title}${d.text ? `: ${d.text}` : ''}`),
      accused: () => z(`${who} 指控 ${name(d.target)}：${d.text}`, `${who} accuses ${name(d.target)}: ${d.text}`),
      passed: () => z(`${who} 跳过`, `${who} passes`),
      voted: () => z(`你投给了 ${name(d.target)}`, `You voted for ${name(d.target)}`),
      vote_cast: () => z(`${who} 已投票`, `${who} has voted`),
      votes_revealed: () => z(`票数：${Object.entries(d.tally || {}).map(([p, n]) => `${name(p)} ${n}`).join('，')}；被指认：${d.convicted ? name(d.convicted) : '平票，无人被指认'}`,
        `Votes: ${Object.entries(d.tally || {}).map(([p, n]) => `${name(p)} ${n}`).join(', ')}. Convicted: ${d.convicted ? name(d.convicted) : 'nobody (tie)'}`),
      game_ended: () => z(`对局结束：${d.result?.goodWin ? '侦探方胜' : '凶手逃脱'}。真相：${d.truth?.summary || ''}`, `Game over: ${d.result?.goodWin ? 'the detectives win' : 'the murderer escapes'}. Truth: ${d.truth?.summary || ''}`),
    }[e.type];
    if (line) L.push(`#${e.seq} ${line()}`);
  }

  if (obs.result) {
    const r = obs.result.players?.[me.id];
    L.push('', z('## 结果', '## Result'), z(`被指认：${obs.result.convicted ? name(obs.result.convicted) : '无（平票）'}；凶手：${name(obs.result.murderer)}；你${r?.win ? '赢了' : '输了'}`,
      `Convicted: ${obs.result.convicted ? name(obs.result.convicted) : 'nobody (tie)'}. Murderer: ${name(obs.result.murderer)}. You ${r?.win ? 'won' : 'lost'}.`));
  } else if (obs.allowed.length) {
    L.push('', z(`## 轮到你了：可以做 ${obs.allowed.join(' / ')}`, `## Your turn: you can ${obs.allowed.join(' / ')}`), z('提交下面任意一个 JSON 作为 action（按需修改）：', 'Submit one of these JSON objects as your action (edit as needed):'));
    for (const a of actionExamples(obs, lang)) L.push('  ' + JSON.stringify(a));
  } else {
    L.push('', z('## 还没轮到你，请继续等待。', '## Not your turn yet — keep waiting.'));
  }
  return L.join('\n');
}
