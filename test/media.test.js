import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateScenario, localizeScenario } from '../src/engine/scenario.js';
import { canSeeAsset } from '../src/engine/media.js';
import { buildPrompt } from '../src/agents/llm.js';
import { Game } from '../src/engine/game.js';
import { createApp } from '../src/server.js';

// 1×1 PNG 与一个最小 WAV
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const WAV = (() => {
  const n = 2205; const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), 44 + i * 2);
  return `data:audio/wav;base64,${b.toString('base64')}`;
})();

function mediaScenario(id = 'media-case') {
  const s = JSON.parse(readFileSync(new URL('../scenarios/yuye-yaohuo.json', import.meta.url), 'utf8'));
  // 去掉内置剧本自带的媒体，换成测试用的内嵌媒体
  delete s.assets; delete s.cover; delete s.victim.portrait;
  for (const c of s.characters) { delete c.portrait; delete c.media; }
  for (const l of s.locations) delete l.image;
  for (const c of s.clues) delete c.media;
  for (const t of Object.values(s.translations || {})) { delete t.assets; for (const c of Object.values(t.characters || {})) delete c.voice; }
  s.id = id;
  s.assets = {
    cover: { type: 'image', src: PNG, alt: '封面' },
    p_lu: { type: 'image', src: PNG, alt: '陆远头像' },
    clue_img: { type: 'image', src: PNG, alt: '方形青铜镇纸，棱角有血迹' },
    secret_audio: { type: 'audio', src: WAV, alt: '陆远的私人录音', transcript: '一段嗡嗡声' },
    orphan: { type: 'image', src: PNG, alt: '没被引用的图' },
  };
  s.cover = 'cover';
  s.characters.find((c) => c.id === 'lu_yuan').portrait = 'p_lu';
  s.characters.find((c) => c.id === 'lu_yuan').media = ['secret_audio'];
  s.characters.find((c) => c.id === 'lu_yuan').voice = { gender: 'male', age: 'young', pitch: 0.9, rate: 1, style: '低沉' };
  s.clues.find((c) => c.id === 'c_ashpit').media = ['clue_img'];
  s.translations.en.assets = { clue_img: { alt: 'A square bronze paperweight with blood on its edge' } };
  return s;
}

test('媒体格式：校验通过；坏引用、坏类型、缺 alt 会报错', () => {
  assert.deepEqual(validateScenario(mediaScenario()), []);
  const bad = mediaScenario();
  bad.cover = 'secret_audio';
  bad.clues[0].media = ['nope'];
  bad.assets.x = { type: 'image', src: 'media/../../etc/passwd.png', alt: 'x' };
  bad.assets.y = { type: 'audio', src: 'data:text/html;base64,PHNjcmlwdD4=', alt: 'y' };
  bad.assets.z = { type: 'image', src: PNG };
  bad.characters[0].voice = { gender: 'robot', pitch: 9 };
  const errs = validateScenario(bad).join('\n');
  for (const k of ['cover 引用', 'clues[0].media[0]', 'assets.x.src', 'assets.y.src', 'assets.z.alt', 'voice.gender', 'voice.pitch']) assert.ok(errs.includes(k), `应报错：${k}\n${errs}`);
  const en = localizeScenario(mediaScenario(), 'en');
  assert.equal(en.assets.clue_img.alt, 'A square bronze paperweight with blood on its edge');
});

test('媒体可见性：公开 / 线索 / 角色私密 / 无引用', () => {
  const s = mediaScenario();
  const g = new Game(s, { seed: 1 });
  const st = g.state;
  const P = (pid) => ({ kind: 'player', pid });
  assert.ok(canSeeAsset(s, 'cover', { kind: 'spectator' }, st));
  assert.ok(!canSeeAsset(s, 'clue_img', P('shen_qing'), st), '没找到线索前看不到线索图');
  assert.ok(!canSeeAsset(s, 'clue_img', { kind: 'spectator' }, st));
  st.clueOwner.c_ashpit = 'shen_qing';
  assert.ok(canSeeAsset(s, 'clue_img', P('shen_qing'), st), '找到后能看到');
  assert.ok(!canSeeAsset(s, 'clue_img', P('zhou_man'), st), '别人还看不到');
  st.publicClues.c_ashpit = 'shen_qing';
  assert.ok(canSeeAsset(s, 'clue_img', P('zhou_man'), st), '公开后所有人可见');
  assert.ok(canSeeAsset(s, 'clue_img', { kind: 'spectator' }, st));
  assert.ok(canSeeAsset(s, 'secret_audio', P('lu_yuan'), st));
  assert.ok(!canSeeAsset(s, 'secret_audio', P('shen_qing'), st), '角色私密媒体只有本人可见');
  assert.ok(!canSeeAsset(s, 'orphan', { kind: 'god' }, st), '没有被引用的媒体谁都看不到');
});

test('大模型提示里带上媒体的文字描述', () => {
  const s = mediaScenario();
  const g = new Game(s, { seed: 1 });
  g.start();
  g.state.clueOwner.c_ashpit = 'lu_yuan';
  while (g.currentActor() !== 'lu_yuan') g.submit(g.currentActor(), { type: 'READY' });
  const { user, system } = buildPrompt(g.observe('lu_yuan'), { assets: s.assets });
  assert.ok(user.includes('［图片：方形青铜镇纸，棱角有血迹］'));
  assert.ok(system.includes('陆远的私人录音'));
});

async function withServer(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ma-media-'));
  const { server } = createApp({ dataDir: join(root, 'games'), scenarioDir: join(root, 'scenarios') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body) => {
    const res = await fetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  try { await fn(call, base, root); } finally { server.close(); rmSync(root, { recursive: true, force: true }); }
}

test('服务器：投稿提取媒体文件；按观察者控制媒体访问；SVG 脚本被拒绝', async () => {
  await withServer(async (call, base, root) => {
    const evil = mediaScenario('evil-svg');
    evil.assets.cover.src = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64')}`;
    const bad = await call('/api/scenarios', { scenario: evil, games: 2 });
    assert.equal(bad.status, 422);
    assert.ok(bad.body.errors.some((e) => e.includes('SVG')));

    const pub = await call('/api/scenarios', { scenario: mediaScenario(), games: 2 });
    assert.equal(pub.status, 201, JSON.stringify(pub.body.errors));
    assert.ok(existsSync(join(root, 'scenarios', 'media-case', 'media', 'clue_img.png')), '内嵌媒体被提取成文件');
    const saved = JSON.parse(readFileSync(join(root, 'scenarios', 'media-case.json'), 'utf8'));
    assert.equal(saved.assets.secret_audio.src, 'media/secret_audio.wav');

    const view = (await call('/api/scenarios/media-case')).body;
    assert.ok(view.media.cover && view.media.p_lu, '公开媒体在剧本公开信息里');
    assert.ok(!view.media.clue_img && !view.media.secret_audio && !view.media.orphan, '私密媒体不在公开信息里');
    const cover = await call(view.media.cover.url);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get('content-type'), 'image/png');
    assert.ok(cover.headers.get('content-security-policy').includes('sandbox'));
    assert.equal((await call('/media/media-case/clue_img')).status, 404, '线索图不能走公开路由');

    const g = await call('/api/games', { scenarioId: 'media-case', seats: { lu_yuan: 'human', shen_qing: 'human' }, speedMs: 0 });
    const { id, tokens } = g.body;
    const lu = (await call(`/api/games/${id}/view?token=${tokens.lu_yuan}`)).body;
    assert.ok(lu.media.secret_audio, '本人能看到私密媒体');
    assert.ok(lu.you.media.includes('secret_audio'));
    const audio = await call(lu.media.secret_audio.url);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get('content-type'), 'audio/wav');
    const ranged = await fetch(base + lu.media.secret_audio.url, { headers: { range: 'bytes=0-9' } });
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 10);
    const qing = (await call(`/api/games/${id}/view?token=${tokens.shen_qing}`)).body;
    assert.ok(!qing.media.secret_audio, '别人看不到');
    assert.equal((await call(`/api/games/${id}/media/secret_audio?token=${tokens.shen_qing}`)).status, 404, '拿别人的 URL 换自己的 token 也取不到');
    assert.equal((await call(`/api/games/${id}/media/secret_audio`)).status, 404, '观众取不到');
    assert.equal((await call(`/api/games/${id}/media/clue_img?token=${tokens.lu_yuan}`)).status, 404, '线索没找到前取不到');
    assert.equal((await call(`/api/games/${id}/media/secret_audio?view=god`)).status, 403, '有真人时禁止上帝视角');
  });
});
