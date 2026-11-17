// 确定性游戏引擎（事件溯源）。
//
// 规则：
//  * 所有状态变化都只发生在 applyEvent() 中；submit() 只负责校验动作并产生事件。
//    因此任何一局都可以用 Game.fromEvents() 从事件日志完整重建。
//  * 每个事件都有可见范围 vis：'public' | 'system'（仅上帝视角/日志） | [角色id...]。
//  * observe(pid) 只返回该角色有权看到的信息，绝不包含真相、他人剧本或线索的作者标注。
import { makeRng, hashSeed, shuffle } from './rng.js';
import { clueCard, publicScenarioView } from './scenario.js';
import { tr } from '../i18n.js';

export const ACTIONS = ['READY', 'INVESTIGATE', 'SPEAK', 'QUESTION', 'RESPOND', 'SHARE_EVIDENCE', 'ACCUSE', 'PASS', 'VOTE'];

const KIND_ACTIONS = {
  ready: ['READY'],
  investigate: ['INVESTIGATE', 'PASS'],
  discuss: ['SPEAK', 'QUESTION', 'SHARE_EVIDENCE', 'ACCUSE', 'PASS'],
  respond: ['RESPOND'],
  vote: ['VOTE'],
};

export class Game {
  constructor(scenario, { id, seed = 1, createdAt = Date.now(), lang = 'zh' } = {}) {
    this.scenario = scenario;
    this.lang = lang;
    this.id = id || `g_${Date.now().toString(36)}`;
    this.seed = seed;
    this.createdAt = createdAt;
    this.events = [];
    this.listeners = new Set();
    this.charIds = scenario.characters.map((c) => c.id);
    this.state = {
      phase: 'lobby', round: 0, turnOrder: [], queue: [],
      clueOwner: {}, publicClues: {}, // clueId -> pid（谁公开的）
      lastLocation: {}, votes: {}, accusations: [], speechCount: {}, violations: {},
      result: null,
    };
  }

  t(zh, vars) { return tr(this.lang, zh, vars); }

  // ---------- 事件 ----------
  emit(type, actor, data = {}, vis = 'public') {
    const e = {
      seq: this.events.length, gameId: this.id, type, actor: actor ?? null, data, vis,
      phase: this.state.phase, round: this.state.round, ts: Date.now(),
    };
    this.applyEvent(e);
    return e;
  }

  applyEvent(e) {
    const s = this.state;
    this.events.push(e);
    switch (e.type) {
      case 'game_started':
        s.turnOrder = e.data.turnOrder;
        s.phase = 'intro';
        s.queue = s.turnOrder.map((pid) => ({ pid, kind: 'ready' }));
        break;
      case 'phase_changed': {
        s.phase = e.data.phase; s.round = e.data.round;
        const rc = this.scenario.config.rounds[s.round - 1];
        if (s.phase === 'investigate') s.queue = repeatOrder(s.turnOrder, rc.investigate, 'investigate');
        else if (s.phase === 'discuss') s.queue = repeatOrder(s.turnOrder, rc.discuss, 'discuss');
        else if (s.phase === 'vote') s.queue = s.turnOrder.map((pid) => ({ pid, kind: 'vote' }));
        else s.queue = [];
        break;
      }
      case 'clue_found':
        if (e.data.clue) s.clueOwner[e.data.clue.id] = e.actor;
        break;
      case 'searched':
        s.lastLocation[e.actor] = e.data.location;
        s.queue.shift();
        break;
      case 'questioned':
        s.queue.shift();
        s.queue.unshift({ pid: e.data.target, kind: 'respond', askedBy: e.actor });
        s.speechCount[e.actor] = (s.speechCount[e.actor] || 0) + 1;
        break;
      case 'evidence_shared':
        s.publicClues[e.data.clue.id] = e.actor;
        if (!e.data.withResponse) s.queue.shift();
        s.speechCount[e.actor] = (s.speechCount[e.actor] || 0) + 1;
        break;
      case 'accused':
        s.accusations.push({ from: e.actor, to: e.data.target, seq: e.seq });
        s.queue.shift();
        s.speechCount[e.actor] = (s.speechCount[e.actor] || 0) + 1;
        break;
      case 'spoke': case 'responded':
        s.queue.shift();
        s.speechCount[e.actor] = (s.speechCount[e.actor] || 0) + 1;
        break;
      case 'ready': case 'passed':
        s.queue.shift();
        break;
      case 'voted':
        s.votes[e.actor] = e.data.target;
        s.queue.shift();
        break;
      case 'action_rejected':
        if (e.actor) s.violations[e.actor] = (s.violations[e.actor] || 0) + 1;
        break;
      case 'game_ended':
        s.phase = 'ended'; s.queue = []; s.result = e.data.result;
        break;
      default: // narration, vote_cast, votes_revealed, agent_decision, ... 不改变规则状态
        break;
    }
    for (const fn of this.listeners) fn(e);
  }

  static fromEvents(scenario, meta, events) {
    const g = new Game(scenario, meta);
    const ls = g.listeners; g.listeners = new Set();
    for (const e of events) g.applyEvent(e);
    g.listeners = ls;
    return g;
  }

  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // ---------- 流程 ----------
  start() {
    if (this.state.phase !== 'lobby') return;
    const rng = makeRng(hashSeed(this.seed, 'order'));
    this.emit('game_started', null, { turnOrder: shuffle(this.charIds, rng), scenarioId: this.scenario.id, seed: this.seed });
    this.emit('narration', null, { text: this.scenario.background });
    this.emit('narration', null, { text: this.scenario.intro });
  }

  get ended() { return this.state.phase === 'ended'; }

  currentTurn() { return this.state.queue[0] || null; }
  currentActor() { return this.currentTurn()?.pid ?? null; }

  allowedActions(pid) {
    const t = this.currentTurn();
    if (!t || t.pid !== pid) return [];
    return KIND_ACTIONS[t.kind];
  }

  /** 提交一个动作。非法动作会被拒绝并记录为违规（action_rejected，仅系统可见）。 */
  submit(pid, action) {
    const err = this.validate(pid, action);
    if (err) {
      this.emit('action_rejected', pid, { action, error: err }, 'system');
      return { ok: false, error: err };
    }
    this.perform(pid, action);
    this.advance();
    return { ok: true };
  }

  validate(pid, a) {
    if (this.ended) return this.t('游戏已结束');
    if (!a || typeof a !== 'object') return this.t('动作格式错误');
    const t = this.currentTurn();
    if (!t || t.pid !== pid) return this.t('现在不是你的回合');
    const type = String(a.type || '').toUpperCase();
    if (!KIND_ACTIONS[t.kind].includes(type)) return this.t('当前阶段只能执行: {list}', { list: KIND_ACTIONS[t.kind].join(', ') });
    const others = this.charIds.filter((c) => c !== pid);
    const text = typeof a.text === 'string' ? a.text.trim() : '';
    switch (type) {
      case 'INVESTIGATE':
        if (!this.scenario.locations.some((l) => l.id === a.location)) return this.t('未知地点 {loc}', { loc: a.location });
        break;
      case 'SPEAK': case 'RESPOND':
        if (!text && !(type === 'RESPOND' && a.clue_id)) return this.t('发言内容不能为空');
        if (type === 'RESPOND' && a.clue_id) {
          const e2 = this.checkShare(pid, a.clue_id); if (e2) return e2;
        }
        break;
      case 'QUESTION': case 'ACCUSE':
        if (!others.includes(a.target)) return this.t('目标必须是其他玩家');
        if (!text) return this.t('内容不能为空');
        break;
      case 'SHARE_EVIDENCE': return this.checkShare(pid, a.clue_id);
      case 'VOTE':
        if (!others.includes(a.target)) return this.t('只能投给其他玩家');
        break;
      default: break;
    }
    return null;
  }

  checkShare(pid, clueId) {
    if (this.state.clueOwner[clueId] !== pid) return this.t('你没有这条线索');
    if (this.state.publicClues[clueId]) return this.t('这条线索已经公开了');
    return null;
  }

  perform(pid, a) {
    const type = String(a.type).toUpperCase();
    const max = this.scenario.config.maxSpeechChars || 300;
    const text = typeof a.text === 'string' ? a.text.trim().slice(0, max) : '';
    const card = (id) => clueCard(this.scenario.clues.find((c) => c.id === id), this.scenario.locations);
    switch (type) {
      case 'READY': this.emit('ready', pid); break;
      case 'PASS': this.emit('passed', pid); break;
      case 'INVESTIGATE': {
        const avail = this.availableClues(pid, a.location);
        const rng = makeRng(hashSeed(this.seed, 'search', this.events.length));
        const clue = avail.length ? avail[Math.floor(rng() * avail.length)] : null;
        this.emit('clue_found', pid, { location: a.location, clue: clue ? card(clue.id) : null }, [pid]);
        this.emit('searched', pid, { location: a.location });
        break;
      }
      case 'SPEAK': this.emit('spoke', pid, { text }); break;
      case 'QUESTION': this.emit('questioned', pid, { target: a.target, text }); break;
      case 'ACCUSE': this.emit('accused', pid, { target: a.target, text }); break;
      case 'SHARE_EVIDENCE': this.emit('evidence_shared', pid, { clue: card(a.clue_id), text }); break;
      case 'RESPOND': {
        const askedBy = this.currentTurn().askedBy;
        if (a.clue_id) this.emit('evidence_shared', pid, { clue: card(a.clue_id), text: '', withResponse: true });
        this.emit('responded', pid, { text: text || this.t('（出示了一条线索）'), to: askedBy });
        break;
      }
      case 'VOTE':
        this.emit('voted', pid, { target: a.target, reason: text }, [pid]);
        this.emit('vote_cast', pid, {});
        break;
      default: break;
    }
  }

  /** 某玩家此刻在某地点能搜到的线索：未被拿走，且前置线索已被他本人持有或已公开。 */
  availableClues(pid, location) {
    const s = this.state;
    const knows = (id) => s.clueOwner[id] === pid || !!s.publicClues[id];
    return this.scenario.clues.filter((c) => c.location === location && !s.clueOwner[c.id] && (c.requires || []).every(knows));
  }

  advance() {
    const s = this.state;
    while (!this.ended && s.queue.length === 0) {
      const rounds = this.scenario.config.rounds.length;
      let next;
      if (s.phase === 'intro') next = { phase: 'investigate', round: 1 };
      else if (s.phase === 'investigate') next = { phase: 'discuss', round: s.round };
      else if (s.phase === 'discuss') next = s.round < rounds ? { phase: 'investigate', round: s.round + 1 } : { phase: 'vote', round: s.round };
      else if (s.phase === 'vote') { this.finish(); return; }
      this.emit('phase_changed', null, next);
      const key = next.phase === 'vote' ? 'vote' : `${next.phase}_${next.round}`;
      const text = this.scenario.phaseNarration?.[key];
      if (text) this.emit('narration', null, { text });
    }
  }

  finish() {
    const s = this.state;
    const tally = Object.fromEntries(this.charIds.map((c) => [c, 0]));
    for (const t of Object.values(s.votes)) tally[t] += 1;
    const max = Math.max(...Object.values(tally));
    const top = Object.keys(tally).filter((k) => tally[k] === max);
    const convicted = top.length === 1 ? top[0] : null;
    this.emit('votes_revealed', null, { votes: { ...s.votes }, tally, convicted });
    const murderer = this.scenario.truth.murderer;
    const goodWin = convicted === murderer;
    const players = {};
    for (const ch of this.scenario.characters) {
      const objectives = ch.objectives.map((o) => {
        let done = false;
        if (o.type === 'find_murderer') done = s.votes[ch.id] === murderer;
        else if (o.type === 'escape') done = convicted !== ch.id;
        else if (o.type === 'clue_public') done = !!s.publicClues[o.clue];
        else if (o.type === 'clue_not_public') done = !s.publicClues[o.clue];
        else if (o.type === 'not_most_voted') done = convicted !== ch.id;
        return { desc: o.desc, type: o.type, done };
      });
      players[ch.id] = { win: ch.isMurderer ? !goodWin : goodWin, objectives, score: objectives.filter((o) => o.done).length };
    }
    const truth = this.scenario.truth;
    this.emit('game_ended', null, {
      result: { convicted, murderer, goodWin, tally, players },
      truth: {
        summary: truth.summary, timeline: truth.timeline, secrets: truth.secrets, weapon: truth.weapon,
        hiddenRelationships: this.scenario.relationships.filter((r) => !r.public).map(({ a, b, label }) => ({ a, b, label })),
        scripts: Object.fromEntries(this.scenario.characters.map((c) => [c.id, c.script])),
        clueOwner: { ...s.clueOwner },
      },
    });
  }

  // ---------- 观察（访问控制的唯一出口） ----------
  canSee(e, pid) {
    if (e.vis === 'public') return true;
    if (e.vis === 'system') return false;
    return Array.isArray(e.vis) && e.vis.includes(pid);
  }

  roleCard(pid) {
    const c = this.scenario.characters.find((x) => x.id === pid);
    return {
      id: c.id, name: c.name, color: c.color, publicBio: c.publicBio, personality: c.personality,
      script: c.script, coverStory: c.coverStory || '', isMurderer: !!c.isMurderer,
      knowledge: (c.knowledge || []).map(({ id, text, time, secret, lie }) => ({ id, text, time: time || '', secret: !!secret, lie: !!lie })),
      objectives: c.objectives.map((o) => o.desc),
    };
  }

  common() {
    const s = this.state;
    const sc = this.scenario;
    const card = (id) => clueCard(sc.clues.find((c) => c.id === id), sc.locations);
    return {
      gameId: this.id, phase: s.phase, round: s.round, totalRounds: sc.config.rounds.length,
      turnOrder: s.turnOrder,
      turn: this.currentTurn() ? { ...this.currentTurn() } : null,
      scenario: publicScenarioView(sc),
      locations: sc.locations.map((l) => ({
        id: l.id, name: l.name,
        remaining: sc.clues.filter((c) => c.location === l.id && !s.clueOwner[c.id]).length,
        total: sc.clues.filter((c) => c.location === l.id).length,
      })),
      lastLocation: { ...s.lastLocation },
      publicClues: Object.entries(s.publicClues).map(([id, by]) => ({ ...card(id), sharedBy: by })),
      accusations: s.accusations.map((a) => ({ ...a })),
      votesCast: Object.keys(s.votes),
    };
  }

  /** 玩家视角：只含自己可见的事件与线索。 */
  observe(pid) {
    const s = this.state;
    const sc = this.scenario;
    const card = (id) => clueCard(sc.clues.find((c) => c.id === id), sc.locations);
    const ended = this.ended;
    return {
      viewer: { kind: 'player', pid },
      ...this.common(),
      you: this.roleCard(pid),
      allowed: this.allowedActions(pid),
      myClues: Object.entries(s.clueOwner).filter(([, o]) => o === pid).map(([id]) => ({ ...card(id), public: !!s.publicClues[id] })),
      events: this.events.filter((e) => this.canSee(e, pid)),
      result: ended ? s.result : null,
    };
  }

  /** 观众视角：只看公开事件。 */
  spectate() {
    return { viewer: { kind: 'spectator' }, ...this.common(), events: this.events.filter((e) => e.vis === 'public'), result: this.ended ? this.state.result : null };
  }

  /** 上帝视角：全部信息。只允许在全 AI 对局或终局后使用（由服务器把关）。 */
  godView() {
    const sc = this.scenario;
    const card = (id) => clueCard(sc.clues.find((c) => c.id === id), sc.locations);
    return {
      viewer: { kind: 'god' }, ...this.common(),
      roles: Object.fromEntries(this.charIds.map((id) => [id, this.roleCard(id)])),
      clueOwner: { ...this.state.clueOwner },
      allClues: sc.clues.map((c) => ({ ...card(c.id), owner: this.state.clueOwner[c.id] || null, public: !!this.state.publicClues[c.id] })),
      votes: { ...this.state.votes },
      violations: { ...this.state.violations },
      events: this.events,
      truth: sc.truth,
      result: this.ended ? this.state.result : null,
    };
  }
}

function repeatOrder(order, n, kind) {
  const q = [];
  for (let i = 0; i < n; i++) for (const pid of order) q.push({ pid, kind });
  return q;
}
