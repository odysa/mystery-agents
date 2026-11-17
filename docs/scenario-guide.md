# 剧本编写指南

> 这是入门教程。正式规范见 [OpenMystery 开放剧本杀格式](openmystery.md)，JSON Schema 在 `schema/openmystery-1.schema.json`。写好后可以在网页「投稿剧本」里校验、试玩并发布。

剧本是 `scenarios/` 目录下的一个 JSON 文件，引擎不包含任何剧本相关的代码。把新文件放进去，重启服务器即可在大厅看到。

可以参考 `scenarios/yuye-yaohuo.json`。

## 顶层字段

| 字段 | 说明 |
|---|---|
| `id` | 只能包含字母、数字、`-`、`_`，与文件名一致 |
| `title` / `subtitle` / `background` / `intro` | 标题、一句话简介、背景故事、主持人开场白 |
| `victim` | 死者 `{ id, name, bio }` |
| `locations` | 搜证地点 `{ id, name, description, x, y }`，至少 3 个；`x`、`y` 是地图上的相对位置（0–1）；第一个地点视为案发现场 |
| `characters` | 角色列表，数量必须等于 `players` |
| `relationships` | 角色间关系 `{ a, b, label, public }`；`public: false` 的关系在终局时揭晓 |
| `victimRelationships` | 各角色与死者的关系 |
| `clues` | 线索卡 |
| `contradictions` | 预埋矛盾（可选，用于 AI 推理与评测） |
| `truth` | 真相：`murderer`、`summary`、`timeline`、`secrets` |
| `config.rounds` | 每轮的搜证次数与讨论次数，如 `[{ "investigate": 2, "discuss": 2 }, ...]` |
| `phaseNarration` | 各阶段的主持人台词，键为 `investigate_1`、`discuss_1`、…、`vote` |

## 角色

```json
{
  "id": "lu_yuan",
  "name": "陆远",
  "color": "#5b7fbf",
  "publicBio": "所有人都能看到的简介",
  "personality": "性格（给 AI 的表演提示）",
  "script": "只有该角色能看到的完整剧本",
  "isMurderer": true,
  "coverStory": "被质询时的标准说法",
  "knowledge": [
    { "id": "k_lu_cover", "text": "我整晚都在窑房烧窑。", "time": "21:00-23:00", "implicates": {}, "secret": false, "lie": true }
  ],
  "objectives": [
    { "type": "escape", "desc": "不被投票指认为凶手" },
    { "type": "clue_not_public", "clue": "c_kilnlog", "desc": "不让窑温记录被公开" }
  ],
  "ruleHints": { "preferredLocations": ["kiln", "studio"] }
}
```

- `knowledge`：角色记得的事。`secret: true` 表示不愿主动说出，`lie: true` 表示谎言。规则型 AI 会用这些条目发言。
- `objectives.type` 可选值：`find_murderer`（投票正确）、`escape`（凶手不被指认）、`clue_public`、`clue_not_public`（某条线索终局时是否已公开）、`not_most_voted`。所有任务都由引擎自动判定。

## 线索

```json
{ "id": "c_ashpit", "location": "kiln", "title": "冷窑灰坑里的镇纸", "text": "……", "time": "", "implicates": { "lu_yuan": 4 }, "requires": ["c_kilnlog"], "key": true }
```

- `implicates`：作者标注，表示这条线索指向谁、权重多少（可以为负，表示有利于洗清嫌疑）。**玩家和大模型永远看不到这个字段。**
- `requires`：前置线索。只有当搜证者自己持有这些线索，或它们已被公开时，才可能搜到这条线索。
- `key`：标记为关键线索，用于评测「关键线索公开数」。
- `time`：带时间的线索会自动出现在可视化时间线上。

## 校验

```bash
npm run validate
```

校验内容包括：

- 结构完整性，以及所有 id 引用是否有效
- 恰好一名凶手
- 线索的前置依赖没有成环
- 总搜证次数足够
- **可解性**：把所有线索和非凶手角色的非秘密证词加起来，指向凶手的权重必须严格高于指向其他任何人的权重

写好剧本后，可以运行 `npm run sim -- --scenario-file 你的剧本.json --games 50`，看看规则型 AI 的破案率和各角色的任务完成率，以此检查难度和平衡性。

## 怎样写得不那么容易

《雨夜窑火》是刻意写得很直白的入门剧本：16 条线索里 10 条指向凶手，AI 试玩的侦探胜率是 100%。想写进阶或困难剧本，可以参考其他内置剧本：

- 指向凶手的线索权重控制在全部正权重的 40% 以内，单条线索对凶手的权重不超过 3。
- 至少两个强干扰嫌疑人：他们有动机、有秘密、也在撒谎。
- 让凶手嫁祸某人（伪造的证据指向被嫁祸者），再埋一条要和其他线索合起来才能看穿嫁祸的线索。
- 用 `requires` 把关键证据藏在推理链后面。
- 用「时间对不上」做核心诡计：伪造时间、录音录像冒充在场、篡改记录。

校验与投稿页会给出「难度体检」，把这些指标算出来。
