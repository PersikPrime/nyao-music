// Зеркало обновлений: раз в 3 минуты смотрит последний релиз на GitHub и докачивает его файлы к себе.
// Новый релиз виден клиентам сразу (со ссылками на GitHub), а файлы подменяются на наши по мере докачки.
// Клиенты сначала спрашивают сервер (быстро из РФ), а если он недоступен — GitHub напрямую.
// Каналы dev и nightly (пререлизы v0.8.89-dev): у них зеркалятся только маленькие файлы — пакеты горячих
// обновлений (.nui и подпись), установщики остаются ссылками на GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SAFE = /^[A-Za-z0-9._-]+$/;
export const CHANNELS = ['dev', 'nightly'];
const SMALL = 8 * 1024 * 1024;

/** Только файлы своей сборки — в релиз могли попасть чужие (например, 0.5.30 в v0.6.31) */
function ownAssets(rel) {
  const assets = (rel.assets || []).filter((a) => SAFE.test(a.name));
  const ver = /^v?(\d+\.\d+)\.(\d+)(?:-[a-z]+)?$/.exec(rel.tag_name);
  if (ver) {
    const own = assets.filter((a) => a.name.includes(`${ver[1]}.${ver[2]}`) || a.name.includes(`${ver[1]}-${ver[2]}`));
    if (own.length) return own;
  }
  return assets;
}

export class ReleaseMirror {
  constructor({ repo, dir, publicUrl, fetch = globalThis.fetch, log = console.log }) {
    this.repo = repo;
    this.dir = dir;
    this.publicUrl = publicUrl.replace(/\/$/, '');
    this.fetch = fetch;
    this.log = log;
    this.release = null; // ответ GitHub, как есть
    this.channels = {}; // dev / nightly → последний пререлиз канала
    this.ready = new Set(); // «tag/name» — что уже лежит на диске целиком
    this.busy = false;
  }

  /** Тот же формат, что у GitHub releases/latest, но ссылки на скачанные файлы — на наш сервер */
  latest(channel = null) {
    // канал получает свой пререлиз, но если обычный релиз уже новее — его (dev 89 → релиз 90)
    const build = (rel) => Number(/\.(\d+)(?:-[a-z]+)?$/.exec((rel && rel.tag_name) || '')?.[1] || 0);
    const ch = channel && this.channels[channel];
    const r = ch && (!this.release || build(ch) > build(this.release)) ? ch : this.release;
    if (!r) return null;
    return {
      tag_name: r.tag_name,
      name: r.name,
      body: r.body,
      html_url: r.html_url,
      published_at: r.published_at,
      prerelease: !!r.prerelease,
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
    rel.assets = ownAssets(rel);
    this.release = rel;
    return rel;
  }

  /** Последние пререлизы каналов (dev, nightly) из списка релизов */
  async refreshChannels() {
    const res = await this.fetch(`https://api.github.com/repos/${this.repo}/releases?per_page=30`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NyaoMusic-Server' }
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) return this.channels;
    const next = {};
    for (const ch of CHANNELS) {
      const rel = list
        .filter((r) => !r.draft && SAFE.test(r.tag_name || '') && r.tag_name.endsWith(`-${ch}`))
        .sort((a, b) => Number(/\.(\d+)-/.exec(b.tag_name)?.[1] || 0) - Number(/\.(\d+)-/.exec(a.tag_name)?.[1] || 0))[0];
      if (rel) next[ch] = { ...rel, assets: ownAssets(rel) };
    }
    this.channels = next;
    return next;
  }

  /** Скачать файл релиза к себе, если его ещё нет */
  async fetchAsset(tag, a) {
    const key = `${tag}/${a.name}`;
    const tagDir = path.join(this.dir, tag);
    fs.mkdirSync(tagDir, { recursive: true });
    const target = path.join(tagDir, a.name);
    // файл перезалили в тот же релиз (повторная сборка) — у него новый id; одного размера мало:
    // подпись пакета всегда 89 байт, и старая подпись осталась бы рядом с новым пакетом
    const stamp = `${target}.asset`;
    const stampOk = () => !a.id || (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === String(a.id));
    if (fs.existsSync(target) && fs.statSync(target).size === a.size && stampOk()) {
      this.ready.add(key);
      return;
    }
    this.ready.delete(key);
    const dl = await this.fetch(a.browser_download_url, { headers: { 'User-Agent': 'NyaoMusic-Server' }, redirect: 'follow' });
    if (!dl.ok || !dl.body) throw new Error(`скачивание ${a.name}: ${dl.status}`);
    const tmp = target + '.part';
    await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
    if (a.id) fs.writeFileSync(stamp, String(a.id));
    this.ready.add(key);
    this.log(`[mirror] ${key} (${Math.round(a.size / 1e6)} МБ)`);
  }

  async sync() {
    let rel;
    try {
      rel = await this.refresh();
    } catch (e) {
      this.log(`[mirror] ${e.message}`);
      return;
    }
    try {
      await this.refreshChannels();
    } catch (e) {
      this.log(`[mirror] каналы: ${e.message}`);
    }
    if (this.busy) return; // файлы прошлого раза ещё качаются — новый релиз уже виден, докачаем следом
    this.busy = true;
    try {
      for (const a of rel.assets) await this.fetchAsset(rel.tag_name, a);
      // каналы — только маленькие файлы (пакеты горячих обновлений)
      for (const ch of Object.values(this.channels)) {
        for (const a of ch.assets) {
          if (a.size > SMALL) continue;
          try {
            await this.fetchAsset(ch.tag_name, a);
          } catch (e) {
            this.log(`[mirror] ${e.message}`);
          }
        }
      }
      // старые релизы не храним — место на диске не резиновое
      const keep = new Set([rel.tag_name, ...Object.values(this.channels).map((c) => c.tag_name)]);
      for (const old of fs.readdirSync(this.dir)) {
        if (!keep.has(old)) fs.rmSync(path.join(this.dir, old), { recursive: true, force: true });
      }
      for (const k of [...this.ready]) if (!keep.has(k.split('/')[0])) this.ready.delete(k);
    } catch (e) {
      this.log(`[mirror] ${e.message}`);
    } finally {
      this.busy = false;
    }
  }
}
