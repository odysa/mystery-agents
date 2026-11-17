// 大模型智能体（基线 A：静态角色剧本 + 近期可见历史）。
// 每次决策 = 一次模型调用，输出结构化 JSON 动作；非法输出会重试一次，再失败则退回规则型智能体。
import { RuleAgent } from './rule.js';

export const PROMPT_VERSION = 'baseline-a/1';

// 双语提示词：z('中文', 'English') 按语言取其一。
const pickLang = (lang) => (lang === 'en' ? (zh, en) => en : (zh) => zh);

const kindHelp = (z) => ({
  ready: z('阅读完剧本后，输出 READY。', 'After reading your script, output READY.'),
  investigate: z('搜证回合：选择一个地点 INVESTIGATE（location 填地点 id），或 PASS。', 'Investigation turn: INVESTIGATE a location (location = location id), or PASS.'),
  discuss: z('讨论回合：可以 SPEAK（发言）、QUESTION（质询某人，target 必填，对方必须马上回答）、SHARE_EVIDENCE（公开你持有的一条线索，clue_id 必填）、ACCUSE（公开指控，target 必填）或 PASS。',
    'Discussion turn: you may SPEAK, QUESTION someone (target required; they must answer immediately), SHARE_EVIDENCE (reveal one clue you hold; clue_id required), ACCUSE someone publicly (target required), or PASS.'),
  respond: z('有人在质询你，你必须 RESPOND 作答（可以顺便出示一条你持有的线索，clue_id 选填）。', 'Someone is questioning you. You must RESPOND (you may also show one clue you hold via clue_id).'),
  vote: z('投票回合：VOTE 投给你认为的凶手（target 必填，不能投自己）。', 'Voting turn: VOTE for who you think the murderer is (target required; not yourself).'),
});

const fmtEvent = (e, nameOf, locName, z) => {
  const who = nameOf(e.actor);
  const tag = e.phase === 'investigate' ? z(`搜证${e.round}`, `Investigate ${e.round}`) : e.phase === 'discuss' ? z(`讨论${e.round}`, `Discuss ${e.round}`) : e.phase === 'vote' ? z('投票', 'Vote') : z('开场', 'Intro');
  switch (e.type) {
    case 'narration': return null;
    case 'searched': return `[${tag}] ${z(`${who} 搜查了${locName(e.data.location)}`, `${who} searched the ${locName(e.data.location)}`)}`;
    case 'clue_found': return e.data.clue
      ? `[${tag}] ${z(`（只有你知道）你在${locName(e.data.location)}找到线索 ${e.data.clue.id}「${e.data.clue.title}」`, `(only you know) you found clue ${e.data.clue.id} "${e.data.clue.title}" in the ${locName(e.data.location)}`)}`
      : `[${tag}] ${z(`（只有你知道）你在${locName(e.data.location)}什么也没找到`, `(only you know) you found nothing in the ${locName(e.data.location)}`)}`;
    case 'spoke': return `[${tag}] ${who}: ${e.data.text}`;
    case 'questioned': return `[${tag}] ${z(`${who} 质询 ${nameOf(e.data.target)}`, `${who} questions ${nameOf(e.data.target)}`)}: ${e.data.text}`;
    case 'responded': return `[${tag}] ${z(`${who} 回答`, `${who} answers`)}: ${e.data.text}`;
    case 'accused': return `[${tag}] ${z(`${who} 指控 ${nameOf(e.data.target)}`, `${who} accuses ${nameOf(e.data.target)}`)}: ${e.data.text}`;
    case 'evidence_shared': return `[${tag}] ${z(`${who} 公开线索`, `${who} reveals clue`)} ${e.data.clue.id} "${e.data.clue.title}"${e.data.text ? ': ' + e.data.text : ''}`;
    case 'passed': return `[${tag}] ${z(`${who} 跳过`, `${who} passes`)}`;
    case 'voted': return `[${z('投票', 'Vote')}] ${z(`你投给了 ${nameOf(e.data.target)}`, `you voted for ${nameOf(e.data.target)}`)}`;
    case 'phase_changed': return z(`—— 进入${e.data.phase === 'investigate' ? '搜证' : e.data.phase === 'discuss' ? '讨论' : '投票'}阶段（第 ${e.data.round} 轮）——`,
      `—— ${e.data.phase === 'investigate' ? 'Investigation' : e.data.phase === 'discuss' ? 'Discussion' : 'Voting'} phase (round ${e.data.round}) ——`);
    default: return null;
  }
};

export function buildPrompt(obs, { historyLimit = 80, lang = 'zh', assets = {} } = {}) {
  const z = pickLang(lang);
  // 线索附带的媒体：把文字描述（和音频文字稿）写进提示，看不到图片的模型也能推理
  const mediaNote = (ids = []) => ids.filter((id) => assets[id]).map((id) => {
    const a = assets[id];
    return a.type === 'image' ? z(`［图片：${a.alt}］`, ` [Image: ${a.alt}]`) : z(`［录音：${a.alt}${a.transcript ? `；内容：${a.transcript}` : ''}］`, ` [Audio: ${a.alt}${a.transcript ? `; content: ${a.transcript}` : ''}]`);
  }).join('');
  const sc = obs.scenario;
  const nameOf = (id) => sc.characters.find((c) => c.id === id)?.name || id || z('主持人', 'Host');
  const locName = (id) => sc.locations.find((l) => l.id === id)?.name || id;
  const you = obs.you;
  const others = sc.characters.filter((c) => c.id !== you.id);
  const none = z('（暂无）', '(none)');

  const system = [
    z(`你正在参与一场中文剧本杀《${sc.title}》，扮演角色「${you.name}」。请始终以 ${you.name} 的身份和性格（${you.personality}）行动、说话。`,
      `You are playing the murder-mystery game "${sc.title}" as the character ${you.name}. Always act and speak as ${you.name}, in character (${you.personality}).`),
    z('规则：', 'Rules:'),
    z('1. 只有「线索卡」是游戏中的客观事实；其他角色的发言只是证词，可能是谎言。', '1. Only clue cards are objective facts. What other characters say is testimony and may be a lie.'),
    z('2. 你只能公开你自己持有的线索卡（用 clue_id 引用），不要编造不存在的线索卡。', '2. You can only reveal clue cards you hold (by clue_id). Never invent clue cards.'),
    z('3. 你可以为了完成自己的任务而隐瞒或撒谎（尤其是凶手），但要保持前后一致。', '3. You may hide things or lie to achieve your objectives (especially as the murderer), but stay consistent.'),
    z('4. 发言简短自然，像真人玩家，每次不超过 120 字，使用简体中文。', '4. Speak briefly and naturally like a real player, at most 80 words per message, in English.'),
    z('5. 只输出一个 JSON 对象，不要输出其他内容。', '5. Output exactly one JSON object and nothing else.'),
    '',
    z('【你的角色剧本（只有你知道）】', '[Your character script (only you know this)]'),
    you.script,
    ...(you.media?.length ? [mediaNote(you.media)] : []),
  ].join('\n');

  const lines = obs.events.map((e) => fmtEvent(e, nameOf, locName, z)).filter(Boolean);
  const hist = lines.slice(-historyLimit);
  const t = obs.turn;
  const askedBy = t.kind === 'respond' ? obs.events.filter((e) => e.type === 'questioned' && e.data.target === you.id).at(-1) : null;

  const user = [
    `${z('【案件背景】', '[Background]')}\n${sc.background}`,
    `${z('【在场角色】', '[Characters]')}\n${others.map((c) => `- ${c.id}: ${c.name}, ${c.publicBio}`).join('\n')}`,
    `${z('【搜证地点】', '[Locations]')}\n${obs.locations.map((l) => `- ${l.id}: ${l.name} (${z('剩余线索', 'clues left')} ${l.remaining}/${l.total})`).join('\n')}`,
    `${z('【你持有的线索卡】', '[Your clue cards]')}\n${obs.myClues.length ? obs.myClues.map((c) => `- ${c.id} "${c.title}" ${c.public ? z('（已公开）', '(public)') : z('（未公开）', '(private)')}: ${c.text}${mediaNote(c.media)}`).join('\n') : none}`,
    `${z('【已公开的线索卡】', '[Public clue cards]')}\n${obs.publicClues.length ? obs.publicClues.map((c) => `- ${c.id} "${c.title}" ${z(`由${nameOf(c.sharedBy)}公开`, `revealed by ${nameOf(c.sharedBy)}`)}: ${c.text}${mediaNote(c.media)}`).join('\n') : none}`,
    `${z(`【至今的过程（最近 ${hist.length} 条）】`, `[What has happened (last ${hist.length})]`)}\n${hist.join('\n') || z('（游戏刚开始）', '(the game has just started)')}`,
    `${z(`【现在轮到你】阶段：${obs.phase}，第 ${obs.round}/${obs.totalRounds} 轮。`, `[Your turn] Phase: ${obs.phase}, round ${obs.round}/${obs.totalRounds}. `)}${kindHelp(z)[t.kind]}`,
    askedBy ? z(`${nameOf(askedBy.actor)} 刚刚质询你：「${askedBy.data.text}」`, `${nameOf(askedBy.actor)} just questioned you: "${askedBy.data.text}"`) : '',
    `${z('可用动作', 'Allowed actions')}: ${obs.allowed.join(', ')}`,
    '',
    z('请输出 JSON：{"thought": 你的内心想法(不会被别人看到,≤60字), "action": 动作, "target": 目标角色id或"", "location": 地点id或"", "clue_id": 线索id或"", "text": 你说的话或"", "suspicion": {角色id: 0-100 的怀疑度}}',
      'Output JSON: {"thought": your private reasoning (hidden from others, ≤40 words), "action": action, "target": character id or "", "location": location id or "", "clue_id": clue id or "", "text": what you say or "", "suspicion": {character id: suspicion 0-100}}'),
  ].filter(Boolean).join('\n\n');

  const suspProps = Object.fromEntries(others.map((c) => [c.id, { type: 'integer' }]));
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['thought', 'action', 'target', 'location', 'clue_id', 'text', 'suspicion'],
    properties: {
      thought: { type: 'string' },
      action: { type: 'string', enum: ['READY', 'INVESTIGATE', 'SPEAK', 'QUESTION', 'RESPOND', 'SHARE_EVIDENCE', 'ACCUSE', 'PASS', 'VOTE'] },
      target: { type: 'string' },
      location: { type: 'string' },
      clue_id: { type: 'string' },
      text: { type: 'string' },
      suspicion: { type: 'object', additionalProperties: false, required: others.map((c) => c.id), properties: suspProps },
    },
  };
  return { system, user, schema };
}

export function parseAction(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('输出中没有 JSON');
  const j = JSON.parse(m[0]);
  const action = { type: String(j.action || '').toUpperCase() };
  for (const k of ['target', 'location', 'clue_id', 'text']) if (j[k]) action[k] = String(j[k]);
  return { action, thought: j.thought || '', suspicion: j.suspicion || {} };
}

export class LLMAgent {
  constructor({ scenario, pid, provider, seed = 1, lang = 'zh', loadAsset = null }) {
    this.pid = pid;
    this.lang = lang;
    this.assets = scenario.assets || {};
    this.loadAsset = loadAsset; // (assetId) => { mime, data(base64) } | null，只返回位图
    this.maxImages = Number(process.env.MA_MAX_IMAGES || 4);
    this.provider = provider;
    this.kind = provider.name;
    this.fallback = new RuleAgent({ scenario, pid, seed, lang });
    this.usage = { input: 0, output: 0, calls: 0, failures: 0 };
  }

  /** validate: (action) => 错误字符串|null，由运行器传入引擎校验函数，用于一次自我纠正。 */
  async decide(obs, { validate } = {}) {
    if (obs.turn.kind === 'ready') return { action: { type: 'READY' }, meta: { provider: this.kind, thought: '读完剧本' } };
    const prompt = buildPrompt(obs, { lang: this.lang, assets: this.assets });
    // 看得见的线索图片（自己持有的 + 已公开的），最新的优先
    if (this.loadAsset) {
      const ids = [...new Set([...obs.myClues, ...obs.publicClues].flatMap((c) => c.media || []))].filter((id) => this.assets[id]?.type === 'image');
      prompt.images = (await Promise.all(ids.slice(-this.maxImages).map((id) => this.loadAsset(id)))).filter(Boolean);
    }
    let lastErr = null;
    let raw = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const user = lastErr ? `${prompt.user}\n\n${this.lang === 'en' ? `[Note] Your previous output was invalid: ${lastErr}. Please fix it and output again.` : `【注意】你上一次的输出无效：${lastErr}。请修正后重新输出。`}` : prompt.user;
        const res = await this.provider.complete({ ...prompt, user });
        this.usage.calls++; this.usage.input += res.usage.input; this.usage.output += res.usage.output;
        raw = res.text;
        const parsed = parseAction(res.text);
        const err = validate ? validate(parsed.action) : null;
        if (err) { lastErr = err; continue; }
        return { action: parsed.action, meta: { provider: this.kind, model: res.model, thought: parsed.thought, suspicion: parsed.suspicion, raw, usage: res.usage, promptVersion: PROMPT_VERSION, attempts: attempt + 1 } };
      } catch (e) {
        lastErr = e.message;
      }
    }
    this.usage.failures++;
    const fb = await this.fallback.decide(obs);
    return { action: fb.action, meta: { ...fb.meta, provider: `${this.kind}→rule`, fallbackReason: lastErr, raw } };
  }
}
