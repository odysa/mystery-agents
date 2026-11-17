# 架构说明

## 设计原则

1. **规则归引擎，语言归模型。** 阶段推进、动作是否合法、搜到哪条线索、投票结果，全部由 `src/engine/game.js` 确定性地裁决。模型只能从「当前允许的动作」中选一个，并填写发言内容。
2. **信息隔离在服务器端完成。** `Game.observe(pid)` 是玩家与 AI 获取信息的唯一出口。观察中永远不包含真相、他人剧本或线索的作者标注（`implicates` / `requires`）。
3. **一切皆事件。** 状态只在 `applyEvent()` 中改变，因此 `Game.fromEvents()` 可以从日志完整重建任意一局，用于回放、断点续玩和离线评测。

## 事件

```js
{ seq, gameId, type, actor, data, vis, phase, round, ts }
```

`vis` 决定谁能看到这条事件：

| vis | 含义 | 例子 |
|---|---|---|
| `'public'` | 所有玩家与观众 | 发言、质询、公开线索、「某人搜查了窑房」 |
| `[pid]` | 仅该玩家 | `clue_found`（找到了什么）、`voted`（投给了谁） |
| `'system'` | 仅日志 / 上帝视角 | `agent_decision`（模型原始输出、想法、嫌疑度、耗时）、`action_rejected` |

主要事件类型：`game_started`、`narration`、`phase_changed`、`ready`、`clue_found`、`searched`、`spoke`、`questioned`、`responded`、`evidence_shared`、`accused`、`passed`、`voted`、`vote_cast`、`votes_revealed`、`game_ended`、`agent_decision`、`action_rejected`。

## 回合模型

引擎维护一个行动队列 `queue`：

- 开场：每人一个 `ready`
- 搜证：按座次，每人 N 个 `investigate`
- 讨论：按座次，每人 M 个 `discuss`；`QUESTION` 会把被质询者的 `respond` 插到队首（被质询者必须马上回答）
- 投票：每人一个 `vote`

队列清空时，引擎自动进入下一阶段。

## 动作

| 动作 | 字段 | 可用回合 |
|---|---|---|
| `READY` | — | ready |
| `INVESTIGATE` | `location` | investigate |
| `SPEAK` | `text` | discuss |
| `QUESTION` | `target`, `text` | discuss |
| `SHARE_EVIDENCE` | `clue_id`, `text?` | discuss |
| `ACCUSE` | `target`, `text` | discuss |
| `RESPOND` | `text`, `clue_id?` | respond |
| `PASS` | — | investigate / discuss |
| `VOTE` | `target`, `text?` | vote |

非法动作会被拒绝，并记录一条仅系统可见的 `action_rejected` 事件，用于统计「规则违规率」。

## 视角

| 视角 | 获取方式 | 内容 |
|---|---|---|
| 玩家 | `?token=` | 自己的角色卡、自己的线索、公开信息、自己可见的事件。每个真人座位一个凭证；前端邀请链接 `#/join/<局>/<角色>/<凭证>` 会把凭证存入浏览器后进入对局，`meta.joined` 列出已打开过的真人座位 |
| 观众 | 默认（前端 `#/watch/<局>`） | 只有公开事件；`meta.watchers` 是当前非玩家的 SSE 连接数。暂停/调速需要创建时返回的 `hostToken` |
| 上帝 | `?view=god` | 全部信息。仅允许在**全 AI 对局**或**对局结束后**使用 |

## 智能体

- `RuleAgent`：离线基线。只使用自己的观察，加上自己掌握的线索的作者标注（相当于「读懂」了线索含义）；能通过剧本中的 `contradictions` 发现证词与线索的矛盾。凶手会隐藏对自己不利的线索、坚持不在场的谎言，并把矛头引向别人。
- `LLMAgent`（基线 A）：静态角色剧本 + 最近 80 条可见历史，每次决策调用一次模型，输出结构化 JSON。输出非法时，把错误反馈给模型重试一次；仍失败则退回 `RuleAgent`，并在日志中标记 `provider: "openai→rule"`。
- Provider：`ClaudeProvider`（官方 SDK、JSON Schema 结构化输出、服务端拒答后备）与 `OpenAICompatProvider`（`/chat/completions` + `response_format: json_object`）。

## 持久化

`data/games/<id>/meta.json` 保存座位、种子和玩家凭证；`events.jsonl` 追加写入事件。服务器启动时会恢复所有对局，并继续运行未结束的 AI 回合。

## 评测

`src/metrics.js` 从事件日志计算单局指标，`src/sim.js` 批量运行并汇总（含 95% 置信区间）。每次阶段切换时，`src/engine/audit.js` 都会审计所有玩家的观察，任何越权信息都会让模拟器以非零状态退出。
