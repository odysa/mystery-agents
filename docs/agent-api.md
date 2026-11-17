# 智能体接入协议 openjubensha-agent/1

> 给 Agent 直接读的精简版说明由服务器生成：`/agent.md`（英文 `/agent.md?lang=en`）。服务器还提供 MCP 端点 `/mcp`，以及空位认领：`GET /api/open-seats`、`POST /api/games/<id>/join`。创建对局时传 `"lang": "en"` 即为英文对局；`/turn` 和 `/view` 加 `format=text` 返回纯文本观察。

任何语言写的智能体都能坐上剧本杀的座位：和真人同桌，和内置 AI 对局，或者在模拟器里批量评测。有两种接入方式：

| 方式 | 谁发起请求 | 适合 | 座位类型 |
|---|---|---|---|
| **拉取（HTTP）** | 你的智能体请求平台 | 任何环境，包括本地脚本、Notebook | `external` |
| **推送（Webhook）** | 平台请求你的服务 | 批量模拟、长期在线的智能体服务 | `webhook` |

两种方式拿到的**观察（observation）完全相同**，都是该角色有权看到的全部信息，不包含真相、他人剧本或线索的作者标注。

示例：[`examples/external_agent.py`](../examples/external_agent.py)（Python 标准库，拉取）、[`examples/webhook_agent.mjs`](../examples/webhook_agent.mjs)（Node，推送）。

## 1. 拉取方式

```bash
npm start
python3 examples/external_agent.py --scenario dabian-qianye            # 你的智能体演第一个角色
python3 examples/external_agent.py --scenario kunqu-houtai --seat all  # 所有角色都由你的智能体演
```

### 1.1 创建对局

```http
POST /api/games
{ "scenarioId": "dabian-qianye", "seats": { "tang_wei": "external", "xu_jiahe": "human" }, "speedMs": 0 }
```

`seats` 的值可以是 `human`（浏览器里的人）、`external`（你的智能体）、`rule`、`claude`、`openai`，或 `webhook`（见下文）。没列出的座位默认 `rule`。返回：

```json
{ "id": "g_xxx", "tokens": { "tang_wei": "…", "xu_jiahe": "…" }, "hostToken": "…" }
```

每个 `external` / `human` 座位一个 token。**token 就是该角色的身份**，只交给对应的玩家或智能体。

### 1.2 等待轮到自己

```http
GET /api/games/<id>/turn?token=<token>&timeout=30
```

长轮询：轮到该角色行动、对局结束，或超时（最长 60 秒）时返回。返回体是观察，外加 `yourTurn: true/false`。

也可以用 `GET /api/games/<id>/view?token=` 立即取观察，或用 `GET /api/games/<id>/stream?token=` 订阅 SSE。

### 1.3 提交动作

```http
POST /api/games/<id>/action
{ "token": "<token>", "action": { "type": "SPEAK", "text": "……" } }
```

成功返回 200。非法动作返回 400 和原因（例如「现在不是你的回合」），并记入规则违规率。

## 2. 推送方式（Webhook）

每次轮到该角色，平台向你的 URL 发送：

```http
POST <你的 URL>
{
  "protocol": "openjubensha-agent/1",
  "pid": "tang_wei",
  "gameId": "g_xxx",
  "allowed": ["SPEAK", "QUESTION", "SHARE_EVIDENCE", "ACCUSE", "PASS"],
  "observation": { …与拉取方式相同… },
  "retry": { "previousAction": {…}, "error": "原因" }   // 仅在上一次动作非法时出现
}
```

你返回：

```json
{ "action": { "type": "QUESTION", "target": "zhou_zhi", "text": "21:33 你为什么上楼？" },
  "thought": "可选：内心想法，会出现在上帝视角和日志里",
  "suspicion": { "zhou_zhi": 0.6, "xu_jiahe": 0.3 } }
```

规则：

- 默认超时 60 秒（`MA_WEBHOOK_TIMEOUT_MS`）。
- 动作非法时平台会带着 `retry` 再问一次；仍然失败、超时或出错，则这一步由规则型 AI 代打，日志标记 `provider: "webhook→rule"`。
- 用模拟器批量评测：

```bash
node examples/webhook_agent.mjs 8787
npm run sim -- --agents webhook --webhook-url http://127.0.0.1:8787 --scenario all --games 20
npm run sim -- --agents rule --murderer-agent webhook --webhook-url http://127.0.0.1:8787   # 只让它演凶手
```

- 在网页服务器里使用 webhook 座位，需要用 `MA_ALLOW_WEBHOOK=1 npm start` 启动。服务器会主动请求你给的 URL，公开部署时存在 SSRF 风险，所以默认关闭。创建对局时传 `"webhooks": { "<角色id>": "<URL>" }`。

## 3. 观察（observation）

| 字段 | 说明 |
|---|---|
| `gameId` `phase` `round` `totalRounds` | `phase` 取值：`intro` `investigate` `discuss` `vote` `ended` |
| `turn` | `{ pid, kind }`，`kind` 取值：`ready` `investigate` `discuss` `respond` `vote` |
| `allowed` | 你现在可以做的动作类型；不是你的回合时为空数组 |
| `you` | 你的角色卡：`id` `name` `publicBio` `personality` `script` `coverStory` `isMurderer` `knowledge[]` `objectives[]` |
| `scenario` | 剧本的公开部分：背景、死者、地点、角色公开简介、公开关系、规则参数 |
| `locations` | `[{ id, name, remaining, total }]`，`remaining` 是该地点还没被任何人找到的线索数 |
| `myClues` | 你找到的线索 `[{ id, title, text, time, location, locationName, public }]` |
| `publicClues` | 已被公开的线索，带 `sharedBy` |
| `accusations` | 公开指控 `[{ from, to, seq }]` |
| `lastLocation` | 每个人最近一次搜证的地点 |
| `votesCast` | 已经投票的人（不含投给谁） |
| `turnOrder` | 座次 |
| `events` | 你可见的全部事件（发言、质询、回答、公开线索、搜证地点、你自己找到的线索……），按时间排序 |
| `result` | 对局结束后的结果：指认、票数、各角色任务完成情况、真相 |

## 4. 动作

| `type` | 字段 | 可用回合 |
|---|---|---|
| `READY` | — | ready |
| `INVESTIGATE` | `location` | investigate |
| `PASS` | — | investigate / discuss |
| `SPEAK` | `text` | discuss |
| `QUESTION` | `target`, `text` | discuss（被质询者马上进入 respond 回合） |
| `SHARE_EVIDENCE` | `clue_id`, `text?` | discuss（只能公开自己持有的线索） |
| `ACCUSE` | `target`, `text` | discuss |
| `RESPOND` | `text`, `clue_id?` | respond |
| `VOTE` | `target`, `text?` | vote（不能投自己） |

发言长度上限由剧本的 `config.maxSpeechChars` 决定（默认 300 字）。

## 5. 评测

`npm run sim` 会输出完成率、侦探方胜率、投票准确率、规则违规率、线索公开数、各角色任务完成率等指标及 95% 置信区间；每次阶段切换时还会审计所有角色的观察，发现越权信息即以非零状态退出。加 `--scenario all` 在全部剧本上跑一遍，`--out report.json` 保存逐局结果。
