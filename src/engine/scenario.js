// 剧本加载与校验。剧本是纯数据（JSON），引擎不依赖任何具体剧本。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { checkMedia } from './media.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCENARIO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scenarios');

export const FORMAT = 'openjubensha/1';

// 内置剧本目录之外的社区剧本目录（服务器启动时注册 data/scenarios）
const extraDirs = new Set();
export function addScenarioDir(dir) { extraDirs.add(dir); }
const allDirs = () => [[SCENARIO_DIR, 'builtin'], ...[...extraDirs].map((d) => [d, 'community'])];

/** 返回剧本文件路径与来源；内置剧本优先。 */
export function findScenario(id) {
  if (!/^[\w-]+$/.test(String(id))) return null;
  for (const [dir, source] of allDirs()) {
    const file = join(dir, `${id}.json`);
    if (existsSync(file)) return { file, source };
  }
  return null;
}

export function loadScenario(id, dir) {
  if (!/^[\w-]+$/.test(String(id))) throw new Error(`非法的剧本 id: ${id}`);
  const file = dir ? join(dir, `${id}.json`) : findScenario(id)?.file;
  if (!file) throw new Error(`剧本不存在: ${id}`);
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateScenario(raw);
  if (errors.length) throw new Error(`剧本 ${id} 校验失败:\n- ${errors.join('\n- ')}`);
  return raw;
}

const DIFFICULTY_ORDER = { 入门: 0, 进阶: 1, 困难: 2 };

export function listScenarios(dir) {
  const out = [];
  const seen = new Set();
  for (const [d, source] of dir ? [[dir, 'builtin']] : allDirs()) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith('.json')).sort()) {
      let s;
      // 一个剧本坏了不应该让整个大厅打不开
      try { s = loadScenario(f.replace(/\.json$/, ''), d); } catch (e) { console.warn(`跳过无效剧本 ${f}：${e.message.split('\n')[0]}`); continue; }
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push({
        id: s.id, title: s.title, subtitle: s.subtitle, players: s.players,
        difficulty: s.difficulty, estimatedMinutes: s.estimatedMinutes, license: s.license,
        clues: s.clues.length, locations: s.locations.length, source, author: s.author || null,
        cover: s.cover && s.assets?.[s.cover] ? (s.assets[s.cover].src.startsWith('https://') ? s.assets[s.cover].src : `/media/${s.id}/${s.cover}`) : null,
        media: { images: Object.values(s.assets || {}).filter((a) => a.type === 'image').length, audio: Object.values(s.assets || {}).filter((a) => a.type === 'audio').length },
        language: baseLang(s), languages: scenarioLangs(s),
        i18n: Object.fromEntries(Object.keys(s.translations || {}).map((l) => [l, {
          title: s.translations[l].title || s.title, subtitle: s.translations[l].subtitle || s.subtitle,
        }])),
      });
    }
  }
  return out.sort((a, b) => (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9) || a.players - b.players);
}

/**
 * 结构校验 + 可解性校验。返回错误字符串数组（空数组表示通过）。
 * 可解性：凶手必须能被「侦探方可获得的信息」指认——即所有线索加上非凶手角色的非秘密证词，
 * 指向凶手的权重严格高于指向任何其他人的权重。
 */
export function validateScenario(s) {
  try {
    const typeErrors = checkTypes(s);
    if (typeErrors.length) return typeErrors;
    return checkSemantics(s);
  } catch (e) {
    return [`剧本结构无法解析：${e.message}`];
  }
}

// ---------- 类型检查：剧本可能来自用户投稿，必须先保证形状正确、字段安全 ----------
const ID = /^[\w-]{1,64}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const TIME = /^$|^([01]\d|2[0-3]):[0-5]\d(-([01]\d|2[0-3]):[0-5]\d)?$/;
const OBJECTIVE_TYPES = ['find_murderer', 'escape', 'clue_public', 'clue_not_public', 'not_most_voted'];

function checkTypes(s) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  const str = (v, path, { max = 20000, optional = false } = {}) => {
    if (v === undefined && optional) return;
    need(typeof v === 'string' && v.length <= max, `${path} 必须是字符串${max < 20000 ? `（最多 ${max} 字）` : ''}`);
  };
  const id = (v, path) => need(typeof v === 'string' && ID.test(v), `${path} 必须是由字母、数字、-、_ 组成的 id（当前：${JSON.stringify(v)}）`);
  const arr = (v, path, min = 0) => { const ok = Array.isArray(v) && v.length >= min; need(ok, `${path} 必须是数组${min ? `，至少 ${min} 项` : ''}`); return ok ? v : []; };
  const weights = (v, path) => {
    if (v === undefined) return;
    need(v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((w) => Number.isFinite(w) && Math.abs(w) <= 10), `${path} 必须是 {角色id: 权重} 对象，权重为 -10 到 10 的数字`);
  };

  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['剧本必须是一个 JSON 对象'];
  if (s.format !== undefined) need(s.format === FORMAT, `format 必须是 "${FORMAT}"（当前：${JSON.stringify(s.format)}）`);
  id(s.id, 'id');
  str(s.title, 'title', { max: 40 });
  str(s.subtitle, 'subtitle', { max: 200, optional: true });
  str(s.background, 'background');
  str(s.intro, 'intro');
  need(Number.isInteger(s.players) && s.players >= 3 && s.players <= 10, 'players 必须是 3 到 10 的整数');
  need(s.victim && typeof s.victim === 'object', 'victim 必须是对象 { id, name, bio }');
  id(s.victim?.id, 'victim.id'); str(s.victim?.name, 'victim.name', { max: 40 }); str(s.victim?.bio, 'victim.bio', { optional: true });
  arr(s.locations, 'locations', 3).forEach((l, i) => {
    id(l?.id, `locations[${i}].id`); str(l?.name, `locations[${i}].name`, { max: 20 }); str(l?.description, `locations[${i}].description`, { optional: true });
    need(Number.isFinite(l?.x) && Number.isFinite(l?.y) && l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1, `locations[${i}] 的 x、y 必须是 0 到 1 的数字`);
  });
  arr(s.characters, 'characters', 3).forEach((c, i) => {
    const p = `characters[${i}]`;
    id(c?.id, `${p}.id`); str(c?.name, `${p}.name`, { max: 20 }); str(c?.publicBio, `${p}.publicBio`, { max: 1000 });
    need(typeof c?.color === 'string' && COLOR.test(c.color), `${p}.color 必须是 #RRGGBB 格式的颜色`);
    str(c?.script, `${p}.script`); str(c?.personality, `${p}.personality`, { optional: true }); str(c?.coverStory, `${p}.coverStory`, { optional: true });
    need(c?.isMurderer === undefined || typeof c.isMurderer === 'boolean', `${p}.isMurderer 必须是布尔值`);
    arr(c?.knowledge ?? [], `${p}.knowledge`).forEach((k, j) => {
      id(k?.id, `${p}.knowledge[${j}].id`); str(k?.text, `${p}.knowledge[${j}].text`, { max: 1000 });
      need(typeof (k?.time ?? '') === 'string', `${p}.knowledge[${j}].time 必须是字符串`);
      weights(k?.implicates, `${p}.knowledge[${j}].implicates`);
    });
    arr(c?.objectives, `${p}.objectives`, 1).forEach((o, j) => {
      need(OBJECTIVE_TYPES.includes(o?.type), `${p}.objectives[${j}].type 必须是 ${OBJECTIVE_TYPES.join(' / ')} 之一`);
      str(o?.desc, `${p}.objectives[${j}].desc`, { max: 200 });
      if (['clue_public', 'clue_not_public'].includes(o?.type)) id(o?.clue, `${p}.objectives[${j}].clue`);
    });
  });
  arr(s.clues, 'clues', 3).forEach((c, i) => {
    const p = `clues[${i}]`;
    id(c?.id, `${p}.id`); id(c?.location, `${p}.location`); str(c?.title, `${p}.title`, { max: 40 }); str(c?.text, `${p}.text`, { max: 2000 });
    need(TIME.test(c?.time ?? ''), `${p}.time 必须为空或 HH:MM / HH:MM-HH:MM（当前：${JSON.stringify(c?.time)}）`);
    weights(c?.implicates, `${p}.implicates`);
    if (c?.requires !== undefined) arr(c.requires, `${p}.requires`).forEach((r, j) => id(r, `${p}.requires[${j}]`));
  });
  arr(s.relationships ?? [], 'relationships').forEach((r, i) => { id(r?.a, `relationships[${i}].a`); id(r?.b, `relationships[${i}].b`); str(r?.label, `relationships[${i}].label`, { max: 40 }); });
  arr(s.contradictions ?? [], 'contradictions').forEach((x, i) => { id(x?.id, `contradictions[${i}].id`); str(x?.text, `contradictions[${i}].text`, { max: 1000 }); need(x?.implicates !== undefined, `contradictions[${i}].implicates 必填`); weights(x?.implicates, `contradictions[${i}].implicates`); });
  need(s.truth && typeof s.truth === 'object', 'truth 必须是对象');
  id(s.truth?.murderer, 'truth.murderer'); str(s.truth?.summary, 'truth.summary');
  arr(s.truth?.timeline, 'truth.timeline').forEach((t, i) => { str(t?.time, `truth.timeline[${i}].time`, { max: 20 }); str(t?.text, `truth.timeline[${i}].text`, { max: 1000 }); });
  arr(s.truth?.secrets ?? [], 'truth.secrets').forEach((t, i) => { id(t?.who, `truth.secrets[${i}].who`); str(t?.text, `truth.secrets[${i}].text`, { max: 1000 }); });
  if (s.phaseNarration !== undefined) need(s.phaseNarration && typeof s.phaseNarration === 'object' && Object.values(s.phaseNarration).every((v) => typeof v === 'string'), 'phaseNarration 必须是 { 阶段键: 文本 } 对象');
  if (s.victimRelationships !== undefined) arr(s.victimRelationships, 'victimRelationships');
  arr(s.config?.rounds, 'config.rounds', 1).forEach((r, i) => {
    need(Number.isInteger(r?.investigate) && r.investigate >= 0 && r.investigate <= 5, `config.rounds[${i}].investigate 必须是 0 到 5 的整数`);
    need(Number.isInteger(r?.discuss) && r.discuss >= 0 && r.discuss <= 5, `config.rounds[${i}].discuss 必须是 0 到 5 的整数`);
  });
  need((s.config?.rounds || []).length <= 4, 'config.rounds 最多 4 轮');
  errors.push(...checkMedia(s));
  if (s.translations !== undefined) {
    const ok = s.translations && typeof s.translations === 'object' && !Array.isArray(s.translations);
    need(ok, 'translations 必须是 { 语言代码: {…} } 对象');
    for (const [lang, t] of Object.entries(ok ? s.translations : {})) {
      need(/^[a-z]{2}$/.test(lang), `translations 的键必须是两位小写语言代码（如 en），当前：${lang}`);
      need(t && typeof t === 'object' && !Array.isArray(t), `translations.${lang} 必须是对象`);
      // 所有翻译值都必须是字符串（或由字符串组成的对象/数组），防止注入奇怪的类型
      const walk = (v, path, depth) => {
        if (typeof v === 'string') return need(v.length <= 20000, `${path} 太长`);
        if (depth > 4 || v === null || typeof v !== 'object') return need(false, `${path} 必须是字符串`);
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, depth + 1);
      };
      walk(t, `translations.${lang}`, 0);
      const ids = (key, list) => { for (const k of Object.keys(t?.[key] || {})) need(list.includes(k), `translations.${lang}.${key} 里的 ${k} 不是有效 id`); };
      ids('characters', (s.characters || []).map((c) => c?.id));
      ids('clues', (s.clues || []).map((c) => c?.id));
      ids('locations', (s.locations || []).map((c) => c?.id));
    }
  }
  return errors;
}

function checkSemantics(s) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  s.relationships ||= [];
  s.victimRelationships ||= [];

  const charIds = new Set(s.characters.map((c) => c.id));
  const locIds = new Set(s.locations.map((l) => l.id));
  const clueIds = new Set(s.clues.map((c) => c.id));

  need(charIds.size === s.characters.length, '角色 id 重复');
  need(clueIds.size === s.clues.length, '线索 id 重复');
  need(s.characters.length === s.players, `players=${s.players} 与角色数量 ${s.characters.length} 不一致`);
  need(locIds.size >= 3, '至少需要 3 个搜证地点');

  const murderers = s.characters.filter((c) => c.isMurderer);
  need(murderers.length === 1, '必须恰好有一名凶手 (isMurderer)');
  need(charIds.has(s.truth.murderer), 'truth.murderer 不是有效角色');
  if (murderers[0]) need(murderers[0].id === s.truth.murderer, 'isMurderer 与 truth.murderer 不一致');

  for (const c of s.characters) {
    need(typeof c.script === 'string' && c.script.length > 0, `角色 ${c.id} 缺少剧本 script`);
    need(Array.isArray(c.objectives) && c.objectives.length > 0, `角色 ${c.id} 缺少任务 objectives`);
    for (const o of c.objectives || []) {
      if (o.clue) need(clueIds.has(o.clue), `角色 ${c.id} 的任务引用了不存在的线索 ${o.clue}`);
    }
    for (const k of c.knowledge || []) {
      for (const who of Object.keys(k.implicates || {})) need(charIds.has(who), `证词 ${k.id} 指向未知角色 ${who}`);
    }
  }
  for (const c of s.clues) {
    need(locIds.has(c.location), `线索 ${c.id} 的地点 ${c.location} 不存在`);
    for (const who of Object.keys(c.implicates || {})) need(charIds.has(who), `线索 ${c.id} 指向未知角色 ${who}`);
    for (const r of c.requires || []) {
      need(clueIds.has(r), `线索 ${c.id} 依赖不存在的线索 ${r}`);
      need(r !== c.id, `线索 ${c.id} 不能依赖自身`);
    }
  }
  const knowIds = new Set(s.characters.flatMap((c) => (c.knowledge || []).map((k) => k.id)));
  for (const x of s.contradictions || []) {
    need(knowIds.has(x.knowledge), `矛盾 ${x.id} 引用了不存在的证词 ${x.knowledge}`);
    need(clueIds.has(x.clue), `矛盾 ${x.id} 引用了不存在的线索 ${x.clue}`);
  }
  // 依赖无环：每条线索都必须能通过拓扑顺序被发现
  const found = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const c of s.clues) {
      if (!found.has(c.id) && (c.requires || []).every((r) => found.has(r))) { found.add(c.id); progress = true; }
    }
  }
  need(found.size === s.clues.length, `存在无法被发现的线索（依赖成环）: ${s.clues.filter((c) => !found.has(c.id)).map((c) => c.id).join(', ')}`);

  // 总搜证次数应该不少于线索数量的一半，否则大部分线索不可能被找到
  const totalSearch = s.config.rounds.reduce((a, r) => a + r.investigate, 0) * s.characters.length;
  need(totalSearch >= Math.ceil(s.clues.length / 2), `总搜证次数 ${totalSearch} 太少（线索 ${s.clues.length} 条）`);

  // 可解性
  const score = Object.fromEntries([...charIds].map((id) => [id, 0]));
  for (const c of s.clues) for (const [who, w] of Object.entries(c.implicates || {})) score[who] += w;
  for (const ch of s.characters) {
    if (ch.isMurderer) continue;
    for (const k of ch.knowledge || []) {
      if (k.secret || k.lie) continue;
      for (const [who, w] of Object.entries(k.implicates || {})) score[who] += w;
    }
  }
  const m = s.truth.murderer;
  for (const id of charIds) {
    if (id !== m) need(score[m] > score[id], `不可解：指向凶手的证据权重(${score[m]}) 不高于 ${id}(${score[id]})`);
  }
  return errors;
}

/** 剧本中允许公开给所有玩家的信息（不含任何角色私密剧本与真相）。 */
export function publicScenarioView(s) {
  return {
    id: s.id, title: s.title, subtitle: s.subtitle, background: s.background, intro: s.intro,
    victim: s.victim,
    locations: s.locations.map(({ id, name, description, x, y, image }) => ({ id, name, description, x, y, ...(image ? { image } : {}) })),
    ...(s.cover ? { cover: s.cover } : {}),
    characters: s.characters.map(({ id, name, color, publicBio, portrait, voice }) => ({ id, name, color, publicBio, ...(portrait ? { portrait } : {}), ...(voice ? { voice } : {}) })),
    relationships: s.relationships.filter((r) => r.public).map(({ a, b, label }) => ({ a, b, label })),
    victimRelationships: s.victimRelationships,
    clueCount: s.clues.length,
    config: s.config,
  };
}

/** 线索中可以展示给持有者的字段（作者标注的 implicates/requires 不暴露）。 */
export function clueCard(clue, locations) {
  const loc = locations.find((l) => l.id === clue.location);
  return { id: clue.id, title: clue.title, text: clue.text, time: clue.time || '', location: clue.location, locationName: loc?.name || clue.location, ...(clue.media?.length ? { media: [...clue.media] } : {}) };
}

/**
 * 难度体检：不影响能否加载，只给作者提示。返回 { stats, warnings }。
 * murdererShare：所有线索中指向凶手的正权重占全部正权重的比例，越高越容易。
 */
export function lintScenario(s) {
  const warnings = [];
  const m = s.truth.murderer;
  const pos = Object.fromEntries(s.characters.map((c) => [c.id, 0]));
  let maxSingle = 0;
  for (const c of s.clues) {
    for (const [who, w] of Object.entries(c.implicates || {})) if (w > 0) pos[who] += w;
    maxSingle = Math.max(maxSingle, c.implicates?.[m] || 0);
  }
  const total = Object.values(pos).reduce((a, b) => a + b, 0) || 1;
  const murdererShare = pos[m] / total;
  const redHerrings = s.characters.filter((c) => c.id !== m && pos[c.id] >= pos[m] * 0.5).length;
  const searches = s.config.rounds.reduce((a, r) => a + r.investigate, 0) * s.characters.length;
  const gated = s.clues.filter((c) => c.requires?.length).length;
  const stats = {
    players: s.characters.length, locations: s.locations.length, clues: s.clues.length, searches,
    murdererShare: Number(murdererShare.toFixed(2)), maxSingleClueOnMurderer: maxSingle,
    redHerrings, gatedClues: gated, contradictions: (s.contradictions || []).length,
    weights: pos,
    media: { images: Object.values(s.assets || {}).filter((a) => a.type === 'image').length, audio: Object.values(s.assets || {}).filter((a) => a.type === 'audio').length, cover: !!s.cover, portraits: s.characters.filter((c) => c.portrait).length, voices: s.characters.filter((c) => c.voice).length },
  };
  if (murdererShare > 0.5) warnings.push(`指向凶手的线索权重占 ${Math.round(murdererShare * 100)}%，案子可能太容易（建议 ≤ 40%）`);
  if (maxSingle >= 4) warnings.push(`有线索单独指向凶手的权重达到 ${maxSingle}，可能一条线索就能破案（建议 ≤ 3）`);
  if (redHerrings < 2) warnings.push(`强干扰嫌疑人只有 ${redHerrings} 个（线索权重达到凶手一半以上的其他角色），建议至少 2 个`);
  if (!gated) warnings.push('没有使用 requires 前置线索，推理链可能偏短');
  if (searches < s.clues.length) warnings.push(`总搜证次数 ${searches} 少于线索数 ${s.clues.length}，部分线索注定找不到`);
  if (searches > s.clues.length * 2) warnings.push(`总搜证次数 ${searches} 远多于线索数 ${s.clues.length}，后期搜证会大量落空`);
  for (const c of s.characters) {
    if (c.id === m) continue;
    if (!(c.knowledge || []).some((k) => k.secret)) warnings.push(`${c.name} 没有秘密（knowledge 中没有 secret: true）`);
  }
  if (!(s.contradictions || []).length) warnings.push('没有预埋矛盾（contradictions），AI 与评测会少一类推理');
  for (const c of s.characters) if ((c.script || '').length < 150) warnings.push(`${c.name} 的剧本少于 150 字，玩家可能不知道该怎么演`);
  return { stats, warnings };
}

// ---------- 多语言 ----------
// 剧本的原文语言由 language 声明；translations.<lang> 按 id 覆盖可翻译的文本字段。
// 结构见 docs/openjubensha.md「翻译」一节。引擎、校验、作者标注都与语言无关。

export const LANGS = ['zh', 'en'];
export const baseLang = (s) => String(s?.language || 'zh-CN').slice(0, 2).toLowerCase();
export const scenarioLangs = (s) => [...new Set([baseLang(s), ...Object.keys(s?.translations || {})])];

/** 返回某种语言的剧本副本（没有翻译的字段保留原文）。 */
export function localizeScenario(s, lang) {
  if (!lang || lang === baseLang(s) || !s.translations?.[lang]) return s;
  const t = s.translations[lang];
  const pick = (v, fallback) => (typeof v === 'string' && v ? v : fallback);
  const out = structuredClone(s);
  for (const k of ['title', 'subtitle', 'background', 'intro']) out[k] = pick(t[k], s[k]);
  out.victim = { ...s.victim, name: pick(t.victim?.name, s.victim.name), bio: pick(t.victim?.bio, s.victim.bio) };
  out.locations = s.locations.map((l) => ({ ...l, name: pick(t.locations?.[l.id]?.name, l.name), description: pick(t.locations?.[l.id]?.description, l.description) }));
  out.characters = s.characters.map((c) => {
    const tc = t.characters?.[c.id] || {};
    return {
      ...c,
      ...Object.fromEntries(['name', 'publicBio', 'personality', 'script', 'coverStory'].map((k) => [k, pick(tc[k], c[k])])),
      knowledge: (c.knowledge || []).map((k) => ({ ...k, text: pick(tc.knowledge?.[k.id], k.text) })),
      objectives: c.objectives.map((o, i) => ({ ...o, desc: pick(tc.objectives?.[i], o.desc) })),
    };
  });
  out.relationships = (s.relationships || []).map((r, i) => ({ ...r, label: pick(t.relationships?.[i], r.label) }));
  out.victimRelationships = (s.victimRelationships || []).map((r, i) => ({ ...r, label: pick(t.victimRelationships?.[i], r.label) }));
  out.clues = s.clues.map((c) => ({ ...c, title: pick(t.clues?.[c.id]?.title, c.title), text: pick(t.clues?.[c.id]?.text, c.text) }));
  out.contradictions = (s.contradictions || []).map((x) => ({ ...x, text: pick(t.contradictions?.[x.id], x.text) }));
  out.truth = {
    ...s.truth,
    summary: pick(t.truth?.summary, s.truth.summary),
    weapon: pick(t.truth?.weapon, s.truth.weapon),
    timeline: s.truth.timeline.map((e, i) => ({ ...e, text: pick(t.truth?.timeline?.[i], e.text) })),
    secrets: (s.truth.secrets || []).map((e, i) => ({ ...e, text: pick(t.truth?.secrets?.[i], e.text) })),
  };
  if (s.assets) {
    out.assets = Object.fromEntries(Object.entries(s.assets).map(([id, a]) => {
      const o = t.assets?.[id] || {};
      return [id, { ...a, src: o.src || a.src, alt: pick(o.alt, a.alt), ...(a.transcript ? { transcript: pick(o.transcript, a.transcript) } : {}) }];
    }));
  }
  out.characters = out.characters.map((c) => (c.voice && t.characters?.[c.id]?.voice?.style ? { ...c, voice: { ...c.voice, style: t.characters[c.id].voice.style } } : c));
  out.phaseNarration = Object.fromEntries(Object.entries(s.phaseNarration || {}).map(([k, v]) => [k, pick(t.phaseNarration?.[k], v)]));
  out.language = lang;
  delete out.translations;
  return out;
}

/** 翻译覆盖率：列出缺失的字段路径。 */
export function translationCoverage(s, lang) {
  const t = s.translations?.[lang];
  if (!t) return { lang, total: 0, missing: ['（整份翻译）'], ratio: 0 };
  const missing = []; let total = 0;
  const need = (v, path, src) => { if (src === undefined || src === '') return; total++; if (typeof v !== 'string' || !v.trim()) missing.push(path); };
  for (const k of ['title', 'subtitle', 'background', 'intro']) need(t[k], k, s[k]);
  need(t.victim?.name, 'victim.name', s.victim.name); need(t.victim?.bio, 'victim.bio', s.victim.bio);
  for (const l of s.locations) { need(t.locations?.[l.id]?.name, `locations.${l.id}.name`, l.name); need(t.locations?.[l.id]?.description, `locations.${l.id}.description`, l.description); }
  for (const c of s.characters) {
    const tc = t.characters?.[c.id] || {};
    for (const k of ['name', 'publicBio', 'personality', 'script', 'coverStory']) need(tc[k], `characters.${c.id}.${k}`, c[k]);
    for (const k of c.knowledge || []) need(tc.knowledge?.[k.id], `characters.${c.id}.knowledge.${k.id}`, k.text);
    c.objectives.forEach((o, i) => need(tc.objectives?.[i], `characters.${c.id}.objectives[${i}]`, o.desc));
  }
  (s.relationships || []).forEach((r, i) => need(t.relationships?.[i], `relationships[${i}]`, r.label));
  (s.victimRelationships || []).forEach((r, i) => need(t.victimRelationships?.[i], `victimRelationships[${i}]`, r.label));
  for (const c of s.clues) { need(t.clues?.[c.id]?.title, `clues.${c.id}.title`, c.title); need(t.clues?.[c.id]?.text, `clues.${c.id}.text`, c.text); }
  for (const x of s.contradictions || []) need(t.contradictions?.[x.id], `contradictions.${x.id}`, x.text);
  need(t.truth?.summary, 'truth.summary', s.truth.summary); need(t.truth?.weapon, 'truth.weapon', s.truth.weapon);
  s.truth.timeline.forEach((e, i) => need(t.truth?.timeline?.[i], `truth.timeline[${i}]`, e.text));
  (s.truth.secrets || []).forEach((e, i) => need(t.truth?.secrets?.[i], `truth.secrets[${i}]`, e.text));
  for (const [k, v] of Object.entries(s.phaseNarration || {})) need(t.phaseNarration?.[k], `phaseNarration.${k}`, v);
  for (const [id, a] of Object.entries(s.assets || {})) {
    need(t.assets?.[id]?.alt, `assets.${id}.alt`, a.alt);
    if (a.transcript) need(t.assets?.[id]?.transcript, `assets.${id}.transcript`, a.transcript);
  }
  for (const c of s.characters) if (c.voice?.style) need(t.characters?.[c.id]?.voice?.style, `characters.${c.id}.voice.style`, c.voice.style);
  return { lang, total, missing, ratio: total ? (total - missing.length) / total : 1 };
}
