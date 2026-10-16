// Зеркало обновлений: раз в 3 минуты смотрит последний релиз на GitHub и докачивает его файлы к себе.
// Новый релиз виден клиентам сразу (со ссылками на GitHub), а файлы подменяются на наши по мере докачки.
// Клиенты сначала спрашивают сервер (быстро из РФ), а если он недоступен — GitHub напрямую.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SAFE = /^[A-Za-z0-9._-]+$/;

export class ReleaseMirror {
  constructor({ repo, dir, publicUrl, fetch = globalThis.fetch, log = console.log }) {
    this.repo = repo;
    this.dir = dir;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.fetch = fetch;
    this.log = log;
    this.release = null; // ответ GitHub, как есть
    this.ready = new Set(); // «tag/name» — что уже лежит на диске целиком
    this.busy = false;
  }

  /** Тот же формат, что у GitHub releases/latest, но ссылки на скачанные файлы — на наш сервер */
  latest() {
    if (!this.release) return null;
    const r = this.release;
    return {
      tag_name: r.tag_name,
      name: r.name,
      body: r.body,
      html_url: r.html_url,
      published_at: r.published_at,
      mirrored: r.assets.every((a) => this.ready.has(`${r.tag_name}/${a.name}`)),
      assets: r.assets.map((a) => ({
        name: a.name,
        size: a.size,
        browser_download_url: this.ready.has(`${r.tag_name}/${a.name}`) ? `${this.publicUrl}/dl/${r.tag_name}/${a.name}` : a.browser_download_url,
        github_url: a.browser_download_url
      }))
    };
  }

  /** Путь к файлу на диске для /dl/:tag/:name или null */
  file(tag, name) {
    if (!SAFE.test(tag) || !SAFE.test(name) || !this.ready.has(`${tag}/${name}`)) return null;
    return path.join(this.dir, tag, name);
  }

  /** Узнать последний релиз (лёгкий запрос) — работает даже во время докачки прошлого */
  async refresh() {
    const res = await this.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoMusic-Server' }
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const rel = await res.json();
    if (!SAFE.test(rel.tag_name || '')) throw new Error('странный тег релиза');
    rel.assets = (rel.assets || []).filter((a) => SAFE.test(a.name));
    // в релиз могли попасть файлы чужой сборки (например, 0.5.30 в v0.6.31) — отдаём только свои
    const ver = /^v?(\d+\.\d+)\.(\d+)$/.exec(rel.tag_name);
    if (ver) {
      const own = rel.assets.filter((a) => a.name.includes(`${ver[1]}.${ver[2]}`) || a.name.includes(`${ver[1]}-${ver[2]}`));
      if (own.length) rel.assets = own;
    }
    this.release = rel;
    return rel;
  }

  async sync() {
    let rel;
    try {
      rel = await this.refresh();
    } catch (e) {
      this.log(`[mirror] ${e.message}`);
      return;
    }
    if (this.busy) return; // файлы прошлого раза ещё качаются — новый релиз уже виден, докачаем следом
    this.busy = true;
    try {
      const tagDir = path.join(this.dir, rel.tag_name);
      fs.mkdirSync(tagDir, { recursive: true });
      for (const a of rel.assets) {
        const key = `${rel.tag_name}/${a.name}`;
        const target = path.join(tagDir, a.name);
        if (fs.existsSync(target) && fs.statSync(target).size === a.size) {
          this.ready.add(key);
          continue;
        }
        const dl = await this.fetch(a.browser_download_url, { headers: { 'User-Agent': 'NyaoMusic-Server' }, redirect: 'follow' });
        if (!dl.ok || !dl.body) throw new Error(`скачивание ${a.name}: ${dl.status}`);
        const tmp = target + '.part';
        await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(tmp));
        fs.renameSync(tmp, target);
        this.ready.add(key);
        this.log(`[mirror] ${key} (${Math.round(a.size / 1e6)} МБ)`);
      }
      // старые релизы не храним — место на диске не резиновое
      for (const old of fs.readdirSync(this.dir)) {
        if (old !== rel.tag_name) fs.rmSync(path.join(this.dir, old), { recursive: true, force: true });
      }
      for (const k of [...this.ready]) if (!k.startsWith(rel.tag_name + '/')) this.ready.delete(k);
    } catch (e) {
      this.log(`[mirror] ${e.message}`);
    } finally {
      this.busy = false;
    }
  }
}
