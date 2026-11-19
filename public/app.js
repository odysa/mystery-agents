// MysteryAgents 前端（零依赖单页应用）
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式 */ } },
};

// 语言：LANG / T() / setLang() / applyTheme() 由 i18n.js 定义
const LOCALE = LANG === 'en' ? 'en-US' : 'zh-CN';
const HEADERS = { 'content-type': 'application/json', 'x-ma-lang': LANG };
// 剧本库条目的本地化标题 / 副标题
const scT = (x, k) => x?.i18n?.[LANG]?.[k] || x?.[k];

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: HEADERS, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || T('请求失败 ({status})', { status: res.status }));
  return data;
}

function loadingHTML(msg) {
  return `<div class="loading"><div class="loading-seal" aria-hidden="true"><span>${esc(T('谜'))}</span></div><div class="loading-text">${msg}</div></div>`;
}

function syncThemeUI() {
  const cur = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const btn = document.querySelector('[data-theme-toggle]');
  if (!btn) return;
  const icon = btn.querySelector('.theme-icon');
  const label = btn.querySelector('[data-theme-label]');
  if (icon) icon.textContent = cur === 'dark' ? '🕯️' : '☀️';
  if (label) label.textContent = cur === 'dark' ? T('烛影') : T('昼阅');
  const tip = cur === 'dark' ? T('切换为白昼模式') : T('切换为烛影模式');
  btn.title = tip;
  btn.setAttribute('aria-label', tip);
  btn.setAttribute('aria-pressed', String(cur === 'light'));
}

function syncNavUI(hashPath) {
  document.querySelectorAll('.topnav a[data-nav]').forEach((a) => {
    const target = a.dataset.nav;
    const isActive = target === '/' ? hashPath === '/' : hashPath.startsWith(target);
    a.classList.toggle('active', isActive);
    if (isActive) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const inGame = hashPath.startsWith('/game/') || hashPath.startsWith('/watch/');
  document.body.classList.toggle('in-game', inGame);
}

// 静态外壳（index.html）的翻译、主题与语言切换
function initShell() {
  document.documentElement.lang = LANG === 'en' ? 'en' : 'zh-CN';
  document.title = T('谜案 · MysteryAgents 剧本杀');
  document.querySelector('meta[name="description"]')?.setAttribute('content', T('开源剧本杀多智能体平台：和 AI 角色一起玩剧本杀，或观看 AI 全自动推理对局。'));
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
  document.querySelectorAll('.loading-seal span').forEach((el) => { el.textContent = T('谜'); });
  document.querySelectorAll('[data-setlang]').forEach((b) => {
    b.classList.toggle('on', b.dataset.setlang === LANG);
    b.setAttribute('aria-pressed', String(b.dataset.setlang === LANG));
    b.onclick = () => { if (b.dataset.setlang !== LANG) setLang(b.dataset.setlang); };
  });
  const themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(next, true);
      syncThemeUI();
    };
  }
  syncThemeUI();
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => syncThemeUI());
  } catch { /* 旧浏览器 */ }
}
initShell();

function toast(msg, ms = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

const KIND_LABEL = { external: T('玩家的 Agent'), open: T('空位'), webhook: 'Webhook Agent', human: T('真人'), rule: T('规则型 AI'), claude: 'Claude', openai: T('OpenAI 兼容') };
const PHASE_LABEL = { lobby: T('准备'), intro: T('开场'), investigate: T('搜证'), discuss: T('讨论'), vote: T('投票'), ended: T('结局') };
// 模型提供方名称：服务器尚未本地化（仍含中文）时，在前端兜底翻译
const HAN = /[\u4e00-\u9fa5]/;
function provName(p) {
  if (LANG === 'zh' || !HAN.test(p.name || '')) return p.name;
  const m = String(p.name).match(/^(.*?)（(.*)）$/);
  if (!m) return T(p.name);
  return `${T(m[1])} (${HAN.test(m[2]) ? T(m[2]) : m[2]})`;
}
function provHint(p) {
  if (LANG === 'zh' || !HAN.test(p.hint || '')) return p.hint || '';
  const m = String(p.hint).match(/^设置 ([\w /]+)/);
  return m ? T('设置 {v}', { v: m[1].trim() }) : '';
}
// 服务器返回的难度值是中文，统一经 T() 映射
const DIFF = (d) => (['入门', '进阶', '困难'].includes(d) ? T(d) : d);

// ======================= 路由 =======================
let cleanup = null;
function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const h = location.hash.replace(/^#/, '') || '/';
  const j = h.match(/^\/join\/([\w-]+)\/([\w-]+)\/([0-9a-f]+)/);
  if (j) { store.set(`ma_token_${j[1]}`, `${j[2]}:${j[3]}`); location.replace(`#/game/${j[1]}`); return; }
  syncNavUI(h);
  const w = h.match(/^\/watch\/([\w-]+)/);
  if (w) return renderGame(w[1], { watch: true });
  const m = h.match(/^\/game\/([\w-]+)/);
  if (m) return renderGame(m[1]);
  if (h.startsWith('/games')) return renderGames();
  if (h.startsWith('/about')) return renderAbout();
  if (h.startsWith('/submit')) return renderSubmit();
  if (h.startsWith('/agents')) return renderAgents();
  return renderLobby();
}
// 启动见文件末尾（所有 const 初始化之后再渲染，避免直接打开 #/submit 时的暂时性死区）

// ======================= 大厅 =======================
async function renderLobby() {
  $app.innerHTML = loadingHTML(T('加载剧本…'));
  let scenarios, providers;
  try { [scenarios, providers] = await Promise.all([api('/api/scenarios'), api('/api/providers')]); } catch (e) { $app.innerHTML = loadingHTML(T('无法连接服务器：{msg}', { msg: esc(e.message) })); return; }
  const sc = scenarios.find((x) => x.id === store.get('ma_scenario')) || scenarios[0];
  const full = await api(`/api/scenarios/${sc.id}?lang=${LANG}`).catch(() => null);
  const chars = full?.characters || [];
  MEDIA = full?.media || {};
  const cover = img(full?.cover);
  const seats = Object.fromEntries(chars.map((c) => [c.id, 'rule']));
  const readyProviders = providers.filter((p) => p.ready);
  const bestAI = readyProviders.find((p) => p.id !== 'rule')?.id || 'rule';
  for (const id of Object.keys(seats)) seats[id] = bestAI;

  const opts = (cur) => [
    `<option value="human" ${cur === 'human' ? 'selected' : ''}>🙋 ${T('真人玩家')}</option>`,
    `<option value="external" ${cur === 'external' ? 'selected' : ''}>🧠 ${T('我的 Agent')}</option>`,
    `<option value="open" ${cur === 'open' ? 'selected' : ''}>🚪 ${T('空位（任何人的 Agent 可加入）')}</option>`,
    ...providers.map((p) => `<option value="${p.id}" ${cur === p.id ? 'selected' : ''} ${p.ready ? '' : 'disabled'}>🤖 ${esc(provName(p))}${p.ready ? '' : T('（未配置）')}</option>`),
  ].join('');

  const victim = full?.victim;
  const diffCls = sc.difficulty === '困难' ? 'red' : sc.difficulty === '入门' ? 'green' : 'gold';

  const draw = () => {
    $app.innerHTML = `
      <section class="hero">
        <article class="poster ${cover ? 'has-cover' : ''}">
          ${cover ? `<img class="poster-cover" src="${esc(cover.url)}" alt="${esc(cover.alt)}" decoding="async"><div class="poster-shade"></div>` : ''}
          <div class="rain" aria-hidden="true"></div>
          <div class="poster-corners" aria-hidden="true"></div>
          <div class="poster-top">
            <span class="dossier-stamp">${T('当前调阅卷宗')}</span>
            <span class="pill ${diffCls} poster-pill">${T('原创剧本 · {diff} · {n} 人 · 约 {min} 分钟', { diff: esc(DIFF(sc.difficulty)), n: sc.players, min: sc.estimatedMinutes })}</span>
          </div>
          <div class="poster-body">
            <h1>${esc(full?.title || scT(sc, 'title'))}</h1>
            <p class="sub">${esc(full?.subtitle || scT(sc, 'subtitle'))}</p>
            ${victim ? `<div class="victim-strip">
              ${avatar({ ...victim, color: '#6b221c' }, 'sm victim-av')}
              <div class="victim-meta">
                <span class="victim-tag">${T('死者：{name}', { name: `<b>${esc(victim.name)}</b>` })}</span>
                ${victim.bio ? `<span class="victim-bio">${esc(victim.bio)}</span>` : ''}
              </div>
            </div>` : ''}
            <div class="story-sheet"><div class="story">${esc(full?.background || '')}</div></div>
          </div>
        </article>

        <div class="quick">
          <div class="kicker-bar"><span>${T('入局方式')}</span><span class="kicker-line"></span></div>
          <div class="card play-card featured">
            <div class="play-card-head">
              <span class="mode-num">I</span>
              <h3>🕯️ ${T('和 AI 一起玩')}</h3>
            </div>
            <p class="muted small">${T('你扮演一名角色，另外 {n} 名角色由 AI 扮演。AI 只知道自己角色的信息，会搜证、隐瞒、质询，也可能撒谎。', { n: chars.length - 1 })}</p>
            <div class="row play-actions">
              <select id="quickRole">${chars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}<option value="__random" selected>${T('随机分配角色')}</option></select>
              <button class="btn primary big" id="quickPlay">${T('开始游戏')}</button>
            </div>
          </div>

          <div class="card play-card">
            <div class="play-card-head">
              <span class="mode-num">II</span>
              <h3>🧠 ${T('让你的 Agent 来玩')}</h3>
            </div>
            <p class="muted small">${T('Claude Code、Cursor、ChatGPT……任何能发 HTTP 请求的 Agent 都能入座。开局后把提示词复制给它，或者开空位让任何人的 Agent 来认领。')}</p>
            <div class="row play-actions">
              <select id="agentRole">${chars.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
              <button class="btn" id="agentPlay">${T('给我的 Agent 开一局')}</button>
              <button class="btn ghost" id="agentOpen">${T('开放空位')}</button>
            </div>
          </div>

          <div class="card play-card">
            <div class="play-card-head">
              <span class="mode-num">III</span>
              <h3>👁️ ${T('观看 AI 全自动对局')}</h3>
            </div>
            <p class="muted small">${T('{n} 名 AI 自主完成整局剧本杀。可开启「上帝视角」，实时查看每个 AI 的内心想法与嫌疑度变化。开局后点「🔗 分享观战」，把链接发给朋友一起围观。', { n: chars.length })}</p>
            <div class="row play-actions">
              <button class="btn big" id="quickWatch">${T('开始观战')}</button>
            </div>
          </div>

          <div class="card provider-card small">
            <div class="provider-row">
              <b class="provider-title">${T('可用的 AI：')}</b>
              <div class="provider-pills">
                ${providers.map((p) => `<span class="pill ${p.ready ? 'green' : ''}" title="${esc(provHint(p))}"><i class="lamp ${p.ready ? 'on' : ''}"></i>${esc(provName(p))}${p.ready ? '' : ' · ' + T('未配置')}</span>`).join('')}
              </div>
            </div>
            ${readyProviders.length === 1 ? `<div class="faint provider-hint">${T('当前只有离线规则型 AI。设置 {a} 或 {b} 后重启服务即可使用大模型角色。', { a: '<code>ANTHROPIC_API_KEY</code>', b: '<code>OPENAI_BASE_URL</code>' })}</div>` : ''}
          </div>
        </div>
      </section>

      <section class="archive-section">
        <div class="section-title">
          <div class="section-heading">
            <span class="section-kicker">${T('案件编号')} 01–${String(scenarios.length).padStart(2, '0')}</span>
            <h2>${T('剧本库')}</h2>
          </div>
          <span class="muted small">${T('共 {n} 个原创剧本，点击切换', { n: scenarios.length })}</span>
        </div>
        <div class="library">
          ${scenarios.map((x, idx) => {
            const active = x.id === sc.id;
            const dCls = x.difficulty === '困难' ? 'red' : x.difficulty === '入门' ? 'green' : 'gold';
            const titleStr = scT(x, 'title') || x.title || '';
            return `
            <button type="button" class="scard ${active ? 'on' : ''} ${x.cover ? 'has-cover' : 'no-cover'}" data-sc="${esc(x.id)}" aria-pressed="${active}">
              <span class="scard-cover">
                ${x.cover ? `<img src="${esc(x.cover)}" alt="${esc(x.coverAlt || '')}" loading="lazy" decoding="async">` : `<span class="scard-monogram" aria-hidden="true">${esc(titleStr[0] || '?')}</span>`}
                <span class="scard-serial">#${String(idx + 1).padStart(2, '0')}</span>
                ${active ? `<span class="scard-active-seal">${T('已调阅')}</span>` : ''}
              </span>
              <div class="scard-body">
                <div class="scard-head">
                  <b>${T('《{title}》', { title: esc(titleStr) })}${x.source === 'community' ? ` <span class="pill">${T('社区')}</span>` : ''}</b>
                  <span class="pill ${dCls}">${esc(DIFF(x.difficulty))}</span>
                </div>
                <span class="small muted scard-sub">${esc(scT(x, 'subtitle'))}</span>
                <span class="small faint scard-meta">${T('{n} 人 · {locs} 个地点 · {clues} 条线索 · 约 {min} 分钟', { n: x.players, locs: x.locations, clues: x.clues, min: x.estimatedMinutes })}${x.media?.images ? ` · <span title="${esc(T('{n} 张图片', { n: x.media.images }))}">🖼️ ${x.media.images}</span>` : ''}${x.media?.audio ? ` · <span title="${esc(T('{n} 段录音', { n: x.media.audio }))}">🎧 ${x.media.audio}</span>` : ''}</span>
              </div>
            </button>`;
          }).join('')}
        </div>
      </section>

      <section class="seats-section card">
        <div class="section-title seats-header">
          <div class="section-heading">
            <span class="section-kicker">${T('角色席位与先手设定')}</span>
            <h2>${T('自定义座位')}</h2>
          </div>
          <span class="muted small">${T('为每个角色选择由谁扮演。可以设多名真人：你扮演第一个真人座位，开局后把其余座位的邀请链接发给朋友')}</span>
        </div>
        <div class="seats">
          ${chars.map((c) => {
            const isSpecial = ['human', 'external', 'open'].includes(seats[c.id]);
            return `
            <div class="seat ${isSpecial ? 'human' : ''}" style="--char-color:${esc(c.color || 'var(--accent)')}">
              <div class="who">
                ${avatar(c)}
                <div class="who-meta">
                  <b>${esc(c.name)}</b>
                  <span class="seat-kind">${esc(KIND_LABEL[seats[c.id]] || seats[c.id])}</span>
                </div>
              </div>
              <p>${esc(c.publicBio)}</p>
              <select data-seat="${c.id}" aria-label="${esc(c.name)}">${opts(seats[c.id])}</select>
            </div>`;
          }).join('')}
        </div>
        <div class="launch-bar">
          <div class="launch-controls">
            <label class="control-field small">
              <span class="muted">${T('AI 行动间隔')}</span>
              <input type="range" id="speed" min="0" max="4000" step="200" value="${store.get('ma_speed') || 1200}">
              <span class="mono-val" id="speedv"></span>
            </label>
            <label class="control-field small">
              <span class="muted">${T('随机种子')}</span>
              <input type="number" id="seed" placeholder="${T('随机')}" class="seed-input">
            </label>
          </div>
          <button class="btn primary big" id="customStart">${T('按以上配置开始')}</button>
        </div>
      </section>`;

    $app.querySelectorAll('[data-sc]').forEach((b) => {
      b.onclick = () => { store.set('ma_scenario', b.dataset.sc); renderLobby().then(() => window.scrollTo({ top: 0, behavior: 'smooth' })); };
    });
    const sp = document.getElementById('speed');
    const spv = document.getElementById('speedv');
    const upd = () => { spv.textContent = T('{s} 秒', { s: (sp.value / 1000).toFixed(1) }); store.set('ma_speed', sp.value); };
    sp.oninput = upd; upd();
    $app.querySelectorAll('select[data-seat]').forEach((s) => {
      s.onchange = () => {
        seats[s.dataset.seat] = s.value; draw();
      };
    });
    const start = async (seatCfg) => {
      try {
        const seedV = document.getElementById('seed').value;
        const r = await api('/api/games', { method: 'POST', body: { scenarioId: sc.id, lang: LANG, seats: seatCfg, speedMs: Number(sp.value), ...(seedV ? { seed: Number(seedV) } : {}) } });
        store.set(`ma_host_${r.id}`, r.hostToken);
        const agentSeats = Object.fromEntries(Object.entries(r.tokens || {}).filter(([pid]) => seatCfg[pid] === 'external'));
        if (Object.keys(agentSeats).length) store.set(`ma_agents_${r.id}`, JSON.stringify(agentSeats));
        const humanSeats = chars.map((c) => c.id).filter((pid) => r.tokens?.[pid] && seatCfg[pid] === 'human');
        if (humanSeats.length) {
          store.set(`ma_token_${r.id}`, `${humanSeats[0]}:${r.tokens[humanSeats[0]]}`);
          const invites = Object.fromEntries(humanSeats.slice(1).map((pid) => [pid, r.tokens[pid]]));
          if (Object.keys(invites).length) store.set(`ma_invites_${r.id}`, JSON.stringify(invites));
        }
        location.hash = `#/game/${r.id}`;
      } catch (e) { toast(e.message); }
    };
    document.getElementById('quickPlay').onclick = () => {
      let role = document.getElementById('quickRole').value;
      if (role === '__random') role = chars[Math.floor(Math.random() * chars.length)].id;
      start(Object.fromEntries(chars.map((c) => [c.id, c.id === role ? 'human' : bestAI])));
    };
    document.getElementById('agentPlay').onclick = () => { const role = document.getElementById('agentRole').value; start(Object.fromEntries(chars.map((c) => [c.id, c.id === role ? 'external' : bestAI]))); };
    document.getElementById('agentOpen').onclick = () => { const role = document.getElementById('agentRole').value; start(Object.fromEntries(chars.map((c) => [c.id, c.id === role ? 'open' : bestAI]))); };
    document.getElementById('quickWatch').onclick = () => start(Object.fromEntries(chars.map((c) => [c.id, bestAI])));
    document.getElementById('customStart').onclick = () => start(seats);
  };
  draw();
}

// ======================= 对局记录 =======================
async function renderGames() {
  $app.innerHTML = loadingHTML(T('加载中…'));
  const games = await api('/api/games').catch(() => []);
  $app.innerHTML = `
    <header class="page-banner">
      <div>
        <span class="section-kicker">${T('案卷归档室')}</span>
        <h2>${T('对局记录')}</h2>
        <p class="muted small">${T('记录本服务器上的直播对局与结案回放')}</p>
      </div>
      <a class="btn primary" href="#/">+ ${T('新对局')}</a>
    </header>
    ${games.length ? `<div class="card ledger-card"><table class="table ledger-table"><thead><tr><th>${T('时间')}</th><th>${T('剧本')}</th><th>${T('座位')}</th><th>${T('状态')}</th><th>${T('操作')}</th></tr></thead><tbody>
      ${games.map((g) => {
        const humans = Object.values(g.seats).filter((k) => k === 'human').length;
        const kinds = [...new Set(Object.values(g.seats).filter((k) => k !== 'human'))].map((k) => KIND_LABEL[k] || k).join(T('、'));
        const status = g.ended ? (g.result.goodWin ? `<span class="pill green">${T('侦探方胜')}</span>` : `<span class="pill red">${T('凶手逃脱')}</span>`) : `<span class="pill gold">${PHASE_LABEL[g.phase]}${g.round ? ' ' + g.round : ''}</span>`;
        return `<tr>
          <td data-label="${esc(T('时间'))}" class="muted mono-cell">${new Date(g.createdAt).toLocaleString(LOCALE)}</td>
          <td data-label="${esc(T('剧本'))}"><b class="serif-cell">${T('《{title}》', { title: esc(scT(g, 'title')) })}</b></td>
          <td data-label="${esc(T('座位'))}">${humans ? `${T('{n} 真人', { n: humans })}${kinds ? ' + ' : ''}` : ''}${esc(kinds)}</td>
          <td data-label="${esc(T('状态'))}">${status}${g.ended ? '' : ` <span class="small muted live-tag"><i class="live-dot"></i>${T('直播中')} · 👀 ${g.watchers}</span>`}</td>
          <td data-label="${esc(T('操作'))}" class="actions-cell">${g.ended ? `<a class="btn sm" href="#/game/${g.id}">${T('查看回放')}</a>` : `${store.get(`ma_token_${g.id}`) ? `<a class="btn sm primary" href="#/game/${g.id}">${T('继续游戏')}</a> ` : ''}<a class="btn sm" href="#/watch/${g.id}">${T('观战')}</a>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div>` : `
      <div class="card empty-state">
        <svg class="empty-illustration" viewBox="0 0 120 88" fill="none" aria-hidden="true">
          <path d="M16 24h34l8 10h46v40a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V24z" stroke="currentColor" stroke-width="2" opacity=".55"/>
          <path d="M22 18h28l6 6H16v-2a4 4 0 0 1 6-4z" stroke="currentColor" stroke-width="1.5" opacity=".35"/>
          <circle cx="62" cy="52" r="14" stroke="var(--accent-2)" stroke-width="2.2"/>
          <line x1="72" y1="62" x2="84" y2="74" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <h3>${T('还没有对局。')}</h3>
        <p class="muted small">${T('档案柜里还没有对局记录。前往大厅挑选一桩悬案，与 AI 同桌飙戏或围观推理。')}</p>
        <a class="btn primary" href="#/">${T('去大厅开启第一桩案件')}</a>
      </div>`}`;
}

function renderAbout() {
  const pillars = [
    ['确定性规则引擎', '：阶段、回合、搜证、投票全部由引擎裁决，大模型只负责「想」和「说」。', `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="12" stroke="currentColor" stroke-width="1.8"/><path d="M16 9v7l5 3" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round"/></svg>`],
    ['严格的信息隔离', '：每个 AI 只能看到自己角色的剧本、自己找到的线索和公开信息，服务器端过滤。', `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="6" y="13" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M11 13V9a5 5 0 0 1 10 0v4" stroke="var(--accent)" stroke-width="1.8"/><circle cx="16" cy="20" r="2" fill="var(--accent-2)"/></svg>`],
    ['事件溯源', '：每个动作都是一条结构化事件，可回放、可复现、可评测。', `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 10h20M6 16h14M6 22h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="24" cy="16" r="3" stroke="var(--accent-2)" stroke-width="1.8"/></svg>`],
    ['可插拔模型', '：离线规则型 AI、Claude，以及任何 OpenAI 兼容接口（DeepSeek、通义千问、Kimi、Ollama…）。', `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="18" y="6" width="8" height="8" rx="1.5" stroke="var(--accent-2)" stroke-width="1.8"/><rect x="12" y="18" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M10 14v3h12v-3M16 17v1" stroke="var(--accent)" stroke-width="1.6"/></svg>`],
  ];
  $app.innerHTML = `
    <div class="about-dossier">
      <article class="card about-hero">
        <span class="section-kicker">${T('侦缉卷宗与多智能体推理剧场')}</span>
        <h2>${T('关于 MysteryAgents')}</h2>
        <p class="about-lead">${T('MysteryAgents 是一个开源的剧本杀多智能体平台，既是可以直接玩的游戏，也是研究多智能体推理、记忆、信息不对称与策略欺骗的实验环境。')}</p>
      </article>

      <div class="section-title">
        <div class="section-heading">
          <span class="section-kicker">${T('核心机制')}</span>
        </div>
      </div>
      <div class="pillar-grid">
        ${pillars.map(([titleKey, descKey, icon]) => {
          const raw = T(descKey).replace(/^[：:]\s*/, '');
          const desc = LANG === 'en' && raw ? raw[0].toUpperCase() + raw.slice(1) : raw;
          return `
          <div class="card pillar-card">
            <div class="pillar-icon">${icon}</div>
            <div>
              <h3>${T(titleKey)}</h3>
              <p class="muted small">${desc}</p>
            </div>
          </div>`;
        }).join('')}
      </div>

      <footer class="card about-colophon">
        <span class="section-kicker">${T('开源与创作许可')}</span>
        <p class="muted">${T('内置剧本均为本项目原创，采用 CC BY 4.0 许可。想写新剧本，请看仓库里的 docs/scenario-guide.md。')}</p>
      </footer>
    </div>`;
}

// ======================= 接入 Agent =======================
async function renderAgents() {
  $app.innerHTML = loadingHTML(T('加载中…'));
  const seats = await api('/api/open-seats').catch(() => []);
  $app.innerHTML = `
    <header class="page-banner">
      <div>
        <span class="section-kicker">${T('特工通讯处')}</span>
        <h2>${T('带上你自己的 Agent')}</h2>
        <p class="muted small">${T('Agent native：读说明、入座、投稿，都不需要人帮忙')}</p>
      </div>
    </header>
    <div class="agent-grid">
      <div class="card dispatch-card">
        <span class="dispatch-step">01</span>
        <h3>${T('① 最简单：复制一句话')}</h3>
        <p class="small muted">${T('发给 Claude Code、Cursor、Codex 或任何能上网、能发 HTTP 请求的 Agent。它会自己读说明、找空位或开局，玩完把结果告诉你。')}</p>
        ${copyBox(AGENT_PROMPTS.join(), { label: T('复制给 Agent') })}
      </div>
      <div class="card dispatch-card">
        <span class="dispatch-step">02</span>
        <h3>${T('② MCP（推荐给 Claude Code 等）')}</h3>
        <p class="small muted">${T('本服务器自带 MCP 端点。添加后，Agent 会多出 {tools} 等工具。', { tools: 'list_open_seats、create_game、join_game、wait_turn、act、check_scenario、submit_scenario'.split('、').join(T('、')) })}</p>
        ${copyBox(AGENT_PROMPTS.mcp(), { label: T('复制命令') })}
        <p class="small faint">${T('其他客户端：添加 HTTP 类型的 MCP 服务器，URL 填 {url}', { url: `<code>${esc(BASE)}/mcp</code>` })}</p>
      </div>
      <div class="card dispatch-card">
        <span class="dispatch-step">03</span>
        <h3>${T('③ 让 Agent 写剧本并投稿')}</h3>
        ${copyBox(AGENT_PROMPTS.write(), { label: T('复制提示词'), rows: 6 })}
      </div>
      <div class="card dispatch-card">
        <span class="dispatch-step">04</span>
        <h3>${T('④ 文档')}</h3>
        <ul class="doc-links small">
          <li><a href="${AGENT_MD}" target="_blank">/agent.md</a><span>${T('：给 Agent 读的完整说明（入座、玩、投稿、MCP）')}</span></li>
          <li><a href="/llms.txt" target="_blank">/llms.txt</a><span>${T('：站点索引')}</span></li>
          <li><div><a href="/openmystery.md" target="_blank">/openmystery.md</a>${T('：剧本格式规范')} · <a href="/schema/openmystery-1.schema.json" target="_blank">JSON Schema</a></div></li>
        </ul>
      </div>
    </div>
    <div class="section-title">
      <div class="section-heading">
        <h2>${T('等待 Agent 加入的空位')}</h2>
      </div>
      <span class="pill gold">${T('{n} 个', { n: seats.length })}</span>
    </div>
    ${seats.length ? `<div class="card ledger-card"><table class="table ledger-table"><thead><tr><th>${T('剧本')}</th><th>${T('角色')}</th><th>${T('局')}</th><th>${T('操作')}</th></tr></thead><tbody>${seats.map((x) => `<tr><td data-label="${esc(T('剧本'))}"><b class="serif-cell">${T('《{title}》', { title: esc(x.title) })}</b> <span class="pill">${x.lang === 'en' ? 'EN' : '中文'}</span></td><td data-label="${esc(T('角色'))}"><b>${esc(x.name)}</b> <span class="small muted">${esc(x.publicBio)}</span></td><td data-label="${esc(T('局'))}" class="small faint mono-cell">${esc(x.gameId)}</td><td data-label="${esc(T('操作'))}" class="actions-cell"><button class="btn sm primary" data-copytext="${esc(AGENT_PROMPTS.joinGame(x.gameId))}">${T('复制加入提示词')}</button> <a class="btn sm" href="#/watch/${esc(x.gameId)}">${T('观战')}</a></td></tr>`).join('')}</tbody></table></div>` : `<div class="card empty-state compact"><p class="muted small">${T('现在没有空位。在大厅里把某个座位设为「空位」，或者点「开放空位」。')}</p></div>`}`;
}

// ======================= 投稿剧本 =======================
function renderSubmit() {
  $app.innerHTML = `
    <header class="page-banner">
      <div>
        <span class="section-kicker">${T('审稿与试玩台')}</span>
        <h2>${T('投稿剧本')}</h2>
        <p class="muted small">${T('开放剧本杀格式 OpenMystery v1')}</p>
      </div>
    </header>
    <div class="submit-grid">
      <div class="card manuscript-card">
        <details class="agent-drawer small" open>
          <summary><b>🧠 ${T('让你的 Agent 来写')}</b>${T('：把这段复制给它（改一下题材）')}</summary>
          ${copyBox(AGENT_PROMPTS.write(), { label: T('复制提示词'), rows: 6 })}
        </details>
        <p class="small muted">${T('一个剧本就是一个 JSON 文件。写好后在这里校验、让 AI 试玩几十局估计难度，满意了再发布到社区剧本库，所有人都能在大厅里玩到。')}</p>
        <div class="row small manuscript-tools">
          <a class="btn sm" href="/api/scenarios/yuye-yaohuo/source" download="template.json">⬇ ${T('下载示例剧本（模板）')}</a>
          <a class="btn sm" href="/schema/openmystery-1.schema.json" download>⬇ JSON Schema</a>
          <label class="btn sm">📂 ${T('打开本地文件')}<input type="file" id="sfile" accept=".json,application/json" hidden></label>
        </div>
        <textarea id="stext" spellcheck="false" placeholder="${esc(T('把剧本 JSON 粘贴到这里，或点「打开本地文件」。\n在 VS Code 里给文件加上 {schema} 可以获得自动补全与校验。', { schema: `"$schema": "http://${T('<服务器地址>')}/schema/openmystery-1.schema.json"` }))}"></textarea>
        <div class="row submit-actions">
          <button class="btn" id="scheck">${T('校验并试玩')}</button>
          <button class="btn primary" id="spublish">${T('发布到社区')}</button>
          <span class="small muted busy-indicator" id="sbusy"></span>
        </div>
      </div>
      <div class="card report-card" id="sresult">
        <div class="report-placeholder">
          <div class="report-seal" aria-hidden="true"><span>✓</span></div>
          <h3>${T('等待呈交剧本手稿')}</h3>
          <p class="muted small">${T('校验结果会显示在这里：结构错误、难度提示、线索权重分布，以及离线 AI 试玩 30 局的结果。')}</p>
        </div>
      </div>
    </div>`;
  const ta = document.getElementById('stext');
  ta.value = store.get('ma_submit_draft') || '';
  ta.oninput = () => store.set('ma_submit_draft', ta.value);
  document.getElementById('sfile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    ta.value = await f.text(); store.set('ma_submit_draft', ta.value);
  };
  const out = document.getElementById('sresult');
  const busy = document.getElementById('sbusy');
  const send = async (publish) => {
    let scenario;
    try { scenario = JSON.parse(ta.value); } catch (e) { out.innerHTML = `<div class="report-status bad-box"><h3>❌ ${T('JSON 解析失败')}</h3><p class="bad small">${esc(e.message)}</p></div>`; return; }
    busy.textContent = publish ? T('发布中…（需要先试玩 30 局）') : T('AI 试玩中…');
    const res = await fetch(publish ? '/api/scenarios' : '/api/scenarios/check', { method: 'POST', headers: HEADERS, body: JSON.stringify({ scenario }) });
    const r = await res.json().catch(() => ({ errors: [T('服务器返回 {status}', { status: res.status })] }));
    busy.textContent = '';
    out.innerHTML = submitReport(r, scenario, publish && res.status === 201);
    const play = out.querySelector('[data-play]');
    if (play) play.onclick = () => { store.set('ma_scenario', scenario.id); location.hash = '#/'; };
  };
  document.getElementById('scheck').onclick = () => send(false).catch((e) => toast(e.message));
  document.getElementById('spublish').onclick = () => send(true).catch((e) => toast(e.message));
}

function submitReport(r, sc, published) {
  if (r.errors?.length) {
    return `<div class="report-status bad-box"><h3>❌ ${T('还不能发布')}</h3><ul class="errs">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  }
  const s = r.stats; const m = r.sim;
  const win = m.goodTeamWinRate;
  const level = win >= 0.9 ? [T('偏简单'), 'red'] : win >= 0.6 ? [T('进阶'), 'gold'] : win >= 0.3 ? [T('困难'), 'green'] : [T('可能过难'), 'red'];
  const names = Object.fromEntries(sc.characters.map((c) => [c.id, c]));
  const maxW = Math.max(1, ...Object.values(s.weights));
  return `
    <div class="report-head">
      <h3>${published ? '🎉 ' + T('已发布到社区剧本库') : '✅ ' + T('校验通过')}</h3>
      ${published ? `<p><button class="btn primary sm" data-play>${T('去大厅玩这个剧本')}</button></p>` : r.idTaken ? `<p class="small bad">${T('注意：id「{id}」已被占用，发布前请换一个。', { id: esc(sc.id) })}</p>` : `<p class="small muted">${T('结构没有问题，可以发布。下面是难度体检。')}</p>`}
    </div>
    <div class="metrics">
      ${[[T('侦探胜率（AI 试玩）'), `${Math.round(win * 100)}%`], [T('估计难度'), `<span class="pill ${level[1]}">${level[0]}</span>`], [T('凶手线索权重占比'), `${Math.round(s.murdererShare * 100)}%`], [T('强干扰嫌疑人'), s.redHerrings], [T('前置线索'), s.gatedClues], [T('预埋矛盾'), s.contradictions], [T('线索 / 搜证次数'), `${s.clues} / ${s.searches}`], [T('试玩完成率'), `${Math.round(m.completionRate * 100)}%`]]
        .map(([k, v]) => `<div class="metric"><b>${v}</b><span>${k}</span></div>`).join('')}
    </div>
    <h4 class="report-subhead">${T('线索指向（作者标注的正权重之和）')}</h4>
    <div class="tally">${Object.entries(s.weights).sort((a, b) => b[1] - a[1]).map(([pid, w]) => `<div class="bar"><span>${esc(names[pid]?.name || pid)}${pid === sc.truth.murderer ? ' 🔪' : ''}</span><div class="bar-track"><div class="fill" style="width:${(w / maxW) * 100}%;background:${names[pid]?.color}"></div></div><span class="mono-val">${w}</span></div>`).join('')}</div>
    ${r.warnings.length ? `<h4 class="report-subhead">${T('难度与写作提示')}</h4><ul class="warns">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : `<p class="small good">${T('没有难度提示，结构很健康。')}</p>`}
    <p class="small faint">${T('试玩使用离线规则型 AI（会读取线索的作者标注），侦探胜率 90% 以上通常说明案子太直白；真人和大模型的表现会不同。')}</p>`;
}

// ======================= 对局页 =======================
function renderGame(id, { watch = false } = {}) {
  const saved = watch ? null : store.get(`ma_token_${id}`);
  const [myPid, token] = saved ? saved.split(':') : [null, null];
  const G = { id, token, myPid, mode: token ? 'player' : (store.get(`ma_mode_${id}`) || 'spectator'), view: null, tab: store.get('ma_tab') || 'map', replay: null, es: null, actionKey: '', draft: { sub: 'SPEAK', text: '', target: '', clue: '' } };

  $app.innerHTML = `
    <div class="mobile-jump" role="navigation" aria-label="Workspace panels">
      <button type="button" class="btn sm" data-jump="left">📜 ${T('卷宗')}</button>
      <button type="button" class="btn sm primary" data-jump="centerCol">🕯️ ${T('审讯台')}</button>
      <button type="button" class="btn sm" data-jump="rightCol">🗺️ ${T('推演板')}</button>
    </div>
    <div class="game">
      <aside class="col left scroll" id="left"></aside>
      <section class="col center" id="centerCol">
        <div class="card status-card"><div id="status"></div></div>
        <div id="ending"></div>
        <div class="chat scroll" id="chat"></div>
        <div id="actions"></div>
      </section>
      <aside class="col right" id="rightCol">
        <div class="card viz">
          <div class="viz-tabs" id="vtabs" role="tablist"></div>
          <div class="viz-body" id="vbody"></div>
        </div>
      </aside>
    </div>`;

  $app.querySelectorAll('[data-jump]').forEach((btn) => {
    btn.onclick = () => {
      $app.querySelectorAll('[data-jump]').forEach((b) => b.classList.toggle('primary', b === btn));
      document.getElementById(btn.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  // 实时更新优先用 SSE；有些代理（如 Cloudflare Quick Tunnel）会把 SSE 整个缓冲住，
  // 4 秒内收不到任何数据就改用长轮询 /view?wait=…
  const poll = (q) => {
    let stopped = false;
    G.stopLive = () => { stopped = true; };
    const cid = (G.cid ||= Math.random().toString(36).slice(2));
    (async () => {
      let fails = 0;
      while (!stopped) {
        try {
          const since = G.view ? G.view.events.length : -1;
          const v = await api(`/api/games/${id}/view?${q}&wait=25&since=${since}&cid=${cid}`);
          if (stopped) return;
          G.view = v; fails = 0;
          try { update(G); } catch (err) { console.error(err); showFatal(err.message); }
        } catch {
          if (stopped) return;
          if (G.mode === 'god' && !G.view) { G.mode = 'spectator'; connect(); return; }
          fails++;
          await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * fails)));
        }
      }
    })();
  };
  const connect = () => {
    G.stopLive?.();
    if (G.es) { G.es.close(); G.es = null; }
    const q = G.token ? `token=${G.token}` : `view=${G.mode}`;
    if (G.usePoll) return poll(q);
    let got = false;
    const es = (G.es = new EventSource(`/api/games/${id}/stream?${q}`));
    es.addEventListener('view', (ev) => { got = true; G.view = JSON.parse(ev.data); update(G); });
    es.onerror = async () => {
      // 上帝视角被拒绝等情况：退回观众视角
      if (G.mode === 'god' && !G.view) { G.mode = 'spectator'; connect(); }
    };
    const fallback = setTimeout(() => {
      if (got || G.es !== es) return;
      es.close(); G.es = null; G.usePoll = true; poll(q);
    }, 4000);
    G.stopLive = () => clearTimeout(fallback);
  };
  G.connect = connect;
  connect();
  cleanup = () => { G.stopLive?.(); G.es?.close(); micStop(G); ttsStop(); if (TTS.G === G) TTS.G = null; closeLightbox(); };
}

// ---------- 派生数据 ----------
function derive(G) {
  const v = G.view;
  const cutoff = G.replay ?? Infinity;
  const evs = v.events.filter((e) => e.seq <= cutoff);
  const sc = v.scenario;
  const chars = sc.characters;
  const ch = (id) => chars.find((c) => c.id === id);
  const name = (id) => ch(id)?.name || (id === sc.victim.id ? sc.victim.name : T('主持人'));
  const pos = {};
  const shared = [];
  const accus = [];
  const decisions = [];
  for (const e of evs) {
    if (e.type === 'searched') pos[e.actor] = e.data.location;
    if (e.type === 'evidence_shared') shared.push({ ...e.data.clue, sharedBy: e.actor, seq: e.seq });
    if (e.type === 'accused') accus.push({ from: e.actor, to: e.data.target });
    if (e.type === 'questioned') accus.push({ from: e.actor, to: e.data.target, q: true });
    if (e.type === 'agent_decision') decisions.push(e);
  }
  const myFound = evs.filter((e) => e.type === 'clue_found' && e.data.clue && (G.view.viewer.kind === 'player' ? e.actor === G.view.viewer.pid : true));
  const ended = v.phase === 'ended' && G.replay === null;
  return { v, evs, sc, chars, ch, name, pos, shared, accus, decisions, myFound, ended };
}

function seatLabel(meta, pid) {
  if ((meta.open || []).includes(pid)) return T('空位 · 等待 Agent 加入');
  if (meta.seats[pid] === 'external') return `Agent${meta.agentNames?.[pid] ? ` · ${meta.agentNames[pid]}` : ''}`;
  return KIND_LABEL[meta.seats[pid]] || '';
}

// ---------- 复制给 Agent ----------
const BASE = location.origin;
function copyBox(text, { label = T('复制'), rows } = {}) {
  return `<div class="copybox"><pre${rows ? ` style="max-height:${rows * 1.5}em"` : ''}>${esc(text)}</pre><button class="btn sm primary" data-copytext="${esc(text)}">📋 ${esc(label)}</button></div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copytext]');
  if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copytext); toast(T('已复制，粘贴给你的 Agent 即可')); } catch { prompt(T('复制下面的内容：'), b.dataset.copytext); }
});
const AGENT_PROMPTS_ZH = {
  play: ({ title, name, id, token }) => `你要扮演剧本杀《${title}》里的「${name}」，和其他玩家（真人或 AI）一起推理。
说明文档：${BASE}/agent.md（先读）
你的对局：gameId=${id}  token=${token}

循环直到对局结束：
1. GET ${BASE}/api/games/${id}/turn?token=${token}&format=text&timeout=30
   （第一次会给你完整剧本；之后在地址后加上返回里提示的 &since=N，只看新发生的事）
2. 轮到你时，POST ${BASE}/api/games/${id}/action?token=${token}，请求体就是动作 JSON，例如 {"type":"SPEAK","text":"……"}
按你的角色剧本行事，用中文发言。结束后告诉我结果和你的推理。
观战：${BASE}/#/watch/${id}`,
  join: () => `去 ${BASE}/agent.md 读说明，然后加入一个剧本杀空位（GET ${BASE}/api/open-seats，再 POST /api/games/<gameId>/join），或者没有空位就自己开一局，一直玩到结束，最后告诉我结果和观战链接。`,
  joinGame: (id) => `去 ${BASE}/agent.md 读说明，然后加入这局剧本杀的空位：POST ${BASE}/api/games/${id}/join {"agentName":"<你的名字>"}，拿到 token 后一直玩到结束，最后告诉我结果。观战：${BASE}/#/watch/${id}`,
  write: () => `帮我写一个原创剧本杀剧本并发布到 ${BASE}。
1. 读 ${BASE}/agent.md 第 3 节和格式规范 ${BASE}/openmystery.md，参考示例 ${BASE}/api/scenarios/yuye-yaohuo/source
2. 题材：<在这里写你想要的题材>，4–6 人，难度进阶
3. 反复 POST ${BASE}/api/scenarios/check {"scenario": …} 直到没有错误、侦探胜率在 30%–85%、没有难度警告
4. POST ${BASE}/api/scenarios {"scenario": …} 发布，然后告诉我剧本 id 和标题`,
  mcp: () => `claude mcp add --transport http mystery-agents ${BASE}/mcp`,
};

// 英文提示词：完整翻译；说明文档带 ?lang=en，文本格式的回合接口带 &lang=en，其余 URL 与 API 路径不变
const AGENT_PROMPTS_EN = {
  play: ({ title, name, id, token }) => `You are playing "${name}" in the murder mystery "${title}", working out the case alongside the other players (humans or AI).
Instructions: ${BASE}/agent.md?lang=en (read this first)
Your game: gameId=${id}  token=${token}

Repeat until the game ends:
1. GET ${BASE}/api/games/${id}/turn?token=${token}&format=text&lang=en&timeout=30
   (The first call gives you your full character script. After that, append the &since=N shown in the response so you only see what's new.)
2. When it's your turn, POST ${BASE}/api/games/${id}/action?token=${token} with the action JSON as the request body, e.g. {"type":"SPEAK","text":"..."}
Play according to your character script and speak in English. When it's over, tell me the result and your reasoning.
Watch: ${BASE}/#/watch/${id}`,
  join: () => `Read the instructions at ${BASE}/agent.md?lang=en, then take an open seat in a murder mystery game (GET ${BASE}/api/open-seats, then POST /api/games/<gameId>/join). If there are no open seats, start a game yourself. Play until the end, then tell me the result and give me the watch link.`,
  joinGame: (id) => `Read the instructions at ${BASE}/agent.md?lang=en, then take the open seat in this murder mystery game: POST ${BASE}/api/games/${id}/join {"agentName":"<your name>"}. Once you have a token, play until the end, then tell me the result. Watch: ${BASE}/#/watch/${id}`,
  write: () => `Write an original murder mystery scenario and publish it to ${BASE}.
1. Read section 3 of ${BASE}/agent.md?lang=en and the format spec at ${BASE}/openmystery.md; use ${BASE}/api/scenarios/yuye-yaohuo/source as an example
2. Theme: <describe the theme you want here>, 4–6 players, Intermediate difficulty, written in English ("language": "en")
3. Keep POSTing to ${BASE}/api/scenarios/check {"scenario": …} until there are no errors, the detective win rate is between 30% and 85%, and there are no difficulty warnings
4. Publish with POST ${BASE}/api/scenarios {"scenario": …}, then tell me the scenario id and title`,
  mcp: () => `claude mcp add --transport http mystery-agents ${BASE}/mcp`,
};
const AGENT_PROMPTS = LANG === 'en' ? AGENT_PROMPTS_EN : AGENT_PROMPTS_ZH;
const AGENT_MD = LANG === 'en' ? '/agent.md?lang=en' : '/agent.md';

// ======================= 多模态：图片 / 音频 =======================
// MEDIA：当前页面可见的媒体 { 媒体id: { type, alt, transcript?, credit?, url } }。
// 大厅里来自剧本公开视图，对局里来自 view.media（服务器已按观察者权限过滤）；不在表里的 id 一律不渲染。
let MEDIA = {};
const img = (id) => (MEDIA[id]?.type === 'image' ? MEDIA[id] : null);

// 头像：有肖像就用图片盖住字母头像（图片加载失败时退回字母，见文件末尾的 error 监听）
function avatar(c, cls = '') {
  if (!c) return `<div class="avatar ${cls}" style="background:#5c4b3b" data-pid="__host">${T('主')}</div>`;
  const p = img(c.portrait);
  return `<div class="avatar ${cls} ${p ? 'has-img' : ''}" style="background:${c.color || '#6b221c'}" title="${esc(c.name)}" data-pid="${esc(c.id)}">${esc(c.name[0])}${p ? `<img src="${esc(p.url)}" alt="${esc(p.alt)}" loading="lazy" decoding="async">` : ''}</div>`;
}

// 一组媒体（线索附件 / 角色私密资料）：图片是缩略图（点击放大），音频是播放器 + 可折叠文字稿
function mediaHTML(ids, { ctx = '' } = {}) {
  const list = (ids || []).filter((id) => MEDIA[id]);
  if (!list.length) return '';
  const imgs = list.filter((id) => MEDIA[id].type === 'image');
  const auds = list.filter((id) => MEDIA[id].type === 'audio');
  return `<div class="media">${imgs.length ? `<div class="thumbs">${imgs.map((id) => thumbHTML(id)).join('')}</div>` : ''}${auds.map((id) => audioHTML(id, ctx)).join('')}</div>`;
}
function thumbHTML(id, cls = '') {
  const m = MEDIA[id];
  return `<button type="button" class="thumb ${cls}" data-lightbox="${esc(id)}" title="${esc(m.alt)}" aria-label="${esc(T('查看大图：{alt}', { alt: m.alt }))}"><img src="${esc(m.url)}" alt="${esc(m.alt)}" loading="lazy" decoding="async"></button>`;
}
function audioHTML(id, ctx = '') {
  const m = MEDIA[id];
  return `<div class="audio-clue"><div class="alt">🎧 ${esc(m.alt)}</div>
    <audio controls preload="none" src="${esc(m.url)}" data-akey="${esc(`${ctx}|${id}`)}" aria-label="${esc(m.alt)}"></audio>
    ${m.transcript ? `<details data-dkey="${esc(`${ctx}|${id}`)}"><summary>${T('文字稿')}</summary><div class="transcript">${esc(m.transcript)}</div></details>` : ''}</div>`;
}

// 替换 innerHTML，但保留已经开始播放的音频元素和展开的文字稿（否则每来一条事件，正在听的录音就会被打断）
function setHTML(el, html) {
  const keep = {};
  el.querySelectorAll('audio[data-akey]').forEach((a) => { if (!a.paused || a.currentTime > 0) keep[a.dataset.akey] = a; });
  const open = new Set([...el.querySelectorAll('details[data-dkey]')].filter((d) => d.open).map((d) => d.dataset.dkey));
  el.innerHTML = html;
  el.querySelectorAll('audio[data-akey]').forEach((a) => { const old = keep[a.dataset.akey]; if (old) { a.replaceWith(old); delete keep[a.dataset.akey]; } });
  el.querySelectorAll('details[data-dkey]').forEach((d) => { if (open.has(d.dataset.dkey)) d.open = true; });
}

// 灯箱：点击缩略图看大图与文字描述
function openLightbox(id) {
  const m = MEDIA[id]; if (!m) return;
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox'; box.className = 'lightbox'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    box.innerHTML = `<figure><button type="button" class="lb-close" aria-label="${esc(T('关闭'))}">✕</button><img alt=""><figcaption></figcaption></figure>`;
    document.body.appendChild(box);
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.lb-close')) closeLightbox(); });
  }
  const im = box.querySelector('img');
  im.src = m.url; im.alt = m.alt;
  box.setAttribute('aria-label', m.alt);
  box.querySelector('figcaption').innerHTML = `${esc(m.alt)}${m.credit ? `<span class="credit">${esc(m.credit)}</span>` : ''}`;
  box._return = document.activeElement;
  box.hidden = false;
  document.body.classList.add('lb-open');
  box.querySelector('.lb-close').focus();
}
function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box || box.hidden) return;
  box.hidden = true;
  document.body.classList.remove('lb-open');
  box._return?.focus?.();
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-lightbox]'); if (b) { e.preventDefault(); openLightbox(b.dataset.lightbox); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
// 头像 / 缩略图加载失败：去掉图片，露出字母头像或文字描述
document.addEventListener('error', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLImageElement)) return;
  const av = t.closest('.avatar');
  if (av) { av.classList.remove('has-img'); t.remove(); return; }
  const th = t.closest('.thumb');
  if (th) { th.classList.add('broken'); th.textContent = t.alt; }
}, true);

// ======================= 角色声音（Web Speech API 语音合成） =======================
const TTS = {
  supported: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
  voices: [],
  queue: [],
  current: null,
  on: store.get('ma_tts') === '1',
  G: null,
};
const SPEECH_EVENTS = new Set(['spoke', 'questioned', 'responded', 'accused', 'evidence_shared', 'narration']);
function ttsLoadVoices() {
  if (!TTS.supported) return;
  try { TTS.voices = window.speechSynthesis.getVoices() || []; } catch { TTS.voices = []; }
}
if (TTS.supported) {
  ttsLoadVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', () => { ttsLoadVoices(); if (TTS.G?.view) update(TTS.G); }); } catch { /* 旧浏览器 */ }
}
const ttsReady = () => TTS.supported && TTS.voices.length > 0;
// 按语言、性别挑系统声音；同性别有多个声音时按角色 id 分配，让不同角色听起来不一样
const FEMALE = /female|woman|girl|女|xiaoxiao|xiaoyi|xiaohan|xiaomo|xiaochen|xiaorui|xiaoshuang|xiaoxuan|xiaoyan|huihui|yaoyao|tingting|meijia|sinji|hanhan|lili|samantha|victoria|karen|moira|tessa|fiona|zira|susan|hazel|serena|aria|jenny|libby|sonia|allison|\bava\b|kate|catherine|veena|nicky|joanna|salli|kimberly|ivy|emma|amy/i;
const MALE = /male|\bman\b|boy|男|yunxi|yunyang|yunjian|yunfeng|yunhao|yunze|kangkang|daniel|\balex\b|fred|\btom\b|david|mark|george|\bguy\b|ryan|aaron|arthur|oliver|rishi|gordon|lee|matthew|joey|justin|brian|eric|thomas/i;
const voiceGender = (vc) => { const s = `${vc.name} ${vc.voiceURI}`; return FEMALE.test(s) ? 'female' : MALE.test(s) ? 'male' : null; };
const hashStr = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
function pickVoice(lang, gender, key) {
  const pre = lang === 'en' ? 'en' : 'zh';
  const norm = (l) => String(l || '').toLowerCase().replace('_', '-');
  let pool = TTS.voices.filter((vc) => norm(vc.lang).startsWith(pre));
  if (pre === 'zh') { const cn = pool.filter((vc) => /^zh-(cn|hans)/.test(norm(vc.lang))); if (cn.length) pool = cn; }
  if (!pool.length) return null;
  if (!gender || gender === 'neutral') return pool.find((vc) => vc.default) || pool.find((vc) => !voiceGender(vc)) || pool[0];
  const g = pool.filter((vc) => voiceGender(vc) === gender);
  const from = g.length ? g : pool;
  return from[hashStr(key) % from.length];
}
// 把角色的声音设定换算成 utterance 参数
function voiceParams(profile, lang, key) {
  const p = profile || {};
  const vc = pickVoice(lang, p.gender, key);
  let pitch = Number.isFinite(p.pitch) ? p.pitch : 1;
  let rate = Number.isFinite(p.rate) ? p.rate : 1;
  if (p.age === 'old') { pitch *= 0.88; rate *= 0.9; }
  else if (p.age === 'child') { pitch *= 1.25; rate *= 1.05; }
  else if (p.age === 'young') pitch *= 1.08;
  // 找不到同性别的声音时，用音高补一点
  const vg = vc && voiceGender(vc);
  if (vg && p.gender && p.gender !== 'neutral' && vg !== p.gender) pitch *= p.gender === 'male' ? 0.8 : 1.2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  return { voice: vc, lang: vc?.lang || (lang === 'en' ? 'en-US' : 'zh-CN'), pitch: Number(clamp(pitch, 0.1, 2).toFixed(2)), rate: Number(clamp(rate, 0.5, 2).toFixed(2)) };
}
function setSpeaking(pid) {
  let st = document.getElementById('speakingStyle');
  if (!st) { st = document.createElement('style'); st.id = 'speakingStyle'; document.head.appendChild(st); }
  // 规则写在动态样式表里：对话流 / 左栏重新渲染后，新生成的头像也会带上「正在说话」的标记
  const sel = `.avatar[data-pid="${CSS.escape(pid || '')}"]`;
  st.textContent = pid ? `${sel}{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent-2);animation:speak-pulse 1.2s ease-in-out infinite}${sel}::after{content:'🔊';position:absolute;right:-6px;bottom:-4px;font-size:10px;line-height:1;padding:2px;border-radius:50%;background:var(--accent-2);box-shadow:0 0 0 2px var(--bg)}` : '';
  document.body.classList.toggle('tts-speaking', !!pid);
}
function ttsPump() {
  if (TTS.current || !TTS.queue.length) return;
  const item = TTS.queue.shift();
  let u;
  try { u = new SpeechSynthesisUtterance(item.text); } catch { return; }
  u.lang = item.lang; u.pitch = item.pitch; u.rate = item.rate;
  if (item.voice) u.voice = item.voice;
  TTS.current = u;
  const done = () => {
    if (TTS.current !== u) return;
    clearTimeout(u._watch); TTS.current = null; setSpeaking(null);
    setTimeout(ttsPump, 120);
  };
  u.onend = done;
  u.onerror = (ev) => {
    // Chrome 要求先有一次用户交互才允许朗读（例如刷新后语音开关还开着）
    if (ev?.error === 'not-allowed' && !TTS.warned) { TTS.warned = true; toast(T('点一下页面任意位置，就可以开始朗读')); }
    done();
  };
  // 有些引擎不触发 onend：按文字长度兜底
  u._watch = setTimeout(done, 6000 + item.text.length * 350 / item.rate);
  setSpeaking(item.pid);
  try { window.speechSynthesis.speak(u); } catch { done(); }
}
function ttsStop() {
  TTS.queue = [];
  const u = TTS.current; TTS.current = null;
  if (u) clearTimeout(u._watch);
  setSpeaking(null);
  if (TTS.supported) { try { window.speechSynthesis.cancel(); } catch { /* 忽略 */ } }
}
// 每次拿到新视图：只朗读首次加载之后新出现的发言类事件；回放时不读
function ttsFeed(G) {
  const v = G.view;
  const max = v.events.length ? v.events[v.events.length - 1].seq : 0;
  if (G.spokenSeq === undefined) { G.spokenSeq = max; return; }
  const fresh = v.events.filter((e) => e.seq > G.spokenSeq && SPEECH_EVENTS.has(e.type));
  G.spokenSeq = Math.max(G.spokenSeq, max);
  if (!TTS.on || !ttsReady() || G.replay !== null) return;
  const lang = v.meta?.lang === 'en' ? 'en' : 'zh';
  const chars = v.scenario.characters;
  for (const e of fresh) {
    const text = String(e.data?.text || '').replace(/^\s*[【\[](主持人|Host)[】\]]\s*/, '').trim();
    if (!text) continue;
    const c = chars.find((x) => x.id === e.actor);
    const profile = e.type === 'narration' || !c ? { gender: 'neutral' } : (c.voice || (v.you?.id === c.id ? v.you.voice : null) || {});
    TTS.queue.push({ text, pid: e.type === 'narration' || !c ? '__host' : c.id, ...voiceParams(profile, lang, c?.id || 'narrator') });
  }
  // AI 行动很快时别越积越多：只留最近 8 句
  if (TTS.queue.length > 8) TTS.queue.splice(0, TTS.queue.length - 8);
  ttsPump();
}

// ======================= 语音输入（Web Speech API 语音识别） =======================
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
function micHTML(G) {
  if (!SR) return '';
  const on = !!G.rec;
  return `<button type="button" class="mic ${on ? 'on' : ''}" data-mic aria-pressed="${on}" title="${esc(on ? T('停止语音输入') : T('语音输入'))}" aria-label="${esc(on ? T('停止语音输入') : T('语音输入'))}">🎤</button>`;
}
function micStop(G) { if (G.rec) { const r = G.rec; G.rec = null; try { r.stop(); } catch { /* 忽略 */ } } }
function micToggle(G, btn) {
  if (G.rec) { micStop(G); btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); return; }
  let rec;
  try { rec = new SR(); } catch { toast(T('当前浏览器无法使用语音输入')); return; }
  rec.lang = G.view?.meta?.lang === 'en' ? 'en-US' : 'zh-CN';
  rec.interimResults = true; rec.continuous = true;
  const base = G.draft.text;
  const sep = base && !/\s$/.test(base) ? (rec.lang === 'en-US' ? ' ' : '') : '';
  rec.onresult = (ev) => {
    let said = '';
    for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
    G.draft.text = (base + sep + said).slice(0, 300);
    const ta = document.getElementById('aText');
    if (ta) { ta.value = G.draft.text; ta.scrollTop = ta.scrollHeight; }
  };
  rec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast(T('无法使用麦克风：请在浏览器里允许麦克风权限')); else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast(T('语音输入出错：{err}', { err: ev.error })); };
  rec.onend = () => { if (G.rec === rec) G.rec = null; document.querySelectorAll('[data-mic]').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); b.title = T('语音输入'); }); };
  try { rec.start(); } catch (e) { toast(T('语音输入出错：{err}', { err: e.message })); return; }
  G.rec = rec;
  btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); btn.title = T('停止语音输入');
}

function update(G) {
  MEDIA = G.view.media || {};
  TTS.G = G;
  ttsFeed(G);
  const D = derive(G);
  renderStatus(G, D);
  renderLeft(G, D);
  renderChat(G, D);
  renderActions(G, D);
  renderEnding(G, D);
  renderViz(G, D);
}

// ---------- 状态栏 ----------
function renderStatus(G, D) {
  const { v, name } = D;
  const steps = [['intro', 0, PHASE_LABEL.intro]];
  for (let r = 1; r <= v.totalRounds; r++) steps.push(['investigate', r, T('搜证{r}', { r })], ['discuss', r, T('讨论{r}', { r })]);
  steps.push(['vote', v.totalRounds, PHASE_LABEL.vote], ['ended', v.totalRounds, PHASE_LABEL.ended]);
  const curIdx = steps.findIndex(([p, r]) => p === v.phase && (p === 'intro' || p === 'ended' || p === 'vote' || r === v.round));
  const t = v.turn;
  const seats = v.meta.seats;
  let turnText = '';
  if (v.phase === 'ended') turnText = `<span class="ended-badge">⚖️ ${T('对局已结束')}</span>`;
  else if (t) {
    const who = t.pid === G.myPid ? `<b class="you-highlight">${T('你')}</b>` : `<b>${esc(name(t.pid))}</b>`;
    const kind = { ready: T('阅读剧本'), investigate: T('搜证'), discuss: T('发言'), respond: T('回答质询'), vote: T('投票') }[t.kind];
    const thinking = v.meta.thinking === t.pid ? `<span class="muted thinking-tag">${T('思考中')}<span class="dots"></span></span>` : '';
    turnText = `${D.ch(t.pid) ? avatar(D.ch(t.pid), 'sm') : ''} <span class="turn-copy">${T('轮到 {who} {kind}', { who, kind })}</span> ${seats[t.pid] && seats[t.pid] !== 'human' ? `<span class="pill">${esc(seatLabel(v.meta, t.pid))}</span>` : ''} ${thinking}`;
  }
  const isAIOnly = !v.meta.hasHumans;
  const hostToken = store.get(`ma_host_${G.id}`);
  const controls = [];
  if (hostToken && isAIOnly && v.phase !== 'ended') controls.push(`<button class="btn sm" data-ctl="${v.meta.paused ? 'resume' : 'pause'}">${v.meta.paused ? '▶ ' + T('继续') : '⏸ ' + T('暂停')}</button>`);
  if (hostToken && v.phase !== 'ended') controls.push(`<label class="small muted speed-ctl">${T('速度')} <input type="range" min="0" max="4000" step="200" value="${v.meta.speedMs}" data-speed></label>`);
  if (TTS.supported) {
    controls.push(ttsReady()
      ? `<button class="btn sm tts-toggle ${TTS.on ? 'on' : ''}" data-tts aria-pressed="${TTS.on}" title="${esc(TTS.on ? T('正在用浏览器语音朗读角色发言，点击关闭') : T('用浏览器语音朗读新的发言（每个角色有自己的声音）'))}">${TTS.on ? '🔊' : '🔈'} ${T('语音')}</button>`
      : `<span class="tts-off" tabindex="0" title="${esc(T('这台设备没有可用的系统语音，无法朗读'))}"><button class="btn sm" disabled aria-disabled="true">🔇 ${T('语音')}</button></span>`);
  }
  controls.push(`<span class="watcher-pill small muted" title="${T('正在观战的人数（不含玩家）')}">👀 ${v.meta.watchers || 0}</span>`);
  if (v.phase !== 'ended') controls.push(`<button class="btn sm" data-share title="${T('复制观战链接：对方只能看到公开信息')}${isAIOnly ? T('，可自行切换上帝视角') : ''}">🔗 ${T('分享观战')}</button>`);
  if (!G.token && v.meta.godAllowed) controls.push(`<button class="btn sm ${G.mode === 'god' ? 'primary' : ''}" data-mode>${G.mode === 'god' ? '👁️ ' + T('上帝视角') : '👤 ' + T('观众视角')}</button>`);
  const el = document.getElementById('status');
  const html = `
    <div class="statusline">
      <div class="phasebar" aria-label="Game phase">${steps.map((s, i) => `<span class="phase-step ${i < curIdx ? 'done' : i === curIdx ? 'now' : ''}">${s[2]}</span>`).join('')}</div>
      <div class="controls">${controls.join('')}</div>
    </div>
    <div class="statusline status-bottom">
      <div class="turnline">${turnText}</div>
      <div class="viewer-tag small faint">${G.token ? T('你是 {name}', { name: `<b style="color:var(--text)">${esc(name(G.myPid))}</b>` }) : G.mode === 'god' ? T('上帝视角：可以看到所有私密信息') : T('观众视角：只能看到公开信息')}</div>
    </div>
    ${invitesHTML(G, D)}${agentSeatsHTML(G, D)}`;
  if (el._html !== html) {
    el.innerHTML = html; el._html = html;
    el.querySelectorAll('[data-ctl]').forEach((b) => { b.onclick = () => api(`/api/games/${G.id}/control`, { method: 'POST', body: { op: b.dataset.ctl, hostToken } }).catch((e) => toast(e.message)); });
    el.querySelectorAll('[data-speed]').forEach((r) => { r.onchange = () => api(`/api/games/${G.id}/control`, { method: 'POST', body: { op: 'speed', speedMs: Number(r.value), hostToken } }).catch((e) => toast(e.message)); });
    el.querySelectorAll('[data-share]').forEach((b) => {
      b.onclick = async () => {
        const url = `${location.origin}${location.pathname}#/watch/${G.id}`;
        try { await navigator.clipboard.writeText(url); toast(T('观战链接已复制，发给朋友即可围观')); } catch { prompt(T('复制观战链接：'), url); }
      };
    });
    el.querySelectorAll('[data-copy]').forEach((b) => {
      b.onclick = async () => {
        const url = b.dataset.copy;
        try { await navigator.clipboard.writeText(url); toast(T('邀请链接已复制')); } catch { prompt(T('复制这条邀请链接发给朋友：'), url); }
      };
    });
    el.querySelectorAll('[data-tts]').forEach((b) => {
      b.onclick = () => {
        TTS.on = !TTS.on; store.set('ma_tts', TTS.on ? '1' : '0');
        if (!TTS.on) ttsStop();
        renderStatus(G, derive(G));
      };
    });
    el.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { G.mode = G.mode === 'god' ? 'spectator' : 'god'; store.set(`ma_mode_${G.id}`, G.mode); G.view = null; G.connect(); }; });
  }
}

// 「复制给你的 Agent」：创建者看到自己 Agent 座位的提示词；任何人都能看到空位的加入提示
function agentSeatsHTML(G, D) {
  const { v, name } = D;
  if (v.phase === 'ended') return '';
  let mine = {};
  try { mine = JSON.parse(store.get(`ma_agents_${G.id}`) || '{}'); } catch { /* 忽略 */ }
  const joined = new Set(v.meta.joined || []);
  const parts = [];
  for (const [pid, token] of Object.entries(mine)) {
    if (joined.has(pid) && v.phase !== 'intro') continue;
    parts.push(`<div class="small"><b>${T('复制给你的 Agent')}</b>${T('：它将扮演 {name}', { name: esc(name(pid)) })} <span class="pill ${joined.has(pid) ? 'green' : ''}">${joined.has(pid) ? T('Agent 已连接') : T('等待 Agent 连接')}</span></div>
      ${copyBox(AGENT_PROMPTS.play({ title: v.scenario.title, name: name(pid), id: G.id, token }), { label: T('复制提示词'), rows: 6 })}`);
  }
  const open = v.meta.open || [];
  if (open.length) {
    parts.push(`<div class="small"><b>${T('空位')}</b>${T('：{names} 等待任何人的 Agent 加入。把下面这段发给你或朋友的 Agent：', { names: open.map((p) => esc(name(p))).join(T('、')) })}</div>
      ${copyBox(AGENT_PROMPTS.joinGame(G.id), { label: T('复制加入提示词'), rows: 3 })}`);
  }
  return parts.length ? `<div class="invites">${parts.join('')}</div>` : '';
}

// 创建者在开局阶段看到其他真人座位的邀请链接
function invitesHTML(G, D) {
  const { v, name } = D;
  if (v.phase === 'ended') return '';
  let inv = {};
  try { inv = JSON.parse(store.get(`ma_invites_${G.id}`) || '{}'); } catch { /* 忽略 */ }
  const pids = Object.keys(inv);
  if (!pids.length) return '';
  const joined = new Set(v.meta.joined || []);
  const waiting = pids.filter((p) => !joined.has(p));
  if (!waiting.length && v.phase !== 'intro') return '';
  const base = `${location.origin}${location.pathname}#/join/${G.id}`;
  return `<div class="invites">
    <div class="small"><b>${T('邀请朋友')}</b> <span class="faint">${T('把链接发给对应的人，对方打开即入座。')}${waiting.length ? T('还在等 {n} 人加入，开场阶段会等所有真人读完剧本。', { n: waiting.length }) : T('所有人都已加入。')}</span></div>
    ${pids.map((p) => `<div class="invite">${D.ch(p) ? avatar(D.ch(p), 'sm') : ''}<b>${esc(name(p))}</b>
      <span class="pill ${joined.has(p) ? 'green' : ''}">${joined.has(p) ? T('已加入') : T('未加入')}</span>
      <button class="btn sm" data-copy="${esc(`${base}/${p}/${inv[p]}`)}">${T('复制邀请链接')}</button></div>`).join('')}
  </div>`;
}

// ---------- 左栏：角色卡 / 线索 ----------
function clueHTML(c, { owner, publicBy, foot = '', priv = false } = {}) {
  return `<div class="cluecard ${priv ? 'private' : ''}">
    <div class="clue-pin" aria-hidden="true"></div>
    <div class="t"><span>${esc(c.title)}</span><span class="loc">${esc(c.locationName || '')}${c.time ? ' · ' + esc(c.time) : ''}</span></div>
    <div class="tx">${esc(c.text)}</div>
    ${mediaHTML(c.media, { ctx: c.id })}
    ${(owner || publicBy || foot) ? `<div class="foot"><span>${owner ? T('持有：') + esc(owner) : ''}${publicBy ? ' ' + T('公开：') + esc(publicBy) : ''}</span>${foot}</div>` : ''}
  </div>`;
}

function renderLeft(G, D) {
  const { v, name, ch } = D;
  const el = document.getElementById('left');
  let html = '';
  if (v.viewer.kind === 'player') {
    const you = v.you;
    html += `<div class="card role dossier-card">
      <div class="folder-kicker"><span>${T('角色档案')}</span>${you.isMurderer ? `<span class="pill red murderer-badge">${T('你是凶手')}</span>` : ''}</div>
      <div class="head">${avatar(ch(you.id), 'lg')}<div><b>${esc(you.name)}</b><div class="small muted">${esc(you.publicBio)}</div></div></div>
      <div class="small objectives-box"><b>${T('任务')}</b><ol class="objectives">${you.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ol></div>
      <details class="script-drawer" ${v.phase === 'intro' ? 'open' : ''}><summary>${T('我的剧本')}</summary><div class="script">${esc(you.script)}</div></details>
      ${(you.media || []).some((id) => MEDIA[id]) ? `<div class="private-media"><div class="small"><b>${T('私密资料')}</b> <span class="pill gold">${T('仅自己可见')}</span></div>${mediaHTML(you.media, { ctx: 'role' })}</div>` : ''}
    </div>`;
    const mine = v.myClues;
    html += `<div class="card pouch-card">
      <div class="folder-kicker"><span>${T('证物袋')}</span></div>
      <div class="pouch-head"><h3>${T('我的线索')}</h3><span class="pill gold">${mine.length}</span></div>
      <div class="cluelist">${mine.length ? mine.map((c) => clueHTML(c, { priv: !c.public, foot: c.public ? `<span class="pill green">${T('已公开')}</span>` : `<span class="pill gold">${T('仅自己可见')}</span>` })).join('') : `<div class="muted small empty-pouch">${T('搜证后找到的线索会出现在这里。')}</div>`}</div></div>`;
  } else {
    html += `<div class="card dossier-card">
      <div class="folder-kicker"><span>${T('案件卷宗')}</span></div>
      <h3 class="dossier-title">${esc(v.scenario.title)}</h3>
      <div class="small muted dossier-bg">${esc(v.scenario.background)}</div>
    </div>`;
    html += `<div class="card roster-card">
      <div class="folder-kicker"><span>${T('在场嫌疑人')}</span></div>
      <h3 class="dossier-title">${T('角色')}</h3>
      <div class="suspect-roster">${v.scenario.characters.map((c) => {
        const role = v.roles?.[c.id];
        return `<div class="suspect-item" style="--char-color:${esc(c.color || 'var(--accent)')}">
          ${avatar(c)}
          <div class="small suspect-body">
            <div class="suspect-head">
              <b>${esc(c.name)}</b>
              <span class="pill">${esc(seatLabel(v.meta, c.id))}</span>
              ${role?.isMurderer ? `<span class="pill red">${T('凶手')}</span>` : ''}
            </div>
            <div class="muted">${esc(c.publicBio)}</div>
            ${role ? `<details class="script-drawer"><summary class="small">${T('查看剧本')}</summary><div class="script">${esc(role.script)}</div>${mediaHTML(role.media, { ctx: `role-${c.id}` })}</details>` : ''}
          </div>
        </div>`;
      }).join('')}</div></div>`;
  }
  if (el._html !== html) {
    const open = [...el.querySelectorAll('details')].map((d) => d.open);
    setHTML(el, html); el._html = html;
    el.querySelectorAll('details').forEach((d, i) => { if (open[i] !== undefined) d.open = open[i]; });
  }
  void name;
}

// ---------- 中栏：对话流 ----------
function renderChat(G, D) {
  const { evs, name, ch, v } = D;
  const el = document.getElementById('chat');
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const thoughts = {};
  const out = [];
  const me = v.viewer.kind === 'player' ? v.viewer.pid : null;
  const msg = (e, cls, html, extra = '') => {
    const th = thoughts[e.actor]; delete thoughts[e.actor];
    const c = ch(e.actor);
    return `<div class="msg ${cls} ${e.actor === me ? 'me' : ''}" style="--char-color:${esc(c?.color || 'var(--accent-2)')}">${avatar(c)}<div class="body">
      <div class="name"><b>${esc(name(e.actor))}</b>${extra}</div>
      ${th ? `<div class="thought">💭 ${esc(th)}</div>` : ''}
      <div class="bubble">${html}</div></div></div>`;
  };
  let firstNarr = true;
  for (const e of evs) {
    const d = e.data;
    switch (e.type) {
      case 'narration': out.push(`<div class="narr ${firstNarr ? 'story' : ''}"><div class="narr-inner">${esc(d.text)}</div></div>`); firstNarr = false; break;
      case 'phase_changed': out.push(`<div class="divider"><span>${PHASE_LABEL[d.phase]}${d.phase !== 'vote' ? ' · ' + T('第 {n} 轮', { n: d.round }) : ''}</span></div>`); break;
      case 'agent_decision': if (d.thought) thoughts[e.actor] = d.thought; break;
      case 'searched': {
        const loc = v.scenario.locations.find((l) => l.id === d.location)?.name;
        const th = thoughts[e.actor]; delete thoughts[e.actor];
        out.push(`<div class="sysline">🔍 ${T('{who} 搜查了{loc}', { who: esc(name(e.actor)), loc: `<b>${esc(loc)}</b>` })}${th && G.mode === 'god' ? ` <i>${T('（{t}）', { t: esc(th) })}</i>` : ''}</div>`); break;
      }
      case 'clue_found':
        out.push(d.clue ? `<div class="sysline private">🗝️ ${T('{who}找到了线索「{clue}」', { who: e.actor === me ? T('你') : esc(name(e.actor)), clue: esc(d.clue.title) })}${e.actor === me ? T('（仅你可见，可在讨论时公开）') : T('（私密）')}</div>` : `<div class="sysline private">${T('{who}在这里什么也没找到。', { who: e.actor === me ? T('你') : esc(name(e.actor)) })}</div>`);
        break;
      case 'spoke': out.push(msg(e, '', esc(d.text))); break;
      case 'questioned': out.push(msg(e, 'question', esc(d.text), ` <span class="pill gold">${T('质询 {name}', { name: esc(name(d.target)) })}</span>`)); break;
      case 'responded': out.push(msg(e, 'respond', esc(d.text), ` <span class="pill">${T('回答 {name}', { name: esc(name(d.to)) })}</span>`)); break;
      case 'accused': out.push(msg(e, 'accuse', esc(d.text), ` <span class="pill red">${T('指控 {name}', { name: esc(name(d.target)) })}</span>`)); break;
      case 'evidence_shared': out.push(msg(e, 'evidence', `${d.text ? `<div class="ev-speech">${esc(d.text)}</div>` : ''}${clueHTML(d.clue)}`, ` <span class="pill green">${T('公开线索')}</span>`)); break;
      case 'passed': out.push(`<div class="sysline">${T('{who} 选择跳过', { who: esc(name(e.actor)) })}</div>`); break;
      case 'ready': break;
      case 'vote_cast': out.push(`<div class="sysline">🗳️ ${T('{who} 已投票', { who: esc(name(e.actor)) })}</div>`); break;
      case 'voted': out.push(`<div class="sysline private">🗳️ ${T('{who}投给了 {target}', { who: e.actor === me ? T('你') : esc(name(e.actor)), target: esc(name(d.target)) })}${d.reason ? T('：') + esc(d.reason) : ''}</div>`); break;
      case 'action_rejected': out.push(`<div class="sysline sys-err">⚠️ ${T('{who} 的动作被规则拒绝：{err}', { who: esc(name(e.actor)), err: esc(d.error) })}</div>`); break;
      case 'votes_revealed': out.push(`<div class="divider verdict-divider"><span>${T('投票结果：')}${d.convicted ? T('{name} 被指认', { name: esc(name(d.convicted)) }) : T('平票，无人被指认')}</span></div>`); break;
      case 'game_ended': out.push(`<div class="narr finale"><div class="narr-inner">${T('【主持人】真相揭晓。')}${esc(d.truth.summary)}</div></div>`); break;
      default: break;
    }
  }
  if (patchList(el, out) && (atBottom || G.replay !== null)) el.scrollTop = el.scrollHeight;
}

// 对话流基本只追加：只重建第一处不同之后的条目，前面的节点（正在播放的录音、已加载的图片）原样保留。
// items 的每一项都必须是一个顶层元素的 HTML。返回是否有变化。
function patchList(el, items) {
  const old = el._items || [];
  if (el.childElementCount !== old.length) { el.innerHTML = ''; old.length = 0; }
  let i = 0;
  while (i < old.length && i < items.length && old[i] === items[i]) i++;
  if (i === old.length && i === items.length) return false;
  while (el.childElementCount > i) el.lastElementChild.remove();
  const tpl = document.createElement('template');
  tpl.innerHTML = items.slice(i).join('');
  el.appendChild(tpl.content);
  el._items = items.slice();
  if (el.childElementCount !== items.length) el._items = null; // 结构不符时下次整体重建
  return true;
}

// ---------- 行动面板 ----------
async function act(G, action) {
  micStop(G);
  try { await api(`/api/games/${G.id}/action`, { method: 'POST', body: { token: G.token, action } }); G.draft.text = ''; }
  catch (e) { toast(e.message); }
}

function renderActions(G, D) {
  const { v, name, chars } = D;
  const el = document.getElementById('actions');
  if (v.phase === 'ended' || G.replay !== null) { micStop(G); el.innerHTML = ''; G.actionKey = ''; return; }
  const t = v.turn;
  const mine = v.viewer.kind === 'player' && t && t.pid === v.viewer.pid;
  const key = mine ? `${t.pid}|${t.kind}|${v.events.length}|${G.draft.sub}` : `wait|${t?.pid}|${v.viewer.kind}`;
  if (key === G.actionKey) return;
  G.actionKey = key;
  if (!mine) {
    micStop(G);
    el.innerHTML = v.viewer.kind === 'player' ? `<div class="actions waiting small">${T('等待其他角色行动…你可以先阅读剧本、整理线索，右侧可查看地图、关系图和时间线。')}</div>` : '';
    return;
  }
  const others = chars.filter((c) => c.id !== v.viewer.pid);
  const unshared = v.myClues.filter((c) => !c.public);
  const targetSel = `<select id="aTarget">${others.map((c) => `<option value="${c.id}" ${G.draft.target === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const clueSel = (optional) => `<select id="aClue">${optional ? `<option value="">${T('（不出示线索）')}</option>` : ''}${unshared.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}</select>`;
  const ta = (ph) => `<div class="ta-wrap ${SR ? 'has-mic' : ''}"><textarea id="aText" maxlength="300" placeholder="${esc(ph)}">${esc(G.draft.text)}</textarea>${micHTML(G)}</div>`;
  let body = '';
  if (t.kind === 'ready') {
    body = `<div class="hint">${T('请先阅读左侧的角色剧本和任务。准备好后点击开始。')}</div><div><button class="btn primary big" data-go="READY">${T('我已读完剧本')}</button></div>`;
  } else if (t.kind === 'investigate') {
    body = `<div class="hint">${T('选择一个地点搜证（也可以直接点击右侧地图上的房间）。')}</div>
      <div class="loc-buttons">${v.locations.map((l) => `<button class="loc-btn" data-loc="${l.id}" ${l.remaining ? '' : 'disabled'}><b>${esc(l.name)}</b><span class="small muted">${T('剩余线索 {a}/{b}', { a: l.remaining, b: l.total })}</span></button>`).join('')}</div>
      <div><button class="btn ghost sm" data-go="PASS">${T('跳过本次搜证')}</button></div>`;
  } else if (t.kind === 'discuss') {
    const subs = [['SPEAK', '💬 ' + T('发言')], ['QUESTION', '❓ ' + T('质询')], ['SHARE_EVIDENCE', '🗝️ ' + T('公开线索')], ['ACCUSE', '☝️ ' + T('指控')], ['PASS', T('跳过')]];
    const s = G.draft.sub;
    body = `<div class="tabs">${subs.map(([k, l]) => `<button class="btn sm ${s === k ? 'on' : ''}" data-sub="${k}" ${k === 'SHARE_EVIDENCE' && !unshared.length ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      ${s === 'QUESTION' || s === 'ACCUSE' ? `<div class="row small">${s === 'QUESTION' ? T('质询对象（对方必须马上回答）') : T('指控对象')} ${targetSel}</div>` : ''}
      ${s === 'SHARE_EVIDENCE' ? `<div class="row small">${T('选择线索')} ${clueSel(false)}</div>` : ''}
      ${s !== 'PASS' ? ta(s === 'SHARE_EVIDENCE' ? T('说点什么（可选）') : s === 'QUESTION' ? T('你想问什么？') : s === 'ACCUSE' ? T('你的理由') : T('你想说什么？')) : `<div class="hint">${T('本回合不发言。')}</div>`}
      <div class="row"><button class="btn primary" data-submit>${T('确认')}</button><span class="small faint">${T('Ctrl + Enter 发送')}</span></div>`;
  } else if (t.kind === 'respond') {
    const q = [...v.events].reverse().find((e) => e.type === 'questioned' && e.data.target === v.viewer.pid);
    body = `<div class="hint respond-banner">${T('{who} 在质询你：「{q}」', { who: `<b style="color:var(--accent-2)">${esc(name(t.askedBy))}</b>`, q: esc(q?.data.text || '') })}</div>
      ${ta(T('你的回答'))}
      ${unshared.length ? `<div class="row small">${T('同时出示线索')} ${clueSel(true)}</div>` : ''}
      <div class="row"><button class="btn primary" data-submit>${T('回答')}</button></div>`;
  } else if (t.kind === 'vote') {
    body = `<div class="hint">${T('投出你认为的凶手。得票最多者被指认，平票则凶手逃脱。')}</div>
      <div class="vote-grid">${others.map((c) => `<button class="vote-btn ${G.draft.target === c.id ? 'sel' : ''}" data-vote="${c.id}"><div class="row">${avatar(c, 'sm')}<b>${esc(c.name)}</b></div></button>`).join('')}</div>
      ${ta(T('投票理由（可选）'))}
      <div class="row"><button class="btn primary" data-submit ${G.draft.target && others.some((c) => c.id === G.draft.target) ? '' : 'disabled'}>${T('确认投票')}</button></div>`;
  }
  el.innerHTML = `<div class="actions"><div class="your-turn-stamp">▶ ${T('轮到你了')}</div>${body}</div>`;

  const text = el.querySelector('#aText');
  if (text) { text.oninput = () => { G.draft.text = text.value; }; text.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) el.querySelector('[data-submit]')?.click(); }; setTimeout(() => text.focus(), 0); }
  el.querySelectorAll('[data-mic]').forEach((b) => { b.onclick = () => { micToggle(G, b); el.querySelector('#aText')?.focus(); }; });
  const tgt = el.querySelector('#aTarget'); if (tgt) { if (!G.draft.target || !others.some((c) => c.id === G.draft.target)) G.draft.target = tgt.value; tgt.onchange = () => { G.draft.target = tgt.value; }; }
  el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => act(G, { type: b.dataset.go }); });
  el.querySelectorAll('[data-loc]').forEach((b) => { b.onclick = () => act(G, { type: 'INVESTIGATE', location: b.dataset.loc }); });
  el.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => { G.draft.sub = b.dataset.sub; G.actionKey = ''; renderActions(G, D); }; });
  el.querySelectorAll('[data-vote]').forEach((b) => { b.onclick = () => { G.draft.target = b.dataset.vote; G.actionKey = ''; renderActions(G, D); }; });
  const submit = el.querySelector('[data-submit]');
  if (submit) submit.onclick = () => {
    const txt = (el.querySelector('#aText')?.value || '').trim();
    const clue = el.querySelector('#aClue')?.value || '';
    if (t.kind === 'vote') return act(G, { type: 'VOTE', target: G.draft.target, text: txt });
    if (t.kind === 'respond') return act(G, { type: 'RESPOND', text: txt, ...(clue ? { clue_id: clue } : {}) });
    const s = G.draft.sub;
    if (s === 'PASS') return act(G, { type: 'PASS' });
    if (s === 'SHARE_EVIDENCE') return act(G, { type: 'SHARE_EVIDENCE', clue_id: clue, text: txt });
    if (!txt) return toast(T('请输入内容'));
    if (s === 'QUESTION' || s === 'ACCUSE') return act(G, { type: s, target: G.draft.target, text: txt });
    return act(G, { type: 'SPEAK', text: txt });
  };
}

// ---------- 结局 ----------
function renderEnding(G, D) {
  const { v, name, ch } = D;
  const el = document.getElementById('ending');
  if (v.phase !== 'ended') { el.innerHTML = ''; el._key = ''; return; }
  const endEv = v.events.find((e) => e.type === 'game_ended');
  const res = v.result;
  const truth = endEv.data.truth;
  const maxSeq = v.events[v.events.length - 1].seq;
  const key = `${G.replay}|${G.endOpen}`;
  if (el._key === key) return;
  el._key = key;
  const maxVotes = Math.max(...Object.values(res.tally), 1);
  const myRes = G.myPid ? res.players[G.myPid] : null;
  const m = v.metrics || {};
  setHTML(el, `<div class="card ending ${res.goodWin ? 'win-case' : 'lost-case'}">
    <div class="ending-head">
      <div>
        <span class="folder-kicker">${T('结案报告')}</span>
        <div class="verdict ${res.goodWin ? 'good' : 'bad'}">${res.goodWin ? T('真相大白：凶手被指认') : T('凶手逃脱了')}</div>
      </div>
      <button class="btn sm ghost" data-toggle>${G.endOpen === false ? T('展开') : T('收起')}</button>
    </div>
    ${myRes ? `<div class="my-outcome">${T('你的结果：')}${myRes.win ? `<span class="pill green">${T('阵营胜利')}</span>` : `<span class="pill red">${T('阵营失败')}</span>`} <span class="small muted">${T('任务完成 {a}/{b}', { a: myRes.score, b: myRes.objectives.length })}</span></div>` : ''}
    <div class="ending-body" ${G.endOpen === false ? 'hidden' : ''}>
      <div class="grid2 ending-cols">
        <div class="ending-box">
          <b>${PHASE_LABEL.vote}</b>
          <div class="tally">${Object.entries(res.tally).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<div class="bar"><span>${esc(name(pid))}${pid === res.murderer ? ' 🔪' : ''}</span><div class="bar-track"><div class="fill" style="width:${(n / maxVotes) * 100}%;background:${ch(pid)?.color}"></div></div><span class="mono-val">${n}</span></div>`).join('')}</div>
          <div class="small muted vote-chain">${Object.entries(endEv.data ? v.events.find((e) => e.type === 'votes_revealed').data.votes : {}).map(([a, b]) => `${esc(name(a))}→${esc(name(b))}`).join(T('，'))}</div>
        </div>
        <div class="ending-box">
          <b>${T('各角色任务')}</b>
          <div class="player-scores">
            ${Object.entries(res.players).map(([pid, p]) => `<div class="small score-row"><b>${esc(name(pid))}</b> ${p.win ? `<span class="pill green">${T('胜')}</span>` : `<span class="pill red">${T('负')}</span>`} <span class="muted">${p.objectives.map((o) => `${o.done ? '✅' : '❌'}${esc(o.desc)}`).join(' ')}</span></div>`).join('')}
          </div>
        </div>
      </div>
      <details class="ending-drawer" open><summary><b>${T('真相')}</b></summary>
        <p class="truth-summary">${esc(truth.summary)}</p>
        <div class="truth-tl">${truth.timeline.map((t) => `<div><b>${esc(t.time)}</b>${esc(t.text)}</div>`).join('')}</div>
        <div class="small muted secrets-list">${truth.secrets.map((s) => `<div>· ${T('{who}的秘密：', { who: `<b>${esc(name(s.who))}</b>` })}${esc(s.text)}</div>`).join('')}</div>
      </details>
      ${endingMediaHTML(v)}
      <details class="ending-drawer"><summary><b>${T('本局指标')}</b></summary>
        <div class="metrics" style="margin-top:8px">
          ${[[T('侦探投票准确率'), pct(m.detectiveVoteAccuracy)], [T('规则违规率'), pct(m.ruleViolationRate)], [T('搜到的线索'), m.cluesFound], [T('公开的线索'), m.cluesPublic], [T('关键线索公开'), m.keyCluesPublic], [T('搜证有效率'), pct(m.investigationEfficiency)], [T('AI 决策次数'), m.decisions], [T('模型回退次数'), m.llmFallbacks], [T('Token 用量'), m.tokens]].map(([k, val]) => `<div class="metric"><b>${val ?? '-'}</b><span>${k}</span></div>`).join('')}
        </div>
      </details>
      <div class="replay">
        <span class="small replay-label">⏪ ${T('回放')}</span>
        <input type="range" min="0" max="${maxSeq}" value="${G.replay ?? maxSeq}" data-replay>
        <span class="small muted mono-val" style="min-width:76px">${G.replay === null ? T('终局') : T('事件 {a}/{b}', { a: G.replay, b: maxSeq })}</span>
        ${G.replay !== null ? `<button class="btn sm" data-live>${T('回到终局')}</button>` : ''}
        <a class="btn sm" href="/api/games/${G.id}/log" download="mystery-${G.id}.json">${T('下载日志')}</a>
      </div>
    </div>
  </div>`);
  el.querySelector('[data-toggle]').onclick = () => { G.endOpen = G.endOpen === false; update(G); };
  const rp = el.querySelector('[data-replay]');
  if (rp) rp.oninput = () => { const n = Number(rp.value); G.replay = n >= maxSeq ? null : n; if (G.replay !== null) ttsStop(); update(G); };
  el.querySelector('[data-live]')?.addEventListener('click', () => { G.replay = null; update(G); });
}
// 终局：所有线索附带的图片 / 录音，以及没被任何人看到过的资料（终局后全部公开）
function endingMediaHTML(v) {
  const clues = new Map();
  for (const c of [...(v.allClues || []), ...(v.publicClues || []), ...(v.myClues || [])]) if (c.media?.some((id) => MEDIA[id]) && !clues.has(c.id)) clues.set(c.id, c);
  const used = new Set([v.scenario.cover, v.scenario.victim?.portrait, ...v.scenario.characters.map((c) => c.portrait), ...v.scenario.locations.map((l) => l.image), ...[...clues.values()].flatMap((c) => c.media)]);
  const rest = Object.keys(MEDIA).filter((id) => !used.has(id));
  if (!clues.size && !rest.length) return '';
  return `<details class="ending-drawer" data-dkey="ending-media"><summary><b>${T('证物图像与录音')}</b> <span class="pill">${clues.size + rest.length}</span></summary>
    <div class="evidence-grid">${[...clues.values()].map((c) => `<div class="ev-item"><b class="small">${esc(c.title)}</b>${mediaHTML(c.media, { ctx: `end-${c.id}` })}</div>`).join('')}
    ${rest.length ? `<div class="ev-item"><b class="small">${T('其他资料')}</b>${mediaHTML(rest, { ctx: 'end-rest' })}</div>` : ''}</div>
  </details>`;
}
const pct = (x) => (x === undefined || x === null ? '-' : `${Math.round(x * 100)}%`);

// ======================= 可视化 =======================
const VIZ_TABS = [['map', '🗺️ ' + T('现场')], ['graph', '🕸️ ' + T('关系')], ['timeline', '🕰️ ' + T('时间线')], ['suspect', '🎯 ' + T('嫌疑度')], ['board', '🗂️ ' + T('线索板')]];
function renderViz(G, D) {
  const tabs = document.getElementById('vtabs');
  const th = VIZ_TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${G.tab === k}" class="${G.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  if (tabs._html !== th) {
    tabs.innerHTML = th; tabs._html = th;
    tabs.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { G.tab = b.dataset.tab; store.set('ma_tab', G.tab); update(G); }; });
  }
  const body = document.getElementById('vbody');
  const fn = { map: vizMap, graph: vizGraph, timeline: vizTimeline, suspect: vizSuspect, board: vizBoard }[G.tab] || vizMap;
  const html = fn(G, D);
  if (body._html !== html) {
    setHTML(body, html); body._html = html;
    body.querySelectorAll('[data-room]').forEach((r) => {
      r.addEventListener('click', () => {
        const v = G.view;
        if (v.viewer.kind === 'player' && v.turn?.pid === v.viewer.pid && v.turn.kind === 'investigate') act(G, { type: 'INVESTIGATE', location: r.dataset.room });
      });
    });
  }
}

// --- 现场地图 ---
function vizMap(G, D) {
  const { v, sc, pos, ch, evs } = D;
  const W = 440; const H = 300; const RW = 160; const RH = 100; const PAD = 14;
  const locs = sc.locations;
  const xs = locs.map((l) => l.x); const ys = locs.map((l) => l.y);
  const nx = (x) => (Math.max(...xs) - Math.min(...xs) ? (x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs)) : 0.5);
  const ny = (y) => (Math.max(...ys) - Math.min(...ys) ? (y - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys)) : 0.5);
  const P = (l) => ({ x: PAD + nx(l.x) * (W - RW - PAD * 2), y: PAD + ny(l.y) * (H - RH - PAD * 2) });
  const center = (l) => { const p = P(l); return { x: p.x + RW / 2, y: p.y + RH / 2 }; };
  const searches = {};
  for (const e of evs) if (e.type === 'searched') searches[e.data.location] = (searches[e.data.location] || 0) + 1;
  const myTurnInv = v.viewer.kind === 'player' && v.turn?.pid === v.viewer.pid && v.turn.kind === 'investigate' && G.replay === null;
  const crime = locs[0];
  let svg = `<svg class="blueprint-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('现场地图')}">
    <defs>
      <pattern id="bpgrid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--line)" stroke-width="0.7" opacity=".55"/>
      </pattern>
      <linearGradient id="roomfade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--panel-2);stop-opacity:.95"/>
        <stop offset=".55" style="stop-color:var(--panel-2);stop-opacity:.7"/>
        <stop offset="1" style="stop-color:var(--panel-2);stop-opacity:.28"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="var(--bg-2)"/>
    <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="url(#bpgrid)"/>
    <rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="6" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  for (const l of locs.slice(1)) {
    const a = center(crime); const b = center(l);
    svg += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-opacity=".45" stroke-dasharray="4 4" stroke-width="1.5"/>`;
  }
  const maxS = Math.max(1, ...Object.values(searches));
  for (const l of locs) {
    const p = P(l);
    const total = v.locations.find((x) => x.id === l.id)?.total || 0;
    const foundHere = evs.filter((e) => e.type === 'clue_found' && e.data.clue && e.data.location === l.id).length;
    const remaining = G.replay !== null && v.viewer.kind === 'god' ? total - foundHere : v.locations.find((x) => x.id === l.id)?.remaining;
    const heat = (searches[l.id] || 0) / maxS;
    const li = img(l.image);
    const stroke = `stroke="${myTurnInv && remaining ? 'var(--accent-2)' : l === crime ? 'var(--accent)' : 'var(--line)'}" stroke-width="${l === crime || myTurnInv ? 2 : 1.2}"`;
    svg += `<g data-room="${l.id}" class="room ${myTurnInv && remaining ? 'clickable' : ''}" style="cursor:${myTurnInv && remaining ? 'pointer' : 'default'}">
      <rect x="${p.x}" y="${p.y}" width="${RW}" height="${RH}" rx="6" fill="var(--panel-2)" ${li ? '' : stroke}/>
      ${li ? `<clipPath id="mclip-${l.id}"><rect x="${p.x}" y="${p.y}" width="${RW}" height="${RH}" rx="6"/></clipPath>
      <image href="${esc(li.url)}" x="${p.x}" y="${p.y}" width="${RW}" height="${RH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#mclip-${l.id})" class="room-img" role="img" aria-label="${esc(li.alt)}"><title>${esc(li.alt)}</title></image>
      <rect x="${p.x}" y="${p.y}" width="${RW}" height="${RH}" rx="6" fill="url(#roomfade)" ${stroke}/>` : ''}
      <rect x="${p.x}" y="${p.y}" width="${RW}" height="${RH}" rx="6" fill="var(--accent)" opacity="${(heat * 0.18).toFixed(2)}"/>
      <text x="${p.x + 10}" y="${p.y + 22}" fill="var(--text)" font-size="14.5" font-family="var(--serif)" font-weight="700" ${li ? 'class="halo2"' : ''}>${esc(l.name)}${l === crime ? ' ✕' : ''}</text>
      <text x="${p.x + RW - 10}" y="${p.y + 40}" fill="var(--muted)" font-size="11" text-anchor="end" ${li ? 'class="halo2"' : ''}>${T('线索 {a}/{b}', { a: remaining, b: total })}</text>
      <text x="${p.x + 10}" y="${p.y + 40}" fill="${li ? 'var(--muted)' : 'var(--faint)'}" font-size="11" ${li ? 'class="halo2"' : ''}>${T('被搜查 {n} 次', { n: searches[l.id] || 0 })}</text>`;
    const here = Object.entries(pos).filter(([, loc]) => loc === l.id).map(([pid]) => pid);
    here.forEach((pid, i) => {
      const c = ch(pid);
      const cx = p.x + 22 + i * 28; const cy = p.y + RH - 22;
      const active = v.turn?.pid === pid && G.replay === null;
      const pi = img(c.portrait);
      svg += `<g><circle cx="${cx}" cy="${cy}" r="12" fill="${c.color}"/><text x="${cx}" y="${cy + 4.5}" font-size="12" fill="#fff" text-anchor="middle" font-family="var(--serif)">${esc(c.name[0])}</text>${pi ? `<clipPath id="tclip-${pid}"><circle cx="${cx}" cy="${cy}" r="12"/></clipPath><image href="${esc(pi.url)}" x="${cx - 12}" y="${cy - 12}" width="24" height="24" preserveAspectRatio="xMidYMid slice" clip-path="url(#tclip-${pid})" role="img" aria-label="${esc(pi.alt)}"/>` : ''}<circle cx="${cx}" cy="${cy}" r="12" fill="none" stroke="${active ? 'var(--accent-2)' : 'var(--bg)'}" stroke-width="${active ? 3 : 2}"/><title>${esc(c.name)}</title></g>`;
    });
    svg += `</g>`;
  }
  svg += '</svg>';
  const legend = `<div class="legend"><span>✕ ${T('案发现场')}</span><span>${T('头像 = 角色最近一次搜证的位置')}</span><span>${T('红色深浅 = 搜查频率')}</span>${myTurnInv ? `<span style="color:var(--accent-2);font-weight:600">${T('点击房间即可搜证')}</span>` : ''}</div>`;
  const loc = sc.locations.map((l) => `<div class="loc-item ${img(l.image) ? 'has-img' : ''}">${img(l.image) ? thumbHTML(l.image, 'loc-thumb') : ''}<div class="small"><b>${esc(l.name)}</b>${l === crime ? ` <span class="pill red">${T('案发现场')}</span>` : ''} <span class="muted">${esc(l.description || '')}</span></div></div>`).join('');
  return svg + legend + `<div class="loc-list">${loc}</div>`;
}

// --- 关系图 ---
function vizGraph(G, D) {
  const { v, sc, accus, decisions, ch, ended } = D;
  const W = 420; const H = 420; const cx = W / 2; const cy = H / 2; const R = 150;
  const chars = sc.characters;
  const P = {};
  chars.forEach((c, i) => { const a = -Math.PI / 2 + (i / chars.length) * Math.PI * 2; P[c.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
  let svg = `<svg class="conspiracy-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('人物关系图')}">
    <defs>
      <marker id="arR" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--bad)"/></marker>
      <marker id="arG" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--accent-2)"/></marker>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--line)" stroke-dasharray="2 6" opacity=".6"/>
    <circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="var(--line)" stroke-dasharray="2 6" opacity=".4"/>`;
  // 死者关系
  const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const dense = sc.characters.length > 5 || (sc.victimRelationships || []).length + (sc.relationships || []).length > 10;
  for (const r of sc.victimRelationships || []) {
    const p = P[r.who]; if (!p) continue;
    svg += `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="var(--line)" stroke-width="1.2" stroke-dasharray="3 3"/>`;
    // 标签放在靠近角色的一侧，6 人局时不会挤在死者周围
    svg += `<text x="${cx + (p.x - cx) * 0.66}" y="${cy + (p.y - cy) * 0.66 - 3}" font-size="10" fill="var(--faint)" text-anchor="middle" class="halo">${esc(clip(r.label, dense ? 6 : 12))}<title>${esc(r.label)}</title></text>`;
  }
  const rels = [...sc.relationships.map((r) => ({ ...r, hidden: false })), ...(ended || v.phase === 'ended' ? (v.events.find((e) => e.type === 'game_ended')?.data.truth.hiddenRelationships || []).map((r) => ({ ...r, hidden: true })) : []), ...(v.viewer.kind === 'god' && v.phase !== 'ended' ? [] : [])];
  for (const r of rels) {
    const a = P[r.a]; const b = P[r.b]; if (!a || !b) continue;
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    const dx = mx - cx; const dy = my - cy; const dist = Math.hypot(dx, dy);
    const bend = dist < 72
      ? { x: mx + (dx / (dist || 1)) * (56 - dist * 0.45), y: my + (dy / (dist || 1)) * (56 - dist * 0.45) }
      : { x: mx + (cx - mx) * 0.22, y: my + (cy - my) * 0.22 };
    svg += `<path d="M${a.x},${a.y} Q${bend.x},${bend.y} ${b.x},${b.y}" fill="none" stroke="${r.hidden ? 'var(--bad)' : 'var(--muted)'}" stroke-width="${r.hidden ? 2 : 1.3}" ${r.hidden ? 'stroke-dasharray="6 3"' : ''} opacity=".8"/>`;
    svg += `<text x="${(mx + bend.x) / 2}" y="${(my + bend.y) / 2}" font-size="10.5" fill="${r.hidden ? 'var(--bad)' : 'var(--muted)'}" text-anchor="middle" class="halo">${esc(clip(r.label, dense ? 6 : 12))}${r.hidden ? T('（隐藏）') : ''}<title>${esc(r.label)}</title></text>`;
  }
  // 公开的质询 / 指控箭头
  const agg = {};
  for (const a of accus) { const k = `${a.from}>${a.to}`; agg[k] = agg[k] || { ...a, n: 0, acc: 0 }; agg[k].n++; if (!a.q) agg[k].acc++; }
  const arrow = (a, b, color, marker, width, off) => {
    const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L; const uy = dy / L; const nx = -uy * off; const ny = ux * off;
    const s = { x: a.x + ux * 28 + nx, y: a.y + uy * 28 + ny }; const e = { x: b.x - ux * 30 + nx, y: b.y - uy * 30 + ny };
    return `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="${color}" stroke-width="${width}" marker-end="url(#${marker})" opacity=".85"/>`;
  };
  for (const a of Object.values(agg)) svg += arrow(P[a.from], P[a.to], 'var(--bad)', 'arR', 1 + a.n * 0.8 + a.acc, 5);
  // 上帝视角：每个 AI 当前最怀疑的人
  const latest = latestSuspicion(decisions);
  if (v.viewer.kind === 'god' || v.phase === 'ended') {
    for (const [pid, s] of Object.entries(latest)) {
      const top = Object.entries(s).sort((x, y) => y[1] - x[1])[0];
      if (top && P[top[0]] && top[1] > 0) svg += arrow(P[pid], P[top[0]], 'var(--accent-2)', 'arG', 1 + top[1] / 25, -5);
    }
  }
  // 节点
  const vp = img(sc.victim.portrait);
  svg += vp
    ? `<g><clipPath id="gclip-victim"><circle cx="${cx}" cy="${cy}" r="30"/></clipPath><circle cx="${cx}" cy="${cy}" r="30" fill="var(--bg-2)"/><image href="${esc(vp.url)}" x="${cx - 30}" y="${cy - 30}" width="60" height="60" preserveAspectRatio="xMidYMid slice" clip-path="url(#gclip-victim)" class="victim-img" role="img" aria-label="${esc(vp.alt)}"/><circle cx="${cx}" cy="${cy}" r="30" fill="none" stroke="var(--accent)" stroke-width="2.2"/>
      <text x="${cx}" y="${cy + 46}" text-anchor="middle" font-size="13" fill="var(--text)" font-family="var(--serif)" class="halo">${esc(sc.victim.name)}</text><text x="${cx}" y="${cy + 60}" text-anchor="middle" font-size="10" fill="var(--bad)" class="halo">${T('死者')}</text><title>${esc(sc.victim.name)}</title></g>`
    : `<g><circle cx="${cx}" cy="${cy}" r="30" fill="var(--bg-2)" stroke="var(--accent)" stroke-width="2.2"/><text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="14" fill="var(--text)" font-family="var(--serif)">${esc(sc.victim.name)}</text><text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="var(--bad)">${T('死者')}</text></g>`;
  for (const c of chars) {
    const p = P[c.id];
    const isTurn = v.turn?.pid === c.id && G.replay === null;
    const isM = (v.roles?.[c.id]?.isMurderer) || (v.phase === 'ended' && v.result?.murderer === c.id);
    const pi = img(c.portrait);
    svg += `<g><circle cx="${p.x}" cy="${p.y}" r="24" fill="${c.color}"/>
      <text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="18" fill="#fff" font-family="var(--serif)">${esc(c.name[0])}</text>
      ${pi ? `<clipPath id="gclip-${c.id}"><circle cx="${p.x}" cy="${p.y}" r="24"/></clipPath><image href="${esc(pi.url)}" x="${p.x - 24}" y="${p.y - 24}" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#gclip-${c.id})" role="img" aria-label="${esc(pi.alt)}"/>` : ''}
      <circle cx="${p.x}" cy="${p.y}" r="24" fill="none" stroke="${isTurn ? 'var(--accent-2)' : 'var(--bg)'}" stroke-width="${isTurn ? 4 : 3}"/>
      <text x="${p.x}" y="${p.y + 42}" text-anchor="middle" font-size="13" font-family="var(--serif)" font-weight="600" fill="var(--text)" class="halo">${esc(c.name)}${isM ? ' 🔪' : ''}</text></g>`;
  }
  svg += '</svg>';
  return svg + `<div class="legend"><span><i style="background:var(--muted)"></i>${T('公开关系')}</span><span><i style="background:var(--bad)"></i>${T('质询 / 指控（越粗越多）')}</span>${v.viewer.kind === 'god' || v.phase === 'ended' ? `<span><i style="background:var(--accent-2)"></i>${T('AI 心中最大的嫌疑人')}</span>` : ''}${v.phase === 'ended' ? `<span><i style="background:var(--bad);opacity:.6"></i>${T('终局揭晓的隐藏关系')}</span>` : ''}</div>`;
}

function latestSuspicion(decisions) {
  const out = {};
  for (const d of decisions) if (d.data.suspicion && Object.keys(d.data.suspicion).length) out[d.actor] = d.data.suspicion;
  return out;
}

// --- 时间线 ---
const toRange = (s) => { const all = [...String(s).matchAll(/(\d{1,2})[:：](\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2])); return all.length ? [all[0], all[1] ?? all[0]] : null; };
function vizTimeline(G, D) {
  const { v, evs, ch, name } = D;
  const items = [];
  const seenClue = new Set();
  const addClue = (c, priv) => { if (seenClue.has(c.id)) return; seenClue.add(c.id); const r = toRange(c.time); if (r) items.push({ r, id: c.id, label: c.title, color: priv ? 'var(--accent-2)' : 'var(--paper)', kind: priv ? T('私有线索') : T('公开线索') }); };
  for (const c of D.shared) addClue(c, false);
  for (const e of D.myFound) if (v.viewer.kind === 'player') addClue(e.data.clue, true);
  if (v.viewer.kind === 'god') for (const e of D.myFound) addClue(e.data.clue, true);
  for (const e of evs) {
    if (!['spoke', 'responded', 'accused', 'questioned'].includes(e.type)) continue;
    const r = toRange(e.data.text); if (!r) continue;
    items.push({ r, label: T('{name}：{text}', { name: name(e.actor), text: `${e.data.text.slice(0, 22)}${e.data.text.length > 22 ? '…' : ''}` }), color: ch(e.actor)?.color, kind: T('证词') });
  }
  if (v.viewer.kind === 'player') for (const k of v.you.knowledge) { const r = toRange(k.time || k.text); if (r && !k.lie) items.push({ r, label: `${T('（我的记忆）')}${k.text.slice(0, 20)}…`, color: ch(v.you.id).color, kind: T('记忆'), mine: true }); }
  const truth = v.phase === 'ended' && G.replay === null ? v.events.find((e) => e.type === 'game_ended').data.truth.timeline : [];
  const t0 = 20 * 60 + 45; const t1 = 23 * 60 + 15;
  const W = 420; const top = 20; const H = 560; const y = (m) => top + ((Math.max(t0, Math.min(t1, m)) - t0) / (t1 - t0)) * (H - top - 20);
  const axisX = 52;
  let svg = `<svg class="timeline-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('案情时间线')}">
    <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="var(--bg-2)" opacity=".55"/>`;
  for (let m = 21 * 60; m <= 23 * 60; m += 30) {
    svg += `<line x1="${axisX - 4}" x2="${W - 8}" y1="${y(m)}" y2="${y(m)}" stroke="var(--line)" stroke-width="${m % 60 ? 0.6 : 1.1}" ${m % 60 ? 'stroke-dasharray="3 3"' : ''}/>`;
    svg += `<text x="${axisX - 10}" y="${y(m) + 4}" font-size="11" font-family="var(--mono)" fill="var(--muted)" text-anchor="end">${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</text>`;
  }
  // 死亡时间带：尸检线索（标题「尸体初检」是剧本数据而非界面文本；翻译后标题会变，所以同时按 id 匹配）
  const deathBand = items.find((i) => i.label === '尸体初检' || /^c\d*_body$/.test(i.id || ''));
  if (deathBand) svg += `<rect x="${axisX}" y="${y(deathBand.r[0])}" width="${W - axisX - 8}" height="${Math.max(3, y(deathBand.r[1]) - y(deathBand.r[0]))}" fill="var(--bad)" opacity=".15"/><text x="${axisX - 10}" y="${(y(deathBand.r[0]) + y(deathBand.r[1])) / 2 + 4}" font-size="10" font-weight="600" fill="var(--bad)" text-anchor="end">${T('死亡')}</text>`;
  items.sort((a, b) => a.r[0] - b.r[0]);
  let lastY = -100; const lane = { x: axisX + 26 };
  const truthX = W - 120;
  const labelW = truth.length ? truthX - lane.x - 30 : W - lane.x - 30;
  items.forEach((it, i) => {
    const y0 = y(it.r[0]); const y1 = y(it.r[1]);
    const bx = axisX + 4 + (i % 4) * 5;
    let ly = Math.max(y0 + 4, lastY + 15); lastY = ly;
    const barCol = it.color === 'var(--paper)' ? 'var(--accent)' : it.color;
    svg += `<rect x="${bx}" y="${y0 - 2}" width="4" height="${Math.max(4, y1 - y0 + 4)}" rx="2" fill="${barCol}" opacity=".9"/>`;
    svg += `<line x1="${bx + 4}" y1="${y0}" x2="${lane.x + 8}" y2="${ly - 4}" stroke="var(--faint)" stroke-width=".7"/>`;
    svg += `<text x="${lane.x + 10}" y="${ly}" font-size="11.5" fill="var(--text)"><tspan fill="${barCol}">■</tspan> ${esc(trunc(it.label, Math.floor(labelW / 11.5)))}</text>`;
  });
  if (truth.length) {
    svg += `<line x1="${truthX - 8}" x2="${truthX - 8}" y1="${top}" y2="${H - 20}" stroke="var(--accent)" stroke-width="1.2"/><text x="${truthX}" y="${top - 6}" font-size="11" font-weight="700" fill="var(--accent)">${T('真相')}</text>`;
    let ty = -100;
    for (const t of truth) { const r = toRange(t.time); if (!r) continue; const yy = Math.max(y(r[0]) + 4, ty + 15); ty = yy; svg += `<circle cx="${truthX - 8}" cy="${y(r[0])}" r="3.2" fill="var(--accent)"/><text x="${truthX}" y="${yy}" font-size="10.5" fill="var(--muted)">${esc(trunc(t.text, 10))}</text>`; }
  }
  svg += '</svg>';
  return (items.length ? '' : `<div class="small muted viz-notice">${T('公开带有时间的线索或证词后，会自动排在时间线上。')}</div>`) + svg + `<div class="legend"><span>■ ${T('公开线索 / 私有线索 / 各角色证词（按发言人颜色）')}</span><span>${T('同一时间段出现矛盾的说法，就是突破口。')}</span></div>`;
}
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// --- 嫌疑度 ---
function vizSuspect(G, D) {
  const { v, sc, decisions, name, ch, accus } = D;
  const showPrivate = v.viewer.kind === 'god' || v.phase === 'ended';
  const chars = sc.characters;
  let html = '';
  // 公开信息：被质询/指控次数
  const cnt = Object.fromEntries(chars.map((c) => [c.id, { q: 0, a: 0 }]));
  for (const a of accus) cnt[a.to][a.q ? 'q' : 'a']++;
  const maxC = Math.max(1, ...Object.values(cnt).map((x) => x.q + x.a));
  html += `<b class="small viz-subhead">${T('公开的矛头')}</b><div class="tally">${chars.map((c) => `<div class="bar"><span>${esc(c.name)}</span><div class="bar-track" style="display:flex"><div class="fill" style="width:${(cnt[c.id].a / maxC) * 100}%;background:var(--bad)"></div><div class="fill" style="width:${(cnt[c.id].q / maxC) * 100}%;background:var(--accent-2);opacity:.8"></div></div><span class="mono-val">${cnt[c.id].q + cnt[c.id].a}</span></div>`).join('')}</div><div class="legend"><span><i style="background:var(--bad)"></i>${T('被指控')}</span><span><i style="background:var(--accent-2)"></i>${T('被质询')}</span></div>`;
  if (!showPrivate) return html + `<p class="small muted viz-notice">${T('AI 的内心嫌疑度属于私密信息。全 AI 对局可切换「上帝视角」查看，有真人的对局会在结束后公开。')}</p>`;
  const latest = latestSuspicion(decisions);
  const agents = chars.filter((c) => latest[c.id]);
  if (!agents.length) return html + `<p class="small muted viz-notice">${T('还没有 AI 做出决策。')}</p>`;
  const color = (x) => `hsl(${4 + (1 - x / 100) * 34}, ${36 + x * 0.48}%, ${22 + x * 0.24}%)`;
  html += `<b class="small viz-subhead" style="margin-top:14px">${T('AI 嫌疑度矩阵（行：谁在怀疑；列：怀疑谁）')}</b>
    <div class="heat-wrap"><table class="heat"><tr><th></th>${chars.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>
    ${agents.map((a) => `<tr><th style="text-align:right">${esc(a.name)}</th>${chars.map((c) => { const x = latest[a.id][c.id]; return c.id === a.id ? '<td class="self-cell">—</td>' : `<td style="background:${color(x || 0)}">${x ?? '-'}</td>`; }).join('')}</tr>`).join('')}
    </table></div>`;
  // 走势：对每个嫌疑人的平均嫌疑度随决策推进
  const series = Object.fromEntries(chars.map((c) => [c.id, []]));
  const cur = {};
  decisions.forEach((d, i) => {
    if (!d.data.suspicion || !Object.keys(d.data.suspicion).length) return;
    cur[d.actor] = d.data.suspicion;
    for (const c of chars) {
      const vals = Object.entries(cur).filter(([who]) => who !== c.id).map(([, s]) => s[c.id]).filter((x) => x !== undefined);
      if (vals.length) series[c.id].push([i, vals.reduce((a, b) => a + b, 0) / vals.length]);
    }
  });
  const W = 420; const H = 180; const n = Math.max(1, decisions.length - 1);
  let svg = `<svg viewBox="0 0 ${W} ${H + 24}" style="margin-top:14px"><text x="0" y="12" font-size="12" font-weight="600" fill="var(--muted)">${T('平均嫌疑度走势')}</text>`;
  for (const g of [0, 25, 50, 75, 100]) svg += `<line x1="30" x2="${W}" y1="${20 + H - (g / 100) * H}" y2="${20 + H - (g / 100) * H}" stroke="var(--line)" stroke-width=".6"/><text x="24" y="${24 + H - (g / 100) * H}" font-size="10" font-family="var(--mono)" fill="var(--faint)" text-anchor="end">${g}</text>`;
  for (const c of chars) {
    const pts = series[c.id].map(([i, val]) => `${30 + (i / n) * (W - 34)},${20 + H - (val / 100) * H}`).join(' ');
    if (pts) svg += `<polyline points="${pts}" fill="none" stroke="${c.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  svg += '</svg>';
  html += svg + `<div class="legend">${chars.map((c) => `<span><i style="background:${c.color}"></i>${esc(c.name)}</span>`).join('')}</div>`;
  // 最新想法
  const lastThought = {};
  for (const d of decisions) if (d.data.thought) lastThought[d.actor] = d.data;
  html += `<b class="small viz-subhead" style="margin-top:14px">${T('AI 最新的内心想法')}</b><div class="thoughts">${chars.filter((c) => lastThought[c.id]).map((c) => `<div class="t"><div class="row">${avatar(ch(c.id), 'sm')}<b>${esc(name(c.id))}</b><span class="pill">${esc(lastThought[c.id].provider || '')}</span></div><div class="thought-copy">💭 ${esc(lastThought[c.id].thought)}</div></div>`).join('')}</div>`;
  return html;
}

// --- 线索板 ---
function vizBoard(G, D) {
  const { v, sc, name } = D;
  const sharedIds = new Set(D.shared.map((c) => c.id));
  let groups;
  if (v.viewer.kind === 'god') {
    groups = sc.locations.map((l) => ({ l, cards: (v.allClues || []).filter((c) => c.location === l.id) }));
    return `<div class="pinboard">${groups.map(({ l, cards }) => `<section class="board-group"><h3 class="board-loc-title"><span>📍 ${esc(l.name)}</span><span class="pill">${cards.length}</span></h3><div class="cluelist">${cards.map((c) => clueHTML(c, { priv: !c.public, owner: c.owner ? name(c.owner) : T('未被发现'), foot: c.public ? `<span class="pill green">${T('已公开')}</span>` : c.owner ? `<span class="pill gold">${T('被隐藏')}</span>` : '' })).join('')}</div></section>`).join('')}</div>`;
  }
  const cards = [...D.shared.map((c) => ({ ...c, pub: true }))];
  if (v.viewer.kind === 'player') for (const c of v.myClues) if (!sharedIds.has(c.id) && G.replay === null) cards.push({ ...c, pub: false });
  if (!cards.length) return `<div class="board-empty"><p class="small muted">${T('还没有公开的线索。')}</p></div>`;
  return `<div class="pinboard">${sc.locations.map((l) => {
    const cs = cards.filter((c) => c.location === l.id);
    if (!cs.length) return '';
    return `<section class="board-group"><h3 class="board-loc-title"><span>📍 ${esc(l.name)}</span><span class="pill">${cs.length}</span></h3><div class="cluelist">${cs.map((c) => clueHTML(c, { priv: !c.pub, publicBy: c.sharedBy ? name(c.sharedBy) : '', foot: c.pub ? '' : `<span class="pill gold">${T('仅自己可见')}</span>` })).join('')}</div></section>`;
  }).join('')}</div>`;
}

// ======================= 启动 =======================
// 出错时在页面上提示，而不是留下白屏（老浏览器缺少某些 API 时尤其有用）
const showFatal = (msg) => {
  if (document.getElementById('fatalBar')) return;
  const bar = document.createElement('div');
  bar.id = 'fatalBar'; bar.setAttribute('role', 'alert');
  bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px 14px;border-radius:8px;background:#7a1f1f;color:#fff;font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = `<span style="flex:1;min-width:200px">${esc(T('页面出错了：{msg}。可尝试刷新，或换用最新版 Chrome / Safari / Edge。', { msg: String(msg || '').slice(0, 200) }))}</span><button type="button" style="padding:6px 12px;border-radius:6px;border:0;background:#fff;color:#7a1f1f;font-weight:600;cursor:pointer">${esc(T('刷新'))}</button>`;
  bar.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(bar);
};
window.addEventListener('error', (e) => showFatal(e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason?.message || e.reason));
window.addEventListener('hashchange', route);
route();
