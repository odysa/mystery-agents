// 后端多语言：以中文原文为键，tr(lang, '中文', vars) 返回对应语言的文本。
// 前端 public/i18n.js 用的是同样的约定。新增语言：在 DICTS 里加一张表即可。

export const SUPPORTED = ['zh', 'en'];
export const normLang = (l) => {
  const s = String(l || '').toLowerCase();
  return s.startsWith('en') ? 'en' : s.startsWith('zh') ? 'zh' : null;
};

const EN = {
  // ---------- 引擎：动作校验 ----------
  '游戏已结束': 'The game has ended',
  '动作格式错误': 'Malformed action',
  '现在不是你的回合': 'It is not your turn',
  '当前阶段只能执行: {list}': 'Allowed in this phase: {list}',
  '未知地点 {loc}': 'Unknown location {loc}',
  '发言内容不能为空': 'Text must not be empty',
  '目标必须是其他玩家': 'Target must be another player',
  '内容不能为空': 'Text must not be empty',
  '只能投给其他玩家': 'You can only vote for another player',
  '你没有这条线索': 'You do not have this clue',
  '这条线索已经公开了': 'This clue is already public',
  '（出示了一条线索）': '(showed a clue)',
  // ---------- 运行器 ----------
  '该座位由内置 AI 控制': 'This seat is controlled by a built-in AI',
  // ---------- 服务器 ----------
  '无效的玩家凭证': 'Invalid player token',
  '有真人玩家的对局在结束前不能使用上帝视角': 'God view is not available in games with humans or agents until the game ends',
  '剧本不存在': 'Scenario not found',
  '对局不存在': 'Game not found',
  '未找到': 'Not found',
  '这局没有空位了': 'No open seats left in this game',
  '角色 {pid} 不是空位，可选：{list}': 'Character {pid} is not an open seat. Open: {list}',
  '需要玩家凭证 token': 'A player token is required',
  '缺少 action，例如 {"type":"SPEAK","text":"……"}': 'Missing action, e.g. {"type":"SPEAK","text":"..."}',
  '只有创建对局的人才能暂停或调整速度': 'Only the game creator can pause or change speed',
  '有真人玩家的对局不能暂停': 'Games with humans or agents cannot be paused',
  '未知操作': 'Unknown operation',
  '对局结束后才能下载完整日志': 'The full log is available after the game ends',
  '这台服务器关闭了剧本投稿（MA_ALLOW_SUBMIT=0）': 'Scenario submission is disabled on this server (MA_ALLOW_SUBMIT=0)',
  '剧本 id「{id}」已被占用，请换一个 id': 'Scenario id "{id}" is taken, please choose another',
  '试玩未能正常完成，暂不接受发布': 'The trial games did not complete, so the scenario cannot be published',
  '社区剧本数量已达上限': 'The community scenario limit has been reached',
  '只能下载内置剧本作为模板': 'Only built-in scenarios can be downloaded as templates',
  'webhook 智能体默认关闭，启动服务器时设置 MA_ALLOW_WEBHOOK=1 开启；也可以用 external 座位通过 HTTP 拉取观察': 'Webhook agents are disabled by default. Start the server with MA_ALLOW_WEBHOOK=1, or use an "external" seat and pull observations over HTTP',
  '{name} 的 webhook URL 无效': 'Invalid webhook URL for {name}',
  '{name} 的智能体「{kind}」当前不可用：{hint}': 'Agent "{kind}" for {name} is not available: {hint}',
  '未知类型': 'unknown type',
  '（还没轮到你：再次请求本地址继续等待）': '(Not your turn yet: request this URL again to keep waiting)',
  '{path}：投稿时媒体请用 data URI 内嵌或 https 链接': '{path}: in submissions, media must be an embedded data URI or an https link',
  '请求体太大': 'Request body too large',
  // ---------- 规则型 AI 台词 ----------
  '我在{loc}找到了这个：「{title}」。大家看看。': 'I found this in the {loc}: "{title}". Take a look.',
  '我公开一条线索——{title}。这很关键。': 'I\'m revealing a clue — {title}. This matters.',
  '{title}，这是我在{loc}发现的，我觉得和案子有关。': '{title} — I found it in the {loc}. I think it\'s connected to the case.',
  '这条线索能证明我的清白：「{title}」。': 'This clue proves I\'m innocent: "{title}".',
  '{name}，请你说清楚：案发前后你到底在哪里？': '{name}, tell us clearly: where exactly were you around the time of the murder?',
  '{name}，线索都指向你，你怎么解释？': '{name}, the clues all point to you. How do you explain that?',
  '{name}，你今晚和{victim}最后一次见面是什么时候？': '{name}, when did you last see {victim} tonight?',
  '我认为凶手就是{name}。{reason}': 'I believe the murderer is {name}. {reason}',
  '综合目前的线索，{name}的嫌疑最大。{reason}': 'Putting the clues together, {name} is the prime suspect. {reason}',
  '我觉得{name}很可疑，案发前去过{scene}的人，都应该交代清楚。': '{name} looks suspicious to me. Anyone who went to the {scene} before the murder should explain themselves.',
  '{name}到现在都没说清楚自己的行踪。': '{name} still hasn\'t explained where they were.',
  '{cover}': '{cover}',
  '我说实话：{cover}': 'Honestly: {cover}',
  '{cover}你们别乱猜，我没有理由害{victim}。': '{cover} Stop guessing — I had no reason to hurt {victim}.',
  '{cover}倒是{name}，你自己的行踪说清楚了吗？': '{cover} And what about you, {name}? Have you accounted for your own whereabouts?',
  '我把时间线理一下：{victim}出事的那段时间，谁没有人证？': 'Let me go over the timeline: who has no alibi for the time {victim} died?',
  '现在线索还不够，我想再听听大家的说法。': 'We don\'t have enough yet. I want to hear more from everyone.',
  '我还在想谁的说法前后对不上。': 'I\'m still working out whose story doesn\'t add up.',
  '等一下——{text}这说不通。': 'Wait — {text} That doesn\'t add up.',
  '线索和证词都对他/她不利。': 'Both the clues and the testimony go against them.',
  '去{loc}搜证': 'Search the {loc}',
  '投给嫌疑最大的{name}': 'Vote for the prime suspect, {name}',
  '{cover}不信你们看这条线索。': '{cover} If you don\'t believe me, look at this clue.',
  '证据最多指向{name}': 'Most of the evidence points to {name}',
  '我今晚没做什么特别的事。': 'I didn\'t do anything unusual tonight.',
  '死者': 'the victim',
  '案发现场': 'crime scene',
};

const DICTS = { en: EN };

export function tr(lang, zh, vars) {
  let s = (lang && DICTS[lang]?.[zh]) || zh;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}

/** 从请求中取语言：?lang= 优先，其次 x-ma-lang 头，最后 Accept-Language。 */
export function langOf(req, q) {
  return normLang(q?.get?.('lang')) || normLang(req.headers['x-ma-lang']) || normLang(String(req.headers['accept-language'] || '').split(',')[0]) || 'zh';
}

// ---------- 剧本校验与难度体检的消息（模板化文本，用正则翻译） ----------
const MSG_EN = [
  [/^(.+) 必须是字符串（最多 (\d+) 字）$/, '$1 must be a string (max $2 chars)'],
  [/^(.+) 必须是字符串$/, '$1 must be a string'],
  [/^(.+) 太长$/, '$1 is too long'],
  [/^(.+) 必须是数组，至少 (\d+) 项$/, '$1 must be an array with at least $2 items'],
  [/^(.+) 必须是数组$/, '$1 must be an array'],
  [/^(.+) 必须是由字母、数字、-、_ 组成的 id（当前：(.*)）$/, '$1 must be an id of letters, digits, - and _ (got: $2)'],
  [/^(.+) 必须是 \{角色id: 权重\} 对象，权重为 -10 到 10 的数字$/, '$1 must be a {characterId: weight} object with weights from -10 to 10'],
  [/^(.+)\.color 必须是 #RRGGBB 格式的颜色$/, '$1.color must be a #RRGGBB color'],
  [/^(.+)\.isMurderer 必须是布尔值$/, '$1.isMurderer must be a boolean'],
  [/^(.+)\.time 必须是字符串$/, '$1.time must be a string'],
  [/^(.+)\.type 必须是 (.+) 之一$/, '$1.type must be one of $2'],
  [/^(.+)\.time 必须为空或 HH:MM \/ HH:MM-HH:MM（当前：(.*)）$/, '$1.time must be empty, HH:MM or HH:MM-HH:MM (got: $2)'],
  [/^(.+) 必须是 0 到 5 的整数$/, '$1 must be an integer from 0 to 5'],
  [/^(.+)\.implicates 必填$/, '$1.implicates is required'],
  [/^(.+) 的 x、y 必须是 0 到 1 的数字$/, '$1: x and y must be numbers from 0 to 1'],
  [/^format 必须是 "(.+)"（当前：(.*)）$/, 'format must be "$1" (got: $2)'],
  [/^players=(\d+) 与角色数量 (\d+) 不一致$/, 'players=$1 does not match the number of characters ($2)'],
  [/^translations 的键必须是两位小写语言代码（如 en），当前：(.+)$/, 'translations keys must be two-letter lowercase language codes (e.g. en), got: $1'],
  [/^translations\.(\w+) 必须是对象$/, 'translations.$1 must be an object'],
  [/^translations\.(\w+)\.(\w+) 里的 (.+) 不是有效 id$/, 'translations.$1.$2: $3 is not a valid id'],
  [/^不可解：指向凶手的证据权重\((-?\d+)\) 不高于 (.+)\((-?\d+)\)$/, 'Unsolvable: evidence weight on the murderer ($1) is not higher than on $2 ($3)'],
  [/^存在无法被发现的线索（依赖成环）: (.+)$/, 'Some clues can never be found (circular requires): $1'],
  [/^总搜证次数 (\d+) 太少（线索 (\d+) 条）$/, 'Total searches ($1) are too few for $2 clues'],
  [/^矛盾 (.+) 引用了不存在的线索 (.+)$/, 'Contradiction $1 references unknown clue $2'],
  [/^矛盾 (.+) 引用了不存在的证词 (.+)$/, 'Contradiction $1 references unknown knowledge $2'],
  [/^线索 (.+) 不能依赖自身$/, 'Clue $1 cannot require itself'],
  [/^线索 (.+) 依赖不存在的线索 (.+)$/, 'Clue $1 requires unknown clue $2'],
  [/^线索 (.+) 指向未知角色 (.+)$/, 'Clue $1 implicates unknown character $2'],
  [/^线索 (.+) 的地点 (.+) 不存在$/, 'Clue $1: location $2 does not exist'],
  [/^角色 (.+) 的任务引用了不存在的线索 (.+)$/, 'Character $1 has an objective referencing unknown clue $2'],
  [/^角色 (.+) 缺少任务 objectives$/, 'Character $1 has no objectives'],
  [/^角色 (.+) 缺少剧本 script$/, 'Character $1 has no script'],
  [/^证词 (.+) 指向未知角色 (.+)$/, 'Knowledge $1 implicates unknown character $2'],
  [/^config\.rounds 最多 4 轮$/, 'config.rounds can have at most 4 rounds'],
  [/^isMurderer 与 truth\.murderer 不一致$/, 'isMurderer does not match truth.murderer'],
  [/^phaseNarration 必须是 \{ 阶段键: 文本 \} 对象$/, 'phaseNarration must be a { phaseKey: text } object'],
  [/^players 必须是 3 到 10 的整数$/, 'players must be an integer from 3 to 10'],
  [/^translations 必须是 \{ 语言代码: \{…\} \} 对象$/, 'translations must be a { languageCode: {...} } object'],
  [/^truth 必须是对象$/, 'truth must be an object'],
  [/^truth\.murderer 不是有效角色$/, 'truth.murderer is not a valid character'],
  [/^victim 必须是对象 \{ id, name, bio \}$/, 'victim must be an object { id, name, bio }'],
  [/^必须恰好有一名凶手 \(isMurderer\)$/, 'There must be exactly one murderer (isMurderer)'],
  [/^线索 id 重复$/, 'Duplicate clue ids'],
  [/^至少需要 3 个搜证地点$/, 'At least 3 locations are required'],
  [/^角色 id 重复$/, 'Duplicate character ids'],
  [/^剧本必须是一个 JSON 对象$/, 'The scenario must be a JSON object'],
  [/^剧本结构无法解析：(.+)$/, 'Could not parse the scenario structure: $1'],
  // 媒体
  [/^assets 必须是 \{ 媒体id: \{…\} \} 对象$/, 'assets must be a { mediaId: {...} } object'],
  [/^(.+)：媒体 id 只能包含字母、数字、-、_$/, '$1: media ids may only contain letters, digits, - and _'],
  [/^(.+)\.type 必须是 image 或 audio$/, '$1.type must be image or audio'],
  [/^(.+)\.src 必须是字符串$/, '$1.src must be a string'],
  [/^(.+)\.src data URI 必须是 data:<类型>;base64,<数据>$/, '$1.src: a data URI must look like data:<type>;base64,<data>'],
  [/^(.+)\.src 不支持的(?:图片|音频)类型 (.+)$/, '$1.src: unsupported media type $2'],
  [/^(.+)\.src 内嵌媒体超过 4MB$/, '$1.src: embedded media exceeds 4 MB'],
  [/^(.+)\.src 必须是 media\/ 开头的相对路径、https 链接或 data URI$/, '$1.src must be a relative media/ path, an https link or a data URI'],
  [/^(.+)\.src 扩展名必须是 (.+) 之一$/, '$1.src: extension must be one of $2'],
  [/^(.+)\.alt 必填（文字描述，最多 500 字），给看不到媒体的玩家和纯文本 AI 用$/, '$1.alt is required (text description, max 500 chars) for players who cannot see or hear it and for text-only AIs'],
  [/^(.+)\.transcript 必须是字符串（最多 5000 字）$/, '$1.transcript must be a string (max 5000 chars)'],
  [/^(.+) 引用的媒体「(.+)」不存在或不是图片$/, '$1 references media "$2", which does not exist or is not an image'],
  [/^(.+) 引用的媒体「(.+)」不存在或不是音频$/, '$1 references media "$2", which does not exist or is not audio'],
  [/^(.+) 引用的媒体「(.+)」不存在$/, '$1 references media "$2", which does not exist'],
  [/^(.+) 必须是媒体 id 数组$/, '$1 must be an array of media ids'],
  [/^(.+)\.gender 必须是 (.+)$/, '$1.gender must be $2'],
  [/^(.+)\.age 必须是 (.+)$/, '$1.age must be $2'],
  [/^(.+)\.(pitch|rate) 必须是 0\.5 到 2 的数字$/, '$1.$2 must be a number from 0.5 to 2'],
  [/^(.+)\.style 必须是字符串（最多 100 字）$/, '$1.style must be a string (max 100 chars)'],
  [/^(.+)：媒体「(.+)」不存在$/, '$1: media "$2" does not exist'],
  [/^(.+)：SVG 包含脚本或事件属性$/, '$1: the SVG contains scripts or event attributes'],
  [/^(.+)：SVG 包含外部引用（只允许 #id 或 data:image）$/, '$1: the SVG contains external references (only #id or data:image allowed)'],
  [/^(.+)：SVG 样式里包含外部引用$/, '$1: the SVG styles contain external references'],
  [/^(.+)：找不到文件 (.+)$/, '$1: file not found: $2'],
  [/^(.+)：文件超过 8MB$/, '$1: file exceeds 8 MB'],
  [/^(.+) 必须是对象$/, '$1 must be an object'],
  // 难度体检
  [/^指向凶手的线索权重占 (\d+)%，案子可能太容易（建议 ≤ 40%）$/, '$1% of clue weight points at the murderer — the case may be too easy (aim for ≤ 40%)'],
  [/^有线索单独指向凶手的权重达到 (\d+)，可能一条线索就能破案（建议 ≤ 3）$/, 'A single clue puts weight $1 on the murderer — one clue may solve the case (aim for ≤ 3)'],
  [/^强干扰嫌疑人只有 (\d+) 个（线索权重达到凶手一半以上的其他角色），建议至少 2 个$/, 'Only $1 strong red herring(s) (others with at least half the murderer\'s clue weight); aim for at least 2'],
  [/^没有使用 requires 前置线索，推理链可能偏短$/, 'No clue uses requires — the deduction chain may be short'],
  [/^总搜证次数 (\d+) 少于线索数 (\d+)，部分线索注定找不到$/, 'Total searches ($1) are fewer than clues ($2); some clues can never be found'],
  [/^总搜证次数 (\d+) 远多于线索数 (\d+)，后期搜证会大量落空$/, 'Total searches ($1) far exceed clues ($2); late searches will mostly come up empty'],
  [/^(.+) 没有秘密（knowledge 中没有 secret: true）$/, '$1 has no secret (no knowledge item with secret: true)'],
  [/^没有预埋矛盾（contradictions），AI 与评测会少一类推理$/, 'No contradictions defined; AI and evaluation lose a whole kind of reasoning'],
  [/^(.+) 的剧本少于 150 字，玩家可能不知道该怎么演$/, '$1\'s script is under 150 characters; the player may not know how to play it'],
];

/** 翻译一条模板化消息（校验错误、难度提示）。没有匹配的规则时原样返回。 */
export function trMsg(lang, msg) {
  if (lang !== 'en' || typeof msg !== 'string') return msg;
  for (const [re, en] of MSG_EN) if (re.test(msg)) return msg.replace(re, en);
  return msg;
}
