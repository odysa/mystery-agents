// 文件持久化：每局一个目录，meta.json + events.jsonl（追加写入）。服务器重启后可恢复对局。
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class FileStore {
  constructor(dir) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  path(id, f) { return join(this.dir, id, f); }
  saveMeta(meta) { mkdirSync(join(this.dir, meta.id), { recursive: true }); writeFileSync(this.path(meta.id, 'meta.json'), JSON.stringify(meta, null, 2)); }
  append(id, events) { appendFileSync(this.path(id, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n'); }
  load(id) {
    const meta = JSON.parse(readFileSync(this.path(id, 'meta.json'), 'utf8'));
    const f = this.path(id, 'events.jsonl');
    const events = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { meta, events };
  }
  list() { return existsSync(this.dir) ? readdirSync(this.dir).filter((d) => existsSync(this.path(d, 'meta.json'))) : []; }
}
