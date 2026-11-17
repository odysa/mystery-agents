#!/usr/bin/env node
// AI 全自动对局模拟 + 评测报告。
// 用法:
//   node src/sim.js [--games 20] [--seed 1] [--scenario yuye-yaohuo|all] [--scenario-file 我的剧本.json]
//                   [--lang zh|en] [--agents rule|claude|openai|webhook] [--murderer-agent rule] [--webhook-url http://...] [--out report.json] [--quiet]
import { writeFileSync, readFileSync } from 'node:fs';
import { loadScenario, listScenarios, validateScenario, lintScenario } from './engine/scenario.js';
import { simulate } from './simulate.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const games = Number(args.games || 20);
const seed = Number(args.seed || 1);
const agents = args.agents || 'rule';
const murdererAgent = args['murderer-agent'] || agents;
const webhookUrl = args['webhook-url'];
const lang = args.lang === 'en' ? 'en' : 'zh';
if ([agents, murdererAgent].includes('webhook') && !webhookUrl) { console.error('--agents webhook 需要同时提供 --webhook-url'); process.exit(2); }

let scenarios;
if (args['scenario-file']) {
  const s = JSON.parse(readFileSync(args['scenario-file'], 'utf8'));
  const errors = validateScenario(s);
  if (errors.length) { console.error(`剧本校验失败:\n- ${errors.join('\n- ')}`); process.exit(1); }
  scenarios = [s];
} else if (args.scenario === 'all') {
  scenarios = listScenarios().map((x) => loadScenario(x.id));
} else {
  scenarios = [loadScenario(args.scenario || 'yuye-yaohuo')];
}

const reports = [];
let leaks = 0;
for (const sc of scenarios) {
  if (scenarios.length > 1) console.log(`\n===== 《${sc.title}》(${sc.id}) =====`);
  const name = (id) => sc.characters.find((c) => c.id === id)?.name || '平票';
  const { report, games: results } = await simulate(sc, {
    games, seed, agents, murdererAgent, webhookUrl, lang,
    onGame: (m, i, s) => {
      if (!args.quiet) process.stdout.write(`第 ${String(i + 1).padStart(3)} 局  seed=${s}  指认: ${name(m.convicted).padEnd(3, '　')}  ${m.goodWin ? '✔ 侦探方胜' : '✘ 凶手逃脱'}  公开线索 ${m.cluesPublic}\n`);
    },
  });
  report.lint = lintScenario(sc).stats;
  leaks += report.accessControlViolations;
  reports.push({ report, games: results });
  if (scenarios.length === 1) { console.log('\n===== 汇总 ====='); console.log(JSON.stringify(report, null, 2)); }
}
if (scenarios.length > 1) {
  console.log('\n===== 汇总 =====');
  console.log(['剧本', '人数', '完成率', '侦探胜率', '投票准确率', '违规率', '凶手权重占比'].join('\t'));
  for (const { report: r } of reports) {
    const sc = scenarios.find((s) => s.id === r.scenario);
    console.log([`《${sc.title}》`, sc.characters.length, r.completionRate.toFixed(2), r.goodTeamWinRate.toFixed(2), (r.detectiveVoteAccuracy ?? 0).toFixed(2), (r.ruleViolationRate ?? 0).toFixed(2), r.lint.murdererShare].join('\t'));
  }
}
if (args.out) writeFileSync(args.out, JSON.stringify(scenarios.length === 1 ? reports[0] : reports, null, 2));
if (leaks > 0) { console.error(`发现 ${leaks} 处访问控制问题！`); process.exit(1); }
