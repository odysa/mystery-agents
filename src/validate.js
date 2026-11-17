#!/usr/bin/env node
// 校验 scenarios/ 下所有剧本的结构、可解性与翻译覆盖率。
// 用法: node src/validate.js [剧本id…] [--missing]   （--missing 列出缺失的翻译字段）
import { readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { SCENARIO_DIR, loadScenario, translationCoverage, LANGS, baseLang, lintScenario } from './engine/scenario.js';
import { checkMediaFiles } from './engine/media.js';
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const showMissing = args.includes('--missing');
let bad = 0;
for (const f of readdirSync(SCENARIO_DIR).filter((x) => x.endsWith('.json')).sort()) {
  const id = f.replace(/\.json$/, '');
  if (only.length && !only.includes(id)) continue;
  try {
    const s = loadScenario(id);
    const cov = LANGS.filter((l) => l !== baseLang(s)).map((l) => translationCoverage(s, l));
    const mediaErr = await checkMediaFiles(s, `${SCENARIO_DIR}/${id}`, { readFile, stat });
    if (mediaErr.length) throw new Error(`媒体文件问题:\n- ${mediaErr.join('\n- ')}`);
    const m = lintScenario(s).stats.media;
    console.log(`✔ ${f}  《${s.title}》 ${s.characters.length} 角色 / ${s.locations.length} 地点 / ${s.clues.length} 线索  翻译: ${cov.map((c) => `${c.lang} ${Math.round(c.ratio * 100)}%`).join(' ')}  媒体: 图 ${m.images} / 音 ${m.audio}${m.cover ? ' / 封面' : ''} / 头像 ${m.portraits} / 声音 ${m.voices}`);
    if (showMissing) for (const c of cov) if (c.missing.length) console.log(`   缺少 ${c.lang}: ${c.missing.join(', ')}`);
  } catch (e) { bad++; console.error(`✘ ${f}\n${e.message}`); }
}
process.exit(bad ? 1 : 0);
