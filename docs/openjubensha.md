# OpenJubensha 开放剧本杀格式 v1

> 格式标识：`openjubensha/1` · JSON Schema：[`schema/openjubensha-1.schema.json`](../schema/openjubensha-1.schema.json) · 参考实现：[`src/engine/scenario.js`](../src/engine/scenario.js)

OpenJubensha 是一个**多模态、多语言、机器可读、可校验、可被 AI 直接游玩**的剧本杀剧本格式。一个剧本是一个 UTF-8 JSON 文件，加上可选的媒体目录（`<剧本id>/media/`）。它的目标是：

- **作者友好**：纯数据，任何编辑器都能写；加上 `$schema` 就有自动补全。
- **引擎无关**：格式只描述「故事 + 信息分配 + 规则参数」，不包含代码。任何实现都可以读取同一个剧本。
- **AI 可玩**：信息可见性写进格式里，引擎可以严格保证每个角色（真人或 AI）只拿到自己该拿到的信息。
- **可评测**：作者标注（线索指向谁、哪些是关键线索、哪些证词与线索矛盾）让难度、平衡性与 AI 推理能力可以被量化。

本文中的「必须 / 应该 / 可以」分别对应 RFC 2119 的 MUST / SHOULD / MAY。

## 1. 文件

- 文件名应为 `<id>.json`，`id` 只能包含字母、数字、`-`、`_`（最长 64）。
- 文件应以下面两行开头：

```json
{
  "$schema": "https://<你的服务器>/schema/openjubensha-1.schema.json",
  "format": "openjubensha/1",
  ...
}
```

- 所有面向玩家的文本可以是任何语言；`language` 字段用 BCP 47 标签声明（如 `zh-CN`）。

## 2. 信息可见性（格式的核心）

格式里的每个字段都属于下面四个可见层之一。**实现必须遵守**：

| 层 | 谁能看到 | 字段 |
|---|---|---|
| 公开 | 所有玩家与观众，开局即可见 | `title` `subtitle` `background` `intro` `victim` `locations` `characters[].{id,name,color,publicBio}` `relationships[public=true]` `victimRelationships` `config` |
| 角色私有 | 只有该角色的玩家 | `characters[].{script,personality,coverStory,isMurderer,knowledge,objectives}` |
| 获得后可见 | 搜到它的玩家；被公开后所有人 | `clues[].{id,title,text,time,location}` |
| 作者标注 | **永远不发给玩家或 AI**，只用于裁决、评测、终局揭晓 | `clues[].{implicates,requires,key}` `characters[].ruleHints` `contradictions` `truth` `relationships[public=false]`（终局揭晓） |

`characters[].knowledge[].implicates` 也属于作者标注。终局时实现可以揭晓 `truth`、全部 `script` 与隐藏关系。

## 3. 字段

### 3.1 顶层

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✔ | 全局唯一 |
| `format` | 建议 | 固定为 `openjubensha/1` |
| `title` | ✔ | ≤ 40 字 |
| `subtitle` |  | 一句话简介 |
| `version` `language` `license` `author` `tags` |  | 元数据。推荐许可证 CC BY 4.0 |
| `players` | ✔ | 3–10，必须等于 `characters` 数量 |
| `difficulty` |  | `入门` / `进阶` / `困难` |
| `estimatedMinutes` |  | 预计时长 |
| `background` | ✔ | 背景故事（公开） |
| `intro` | ✔ | 主持人开场白 |
| `victim` | ✔ | `{ id, name, bio? }` |
| `locations` | ✔ | ≥ 3 个搜证地点，**第一个是案发现场** |
| `characters` | ✔ | 角色 |
| `relationships` |  | `{ a, b, label, public }` |
| `victimRelationships` |  | `{ who, label }` |
| `clues` | ✔ | ≥ 3 条线索 |
| `contradictions` |  | 预埋矛盾 |
| `truth` | ✔ | 真相 |
| `config` | ✔ | 规则参数 |
| `phaseNarration` |  | 阶段旁白 |
| `translations` |  | 其他语言的翻译，见 3.9 |
| `assets` `cover` |  | 媒体与封面，见 3.10 |

### 3.2 `locations[]`

`{ id, name, description?, x, y }`。`x`、`y` 为 0–1 的相对坐标，用于绘制地图。

### 3.3 `characters[]`

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` `name` | ✔ | |
| `color` | ✔ | `#RGB` / `#RRGGBB` |
| `publicBio` | ✔ | 公开简介 |
| `script` | ✔ | 角色剧本（私有）。建议包含按 `HH:MM` 排列的【当晚经历】 |
| `personality` |  | 性格，给 AI 的表演提示 |
| `isMurderer` |  | **恰好一个**角色为 `true` |
| `coverStory` |  | 被质询时的标准说法 |
| `knowledge[]` |  | 角色记得的事：`{ id, text, time?, implicates?, secret?, lie? }`。`secret` 表示不愿主动说出；`lie` 表示这是谎言 |
| `objectives[]` | ✔ | 任务：`{ type, desc, clue? }` |
| `ruleHints` |  | 给离线 AI 的提示，如 `preferredLocations` |

任务类型（全部由引擎在终局自动判定）：

| `type` | 完成条件 |
|---|---|
| `find_murderer` | 自己投票投中凶手 |
| `escape` | 凶手未被指认（平票也算） |
| `clue_public` | 终局时 `clue` 已被公开 |
| `clue_not_public` | 终局时 `clue` 未被公开 |
| `not_most_voted` | 自己不是得票最多的人 |

### 3.4 `clues[]`

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` `location` `title` `text` | ✔ | |
| `time` |  | 空，或 `HH:MM`，或 `HH:MM-HH:MM`。带时间的线索会进入时间线 |
| `implicates` |  | 作者标注 `{ 角色id: 权重 }`，权重 −10 到 10，负数表示有利于洗清嫌疑 |
| `requires` |  | 前置线索 id 列表：只有搜证者自己持有这些线索、或它们已被公开时，才可能搜到这条 |
| `key` |  | 关键线索 |

### 3.5 `contradictions[]`

`{ id, knowledge, clue, text, implicates }`：某条证词（`knowledge`）与某条线索（`clue`）冲突。用于评测 AI 能否发现矛盾，也供离线 AI 使用。

### 3.6 `truth`

`{ murderer, weapon?, summary, timeline: [{ time, text }], secrets?: [{ who, text }] }`。终局揭晓。

### 3.7 `config`

`{ rounds: [{ investigate, discuss }], maxSpeechChars? }`：最多 4 轮；每轮每人搜证 `investigate` 次（0–5），讨论 `discuss` 次（0–5）。

### 3.8 `phaseNarration`

键为 `investigate_<轮>`、`discuss_<轮>`、`vote`，值为进入该阶段时的旁白。

## 3.9 翻译 `translations`

一个剧本文件可以自带多种语言。原文语言由 `language` 声明（如 `zh-CN`）；其他语言放在 `translations.<两位语言代码>` 下，**按 id 覆盖可翻译的文本字段**：

```json
"translations": {
  "en": {
    "title": "…", "subtitle": "…", "background": "…", "intro": "…",
    "victim": { "name": "…", "bio": "…" },
    "locations": { "<地点id>": { "name": "…", "description": "…" } },
    "characters": { "<角色id>": {
      "name": "…", "publicBio": "…", "personality": "…", "script": "…", "coverStory": "…",
      "knowledge": { "<证词id>": "…" },
      "objectives": ["与 objectives 一一对应的 desc", "…"]
    } },
    "relationships": ["与 relationships 一一对应的 label"],
    "victimRelationships": ["…"],
    "clues": { "<线索id>": { "title": "…", "text": "…" } },
    "contradictions": { "<矛盾id>": "…" },
    "truth": { "summary": "…", "weapon": "…", "timeline": ["与 timeline 一一对应的 text"], "secrets": ["…"] },
    "phaseNarration": { "investigate_1": "…" }
  }
}
```

规则：

- 只能翻译文本；id、结构、权重、时间、`requires` 等都与语言无关，不能在翻译里改。
- 缺失的字段回退到原文。`npm run validate` 会显示每种语言的覆盖率，加 `--missing` 列出缺失字段。
- **一局只用一种语言**：创建对局时选择语言（`"lang": "en"`），引擎用该语言的剧本文本、AI 台词和提示。
- 翻译必须保留推理所依赖的细节（时间、数字、措辞上的破绽），否则剧本在该语言下可能不可解。

## 3.10 多模态：图片、音频与角色声音

剧本可以带图片和音频。媒体在顶层 `assets` 里登记，再在各处按 id 引用：

```json
"assets": {
  "cover":      { "type": "image", "src": "media/cover.svg", "alt": "雨夜里亮着灯的窑厂" },
  "p_lu_yuan":  { "type": "image", "src": "media/lu_yuan.svg", "alt": "穿灰色工装的年轻陶艺师" },
  "a_voicemail":{ "type": "audio", "src": "media/voicemail.wav", "alt": "一段电话留言录音", "transcript": "……" }
},
"cover": "cover",
"victim":     { "id": "…", "name": "…", "portrait": "p_victim" },
"characters": [{ "id": "lu_yuan", "portrait": "p_lu_yuan", "voice": { "gender": "male", "age": "young", "pitch": 0.9, "rate": 1.0, "style": "低沉、话少" }, "media": ["…"] }],
"locations":  [{ "id": "kiln", "image": "loc_kiln" }],
"clues":      [{ "id": "c_voicemail", "media": ["a_voicemail"] }]
```

| 字段 | 说明 |
|---|---|
| `assets.<id>.type` | `image` 或 `audio` |
| `assets.<id>.src` | 剧本包内的相对路径 `media/…`（文件放在 `scenarios/<剧本id>/media/`）、`https://` 链接，或 `data:<类型>;base64,…` 内嵌（单个 ≤ 4MB，投稿时服务器会提取成文件） |
| `assets.<id>.alt` | **必填**的文字描述。给看不到图片、听不到声音的玩家，以及纯文本 AI 使用 |
| `assets.<id>.transcript` | 音频的文字稿（推荐） |
| `assets.<id>.credit` `license` | 作者与许可 |
| `cover` | 封面图 |
| `victim.portrait` `characters[].portrait` | 头像 |
| `locations[].image` | 地点图 |
| `clues[].media` | 附在线索上的图片 / 音频 |
| `characters[].media` | 只属于该角色的私密媒体（剧本附图、私人录音） |
| `characters[].voice` | 角色声音：`gender`（female/male/neutral）、`age`（child/young/adult/old）、`pitch`、`rate`（0.5–2）、`style`（文字描述，如「沙哑、语速快」）。实现用它做语音合成，或交给 TTS 服务 |

支持的格式：图片 png / jpg / webp / gif / svg；音频 mp3 / ogg / wav / m4a / webm。

**媒体的可见性跟随它被引用的位置**，实现必须遵守：

| 引用位置 | 谁能看到 / 听到 |
|---|---|
| `cover`、头像、地点图 | 所有人 |
| `clues[].media` | 与线索相同：找到它的人；被公开后所有人 |
| `characters[].media` | 只有该角色 |
| 没有被任何地方引用 | 没有人 |

参考实现通过 `/api/games/<对局id>/media/<媒体id>?token=…` 按观察者权限提供私密媒体，公开媒体走 `/media/<剧本id>/<媒体id>`。

**翻译**：`translations.<语言>.assets.<媒体id>` 可以覆盖 `alt`、`transcript`，也可以用 `src` 换成该语言的版本（例如英文配音的录音）；`translations.<语言>.characters.<角色id>.voice.style` 翻译声音描述。

**建议**：图片里尽量不放文字，这样各语言通用；如果线索的关键在图上，`alt` 必须把推理需要的信息写全，保证纯文本玩家也能解开。SVG 不能包含脚本、事件属性或外部引用。

## 4. 游戏流程（实现语义）

1. **开场**：每人阅读剧本并确认（READY）。
2. 对 `config.rounds` 中的每一轮：
   - **搜证**：按座次，每人 `investigate` 次。每次选择一个地点，从该地点「尚未被找到、前置条件已满足」的线索中随机得到一条（实现应使用可复现的随机种子）。也可以跳过。
   - **讨论**：按座次，每人 `discuss` 次。可以发言、质询（被质询者必须立刻回答）、公开线索、指控、跳过。
3. **投票**：每人投一票，得票最多者被指认；平票则凶手逃脱。
4. **结局**：凶手被指认则侦探方胜，否则凶手胜；逐个判定任务；揭晓 `truth`。

## 5. 校验规则

一个剧本**必须**满足：

1. 符合 JSON Schema（类型、长度、id 格式、颜色格式、时间格式）。
2. 所有引用有效：线索地点、`implicates` 中的角色、`requires`、任务中的线索、矛盾中的证词与线索、`truth.murderer`。
3. 恰好一名凶手，且与 `truth.murderer` 一致。
4. 线索依赖无环：每条线索都能按某种顺序被发现。
5. 总搜证次数（人数 × 各轮搜证次数之和）不少于线索数的一半。
6. **可解性**：把所有线索、以及非凶手角色的非秘密且非谎言证词的 `implicates` 加起来，凶手的总分必须**严格高于**其他任何角色。

运行 `npm run validate` 检查所有剧本，或在网页「投稿剧本」里粘贴检查。

## 6. 难度建议（不影响合法性）

参考实现会给出体检报告（`lintScenario`）：

- 指向凶手的正权重占全部正权重的比例 **≤ 40%**（> 50% 会提示太容易）。
- 任何单条线索对凶手的权重 **≤ 3**，不要让一条线索独自破案。
- 至少 **2 个强干扰嫌疑人**（线索权重达到凶手一半以上）。
- 使用 `requires` 构造推理链；预埋矛盾，并让至少一个**无辜者**也在撒谎。
- 总搜证次数在线索数的 1–2 倍之间。

内置剧本《雨夜窑火》是刻意写得很直白的入门剧本（凶手权重 74%），其余 10 个剧本都按以上建议编写（23%–36%）。

## 7. 版本

`openjubensha/1` 尚未正式发布，在发布前仍可能调整。发布后：新增可选字段不改变版本号；改变已有字段语义或新增必填字段时升级为 `openjubensha/2`。实现遇到不认识的 `format` **必须**拒绝。
