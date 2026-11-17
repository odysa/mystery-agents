#!/usr/bin/env python3
"""
外部智能体示例（只用 Python 标准库）：通过 HTTP 加入一局剧本杀并自主行动。

协议：openjubensha-agent/1（见 docs/agent-api.md）
  1. POST /api/games 创建对局，把要接管的座位设为 "external"，拿到该座位的 token
  2. 循环 GET /api/games/<id>/turn?token=...&timeout=30  —— 长轮询，轮到你时返回你的观察
  3. POST /api/games/<id>/action {token, action} 提交动作
把 decide() 换成你自己的智能体（调用任何大模型、规划器都可以）。

用法：
  npm start                                   # 先启动服务器
  python3 examples/external_agent.py          # 新建一局：你的智能体扮演第一个角色，其余由规则型 AI 扮演
  python3 examples/external_agent.py --scenario dabian-qianye --seat all   # 所有座位都由本脚本扮演
"""
import argparse, json, random, urllib.request

def call(base, path, body=None, timeout=70):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": json.loads(e.read()).get("error", str(e)), "status": e.code}

def decide(obs):
    """一个最简单的智能体：只看自己的观察，选一个合法动作。换成你的模型即可。"""
    allowed, me = obs["allowed"], obs["you"]
    others = [c["id"] for c in obs["scenario"]["characters"] if c["id"] != me["id"]]
    if "READY" in allowed:
        return {"type": "READY"}
    if "INVESTIGATE" in allowed:
        spots = [l for l in obs["locations"] if l["remaining"] > 0] or obs["locations"]
        return {"type": "INVESTIGATE", "location": random.choice(spots)["id"]}
    if "RESPOND" in allowed:
        return {"type": "RESPOND", "text": me["coverStory"] or "我没什么好隐瞒的。"}
    if "VOTE" in allowed:
        # 投给被公开指控次数最多的人；如果自己是凶手，避开自己
        counts = {}
        for a in obs["accusations"]:
            counts[a["to"]] = counts.get(a["to"], 0) + 1
        ranked = sorted(others, key=lambda p: -counts.get(p, 0))
        return {"type": "VOTE", "target": ranked[0], "text": "综合大家的发言做出的判断。"}
    # 讨论：有没公开的线索就公开一条，否则发言
    unshared = [c for c in obs["myClues"] if not c["public"]]
    if unshared and not me["isMurderer"]:
        return {"type": "SHARE_EVIDENCE", "clue_id": unshared[0]["id"], "text": "我找到了这个，大家看看。"}
    return {"type": "SPEAK", "text": me["coverStory"] or "我还在整理线索。"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:3000")
    ap.add_argument("--scenario", default="yuye-yaohuo")
    ap.add_argument("--seat", default="first", help="first / all / 某个角色 id")
    ap.add_argument("--others", default="rule", help="其余座位由谁扮演：rule / claude / openai")
    a = ap.parse_args()

    sc = call(a.base, f"/api/scenarios/{a.scenario}")
    chars = [c["id"] for c in sc["characters"]]
    mine = chars if a.seat == "all" else [chars[0] if a.seat == "first" else a.seat]
    seats = {pid: ("external" if pid in mine else a.others) for pid in chars}
    g = call(a.base, "/api/games", {"scenarioId": a.scenario, "seats": seats, "speedMs": 0})
    if "error" in g:
        raise SystemExit(g["error"])
    gid, tokens = g["id"], g["tokens"]
    print(f"对局 {gid} 已创建，观战：{a.base}/#/watch/{gid}")

    pending = set(mine)
    while pending:
        for pid in list(pending):
            obs = call(a.base, f"/api/games/{gid}/turn?token={tokens[pid]}&timeout={2 if len(mine) > 1 else 30}")
            if obs.get("phase") == "ended":
                pending.discard(pid)
                continue
            if not obs.get("yourTurn"):
                continue
            action = decide(obs)
            r = call(a.base, f"/api/games/{gid}/action", {"token": tokens[pid], "action": action})
            print(f"{obs['you']['name']}: {action['type']}" + (f"  ✗ {r['error']}" if "error" in r else ""))
    res = call(a.base, f"/api/games/{gid}/view?token={tokens[mine[0]]}")["result"]
    print("结果：", "侦探方胜" if res["goodWin"] else "凶手逃脱", "，被指认：", res["convicted"])

if __name__ == "__main__":
    main()
