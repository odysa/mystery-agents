// 多模态：剧本里的图片、音频与角色声音（OpenJubensha v1，见 docs/openjubensha.md 第 3.10 节）。
//
// 剧本在顶层 assets 里登记媒体，再从各处按 id 引用：
//   cover / victim.portrait / characters[].portrait / locations[].image   → 公开
//   clues[].media[]                                                        → 与线索同可见性（找到或公开后才可见）
//   characters[].media[]                                                   → 只有该角色可见（剧本附图、私人录音）
// 没有被引用的媒体谁都看不到。服务器按这个规则控制访问，知道 URL 也取不到不该看的东西。

export const IMAGE_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
export const AUDIO_EXT = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm' };
const MIME_OK = { image: new Set(Object.values(IMAGE_EXT)), audio: new Set(Object.values(AUDIO_EXT)) };
export const MAX_DATA_URI = 4 * 1024 * 1024; // 单个内嵌媒体（base64 后）最多 4MB
const ID = /^[\w-]{1,64}$/;
const REL = /^media\/[\w][\w./-]{0,200}$/;
export const VOICE = { gender: ['female', 'male', 'neutral'], age: ['child', 'young', 'adult', 'old'] };

const extOf = (p) => String(p).split('?')[0].split('.').pop().toLowerCase();

/** 媒体 src 的三种写法：包内相对路径 media/…、https 链接、data: 内嵌。返回错误字符串或 null。 */
export function checkSrc(src, type) {
  if (typeof src !== 'string' || !src) return '必须是字符串';
  if (src.startsWith('data:')) {
    const m = src.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) return 'data URI 必须是 data:<类型>;base64,<数据>';
    if (!MIME_OK[type].has(m[1])) return `不支持的${type === 'image' ? '图片' : '音频'}类型 ${m[1]}`;
    if (src.length > MAX_DATA_URI) return '内嵌媒体超过 4MB';
    return null;
  }
  if (/^https:\/\/[^\s"'<>]+$/.test(src)) return null;
  if (!REL.test(src) || src.includes('..')) return '必须是 media/ 开头的相对路径、https 链接或 data URI';
  const table = type === 'image' ? IMAGE_EXT : AUDIO_EXT;
  if (!table[extOf(src)]) return `扩展名必须是 ${Object.keys(table).join('/')} 之一`;
  return null;
}

/** 类型与引用检查。返回错误数组。 */
export function checkMedia(s) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  const assets = s.assets;
  if (assets !== undefined) {
    need(assets && typeof assets === 'object' && !Array.isArray(assets), 'assets 必须是 { 媒体id: {…} } 对象');
    for (const [id, a] of Object.entries(assets && typeof assets === 'object' ? assets : {})) {
      const p = `assets.${id}`;
      need(ID.test(id), `${p}：媒体 id 只能包含字母、数字、-、_`);
      need(a && (a.type === 'image' || a.type === 'audio'), `${p}.type 必须是 image 或 audio`);
      if (!a || !['image', 'audio'].includes(a.type)) continue;
      const e = checkSrc(a.src, a.type); need(!e, `${p}.src ${e}`);
      need(typeof a.alt === 'string' && a.alt.length > 0 && a.alt.length <= 500, `${p}.alt 必填（文字描述，最多 500 字），给看不到媒体的玩家和纯文本 AI 用`);
      if (a.transcript !== undefined) need(typeof a.transcript === 'string' && a.transcript.length <= 5000, `${p}.transcript 必须是字符串（最多 5000 字）`);
      for (const k of ['credit', 'license']) if (a[k] !== undefined) need(typeof a[k] === 'string' && a[k].length <= 200, `${p}.${k} 必须是字符串`);
    }
  }
  const has = (id, type) => assets && typeof assets === 'object' && assets[id] && (!type || assets[id].type === type);
  const ref = (id, path, type) => need(typeof id === 'string' && has(id, type), `${path} 引用的媒体「${id}」不存在${type ? `或不是${type === 'image' ? '图片' : '音频'}` : ''}`);
  const refs = (list, path) => {
    if (list === undefined) return;
    if (!Array.isArray(list)) return need(false, `${path} 必须是媒体 id 数组`);
    list.forEach((id, i) => ref(id, `${path}[${i}]`));
  };
  if (s.cover !== undefined) ref(s.cover, 'cover', 'image');
  if (s.victim?.portrait !== undefined) ref(s.victim.portrait, 'victim.portrait', 'image');
  for (const [i, c] of (Array.isArray(s.characters) ? s.characters : []).entries()) {
    if (c?.portrait !== undefined) ref(c.portrait, `characters[${i}].portrait`, 'image');
    refs(c?.media, `characters[${i}].media`);
    if (c?.voice !== undefined) {
      const v = c.voice; const p = `characters[${i}].voice`;
      need(v && typeof v === 'object' && !Array.isArray(v), `${p} 必须是对象`);
      if (v?.gender !== undefined) need(VOICE.gender.includes(v.gender), `${p}.gender 必须是 ${VOICE.gender.join(' / ')}`);
      if (v?.age !== undefined) need(VOICE.age.includes(v.age), `${p}.age 必须是 ${VOICE.age.join(' / ')}`);
      for (const k of ['pitch', 'rate']) if (v?.[k] !== undefined) need(Number.isFinite(v[k]) && v[k] >= 0.5 && v[k] <= 2, `${p}.${k} 必须是 0.5 到 2 的数字`);
      if (v?.style !== undefined) need(typeof v.style === 'string' && v.style.length <= 100, `${p}.style 必须是字符串（最多 100 字）`);
    }
  }
  for (const [i, l] of (Array.isArray(s.locations) ? s.locations : []).entries()) if (l?.image !== undefined) ref(l.image, `locations[${i}].image`, 'image');
  for (const [i, c] of (Array.isArray(s.clues) ? s.clues : []).entries()) refs(c?.media, `clues[${i}].media`);
  for (const [lang, t] of Object.entries(s.translations && typeof s.translations === 'object' ? s.translations : {})) {
    for (const [id, o] of Object.entries(t?.assets && typeof t.assets === 'object' ? t.assets : {})) {
      const p = `translations.${lang}.assets.${id}`;
      need(has(id), `${p}：媒体「${id}」不存在`);
      if (!has(id)) continue;
      if (o?.src !== undefined) { const e = checkSrc(o.src, assets[id].type); need(!e, `${p}.src ${e}`); }
      if (o?.voiceStyle !== undefined) need(typeof o.voiceStyle === 'string', `${p}.voiceStyle 必须是字符串`);
    }
    for (const [cid, tc] of Object.entries(t?.characters || {})) {
      if (tc?.voice !== undefined) need(typeof tc.voice?.style === 'string' || tc.voice?.style === undefined, `translations.${lang}.characters.${cid}.voice.style 必须是字符串`);
    }
  }
  return errors;
}

/**
 * 每个媒体的可见范围：{ public, clues:Set<clueId>, chars:Set<pid> }。
 */
export function assetVisibility(s) {
  const vis = {};
  const at = (id) => (vis[id] ||= { public: false, clues: new Set(), chars: new Set() });
  if (s.cover) at(s.cover).public = true;
  if (s.victim?.portrait) at(s.victim.portrait).public = true;
  for (const c of s.characters) {
    if (c.portrait) at(c.portrait).public = true;
    for (const m of c.media || []) at(m).chars.add(c.id);
  }
  for (const l of s.locations) if (l.image) at(l.image).public = true;
  for (const c of s.clues) for (const m of c.media || []) at(m).clues.add(c.id);
  return vis;
}

/** viewer: { kind: 'god'|'spectator'|'player', pid }，state: 对局状态（clueOwner/publicClues）。 */
export function canSeeAsset(s, assetId, viewer, state) {
  const v = assetVisibility(s)[assetId];
  if (!v || !s.assets?.[assetId]) return false;
  if (viewer.kind === 'god' || v.public) return true;
  for (const c of v.clues) {
    if (state?.publicClues?.[c]) return true;
    if (viewer.kind === 'player' && state?.clueOwner?.[c] === viewer.pid) return true;
  }
  return viewer.kind === 'player' && v.chars.has(viewer.pid);
}

/** 媒体的 MIME 类型。 */
export function mimeOf(asset) {
  const src = asset.src;
  if (src.startsWith('data:')) return src.slice(5, src.indexOf(';'));
  return (asset.type === 'image' ? IMAGE_EXT : AUDIO_EXT)[extOf(src)] || 'application/octet-stream';
}

/** 媒体的对外描述（不含 src）。 */
export function assetInfo(asset) {
  return { type: asset.type, alt: asset.alt, ...(asset.transcript ? { transcript: asset.transcript } : {}), ...(asset.credit ? { credit: asset.credit } : {}) };
}

/** SVG 安全检查：不允许脚本、事件属性、外部引用。 */
export function unsafeSvg(text) {
  if (/<script\b|<foreignObject\b|\bon[a-z]+\s*=|javascript:/i.test(text)) return '包含脚本或事件属性';
  if (/(?:href|src)\s*=\s*["'](?!#|data:image\/)/i.test(text)) return '包含外部引用（只允许 #id 或 data:image）';
  if (/@import|url\(\s*['"]?(?!#|data:image\/)/i.test(text)) return '样式里包含外部引用';
  return null;
}

/** 检查剧本包里的媒体文件：存在、大小、SVG 安全。dir 是 scenarios/<剧本id>/。 */
export async function checkMediaFiles(s, dir, { readFile, stat }) {
  const errors = [];
  const srcs = [];
  for (const [id, a] of Object.entries(s.assets || {})) srcs.push([`assets.${id}`, a.src, a.type]);
  for (const [lang, t] of Object.entries(s.translations || {})) for (const [id, o] of Object.entries(t.assets || {})) if (o.src) srcs.push([`translations.${lang}.assets.${id}`, o.src, s.assets?.[id]?.type]);
  for (const [path, src, type] of srcs) {
    if (!src || src.startsWith('https://')) continue;
    if (src.startsWith('data:')) {
      if (type === 'image' && src.startsWith('data:image/svg+xml')) {
        const e = unsafeSvg(Buffer.from(src.split(',')[1], 'base64').toString('utf8'));
        if (e) errors.push(`${path}：SVG ${e}`);
      }
      continue;
    }
    const file = `${dir}/${src}`;
    let st;
    try { st = await stat(file); } catch { errors.push(`${path}：找不到文件 ${src}`); continue; }
    if (st.size > 8 * 1024 * 1024) errors.push(`${path}：文件超过 8MB`);
    if (src.endsWith('.svg')) { const e = unsafeSvg(await readFile(file, 'utf8')); if (e) errors.push(`${path}：SVG ${e}`); }
  }
  return errors;
}
