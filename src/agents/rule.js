// 规则型智能体（Mock / 基线 0）：不调用任何大模型，完全离线、可复现。
//
// 它只使用「自己有权知道的信息」：observe() 返回的观察 + 自己持有/已公开线索的剧本作者标注
// （相当于一个会「读懂」线索含义的玩家）。它不会读取其他角色的剧本或真相。
import { tr } from '../i18n.js';
import { makeRng, hashSeed, pick } from '../engine/rng.js';

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const LINES = {
  share: ['我在{loc}找到了这个：「{title}」。大家看看。', '我公开一条线索——{title}。这很关键。', '{title}，这是我在{loc}发现的，我觉得和案子有关。'],
  shareSelf: ['这条线索能证明我的清白：「{title}」。'],
  question: ['{name}，请你说清楚：案发前后你到底在哪里？', '{name}，线索都指向你，你怎么解释？', '{name}，你今晚和{victim}最后一次见面是什么时候？'],
  accuse: ['我认为凶手就是{name}。{reason}', '综合目前的线索，{name}的嫌疑最大。{reason}'],
  deflect: ['我觉得{name}很可疑，案发前去过{scene}的人，都应该交代清楚。', '{name}到现在都没说清楚自己的行踪。'],
  respondTruth: ['{cover}', '我说实话：{cover}'],
  respondMurderer: ['{cover}你们别乱猜，我没有理由害{victim}。', '{cover}倒是{name}，你自己的行踪说清楚了吗？'],
  summary: ['我把时间线理一下：{victim}出事的那段时间，谁没有人证？', '现在线索还不够，我想再听听大家的说法。', '我还在想谁的说法前后对不上。'],
  contradiction: ['等一下——{text}这说不通。'],
};

export class RuleAgent {
  constructor({ scenario, pid, seed = 1, lang = 'zh' }) {
    this.lang = lang;
    this.t = (zh, vars) => tr(lang, zh, vars);
    this.fill = (tpl, vars) => fill(tr(lang, tpl), vars);
    this.sc = scenario;
    this.pid = pid;
    this.me = scenario.characters.find((c) => c.id === pid);
    this.rng = makeRng(hashSeed(seed, 'rule', pid));
    this.said = new Set();
    this.questioned = new Set();
    this.accused = new Set();
    this.searchCount = 0;
    this.kind = 'rule';
  }

  name(id) { return this.sc.characters.find((c) => c.id === id)?.name || id; }
  clueAnn(id) { return this.sc.clues.find((c) => c.id === id); }

  /** 嫌疑度：只来自自己知道的线索、自己的真实记忆、听到的公开证词与矛盾。 */
  suspicion(obs) {
    const score = Object.fromEntries(this.sc.characters.map((c) => [c.id, 0]));
    const known = new Set([...obs.myClues.map((c) => c.id), ...obs.publicClues.map((c) => c.id)]);
    for (const id of known) for (const [w, v] of Object.entries(this.clueAnn(id)?.implicates || {})) score[w] += v;
    // 自己的记忆（凶手的真实记忆不算——他不会怀疑自己）
    for (const k of this.me.knowledge || []) {
      if (k.lie || this.me.isMurderer) continue;
      for (const [w, v] of Object.entries(k.implicates || {})) score[w] += v;
    }
    // 听到的公开发言：若与某条剧本证词一致，就采信其含义
    const heard = obs.events.filter((e) => ['spoke', 'responded', 'accused'].includes(e.type) && e.actor !== this.pid);
    const heardKnow = new Set();
    for (const e of heard) {
      const speaker = this.sc.characters.find((c) => c.id === e.actor);
      for (const k of speaker?.knowledge || []) {
        if (e.data.text?.includes(k.text.slice(0, 12))) {
          heardKnow.add(k.id);
          if (!k.lie) for (const [w, v] of Object.entries(k.implicates || {})) score[w] += v * 0.5;
        }
      }
    }
    for (const k of this.me.knowledge || []) if (this.said.has(k.id)) heardKnow.add(k.id);
    // 矛盾检测：证词 + 公开/持有线索互相冲突
    // 台词里用到的剧本信息（都是公开信息）
    this.ctx = { victim: this.sc.victim?.name || this.t('死者'), scene: this.sc.locations[0]?.name || this.t('案发现场') };
    this.contradictions = [];
    for (const x of this.sc.contradictions || []) {
      if (heardKnow.has(x.knowledge) && known.has(x.clue)) {
        this.contradictions.push(x);
        for (const [w, v] of Object.entries(x.implicates)) score[w] += v;
      }
    }
    // 公开指控略微影响判断
    for (const a of obs.accusations) if (a.to !== this.pid) score[a.to] += 0.3;
    score[this.pid] = this.me.isMurderer ? 0 : Math.min(score[this.pid], 0);
    return score;
  }

  topSuspect(score) {
    const others = Object.entries(score).filter(([id]) => id !== this.pid);
    const max = Math.max(...others.map(([, v]) => v));
    const tops = others.filter(([, v]) => v === max).map(([id]) => id);
    return { id: pick(tops, this.rng), score: max };
  }

  protectedClues() {
    return new Set(this.me.objectives.filter((o) => o.type === 'clue_not_public').map((o) => o.clue));
  }

  async decide(obs) {
    const score = this.suspicion(obs);
    const suspicion = normalize(score, this.pid);
    const action = this.choose(obs, score);
    return { action, meta: { suspicion, thought: this.thought, provider: 'rule' } };
  }

  choose(obs, score) {
    const t = obs.turn;
    const loc = (id) => obs.scenario.locations.find((l) => l.id === id)?.name || id;
    this.thought = '';
    if (t.kind === 'ready') return { type: 'READY' };

    if (t.kind === 'investigate') {
      const avail = obs.locations.filter((l) => l.remaining > 0);
      if (!avail.length) return { type: 'PASS' };
      const prefs = this.me.ruleHints?.preferredLocations || [];
      // 凶手知道自己藏了什么：若已握有某条「前置线索」，会回去抢先拿走被它解锁、且对自己不利的线索
      let target = null;
      if (this.me.isMurderer) {
        const mine = new Set(obs.myClues.map((c) => c.id));
        const unlock = this.sc.clues.find((c) => (c.requires || []).length && c.requires.every((r) => mine.has(r)) && !mine.has(c.id) && (c.implicates?.[this.pid] || 0) > 0);
        if (unlock) target = avail.find((l) => l.id === unlock.location);
      }
      if (!target && this.rng() < 0.75) target = avail.find((l) => l.id === prefs[this.searchCount % prefs.length]);
      if (!target) target = pick(avail, this.rng);
      this.searchCount++;
      this.thought = this.t('去{loc}搜证', { loc: target.name });
      return { type: 'INVESTIGATE', location: target.id };
    }

    const top = this.topSuspect(score);
    const prot = this.protectedClues();
    const shareable = obs.myClues.filter((c) => {
      if (c.public || prot.has(c.id)) return false;
      const imp = this.clueAnn(c.id)?.implicates || {};
      if ((imp[this.pid] || 0) > 0) return false; // 不主动公开对自己不利的线索
      return true;
    });
    const wantPublic = new Set(this.me.objectives.filter((o) => o.type === 'clue_public').map((o) => o.clue));

    if (t.kind === 'respond') {
      const self = shareable.find((c) => (this.clueAnn(c.id)?.implicates?.[this.pid] || 0) < 0 || wantPublic.has(c.id));
      const cover = this.me.coverStory || this.t('我今晚没做什么特别的事。');
      if (self) return { type: 'RESPOND', clue_id: self.id, text: this.t('{cover}不信你们看这条线索。', { cover }) };
      const other = this.topSuspect(score).id === t.askedBy ? this.topSuspect({ ...score, [t.askedBy]: -99 }).id : this.topSuspect(score).id;
      const tpl = this.me.isMurderer ? LINES.respondMurderer : LINES.respondTruth;
      return { type: 'RESPOND', text: this.fill(pick(tpl, this.rng), { ...this.ctx, cover, name: this.name(other) }) };
    }

    if (t.kind === 'vote') {
      this.thought = this.t('投给嫌疑最大的{name}', { name: this.name(top.id) });
      return { type: 'VOTE', target: top.id, text: this.t('证据最多指向{name}', { name: this.name(top.id) }) };
    }

    // ---- 讨论 ----
    const r = this.rng();
    // 1) 想公开的线索 / 指向别人的线索
    const priority = shareable.sort((a, b) => weight(this, b, wantPublic) - weight(this, a, wantPublic));
    if (priority.length && (r < 0.7 || wantPublic.has(priority[0].id))) {
      const c = priority[0];
      const selfClear = (this.clueAnn(c.id)?.implicates?.[this.pid] || 0) < 0;
      return { type: 'SHARE_EVIDENCE', clue_id: c.id, text: this.fill(pick(selfClear ? LINES.shareSelf : LINES.share, this.rng), { title: c.title, loc: loc(c.location) }) };
    }
    // 2) 发现矛盾
    const saidPublicly = (x) => obs.events.some((e) => e.type === 'spoke' && e.data.text.includes(x.text));
    const x = (this.contradictions || []).find((c) => !this.said.has(c.id) && !(c.implicates[this.pid] > 0) && !saidPublicly(c));
    if (x) { this.said.add(x.id); return { type: 'SPEAK', text: this.fill(LINES.contradiction[0], { text: x.text }) }; }
    // 3) 说出自己愿意说的证词（凶手说谎言）
    const tell = (this.me.knowledge || []).find((k) => !k.secret && !this.said.has(k.id));
    if (tell) { this.said.add(tell.id); return { type: 'SPEAK', text: tell.text }; }
    // 4) 质询 / 指控
    if (top.score >= 2 && !this.questioned.has(top.id)) {
      this.questioned.add(top.id);
      const tpl = this.me.isMurderer ? LINES.deflect : LINES.question;
      return { type: 'QUESTION', target: top.id, text: this.fill(pick(tpl, this.rng), { ...this.ctx, name: this.name(top.id) }) };
    }
    if (top.score >= 4 && !this.accused.has(top.id)) {
      this.accused.add(top.id);
      return { type: 'ACCUSE', target: top.id, text: this.fill(pick(LINES.accuse, this.rng), { name: this.name(top.id), reason: this.t('线索和证词都对他/她不利。') }) };
    }
    return { type: 'SPEAK', text: this.fill(pick(LINES.summary, this.rng), this.ctx) };
  }
}

function weight(agent, c, wantPublic) {
  if (wantPublic.has(c.id)) return 100;
  const imp = agent.clueAnn(c.id)?.implicates || {};
  return Object.entries(imp).reduce((s, [w, v]) => s + (w === agent.pid ? -v : Math.abs(v)), 0) + (agent.clueAnn(c.id)?.key ? 1 : 0);
}

export function normalize(score, self) {
  const ids = Object.keys(score).filter((k) => k !== self);
  const pos = ids.map((k) => Math.max(0, score[k]) + 0.5);
  const sum = pos.reduce((a, b) => a + b, 0);
  return Object.fromEntries(ids.map((k, i) => [k, Math.round((pos[i] / sum) * 100)]));
}
