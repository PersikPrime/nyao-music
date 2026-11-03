// Картинки, которые в РФ без VPN часто не грузятся (аватарки Telegram, обложки YouTube и SoundCloud, CDN VK):
// приложение берёт их отсюда — /img?u=<адрес>. Сервер забирает картинку через ретранслятор (Cloudflare Worker,
// маршрут /img) или напрямую и кэширует на диске. Пропускаем только картинки и только с известных хостов.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const IMG_HOSTS = /(^|\.)(t\.me|telegram\.org|telesco\.pe|cdn-telegram\.org|ytimg\.com|ggpht\.com|googleusercontent\.com|sndcdn\.com|userapi\.com|vk\.me|vkuser\.net|vk-cdn\.net|scdn\.co|spotifycdn\.com|mzstatic\.com)$/i;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 4000;
const TTL = 7 * 86_400_000;

/** Можно ли проксировать этот адрес */
export function proxyable(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' && IMG_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

/** Адрес картинки через наш сервер (для аватарок Telegram — сразу, они почти всегда режутся) */
export function proxied(publicUrl, u) {
  if (!u || !publicUrl || !proxyable(u)) return u || null;
  return `${publicUrl}/img?u=${encodeURIComponent(u)}`;
}

export function imageProxy({ dataDir = '/data', relay = '', fetch = globalThis.fetch, log = () => {} } = {}) {
  const dir = path.join(dataDir, 'imgcache');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* нет прав — будем отдавать без кэша */ }
  const inflight = new Map();
  const failed = new Map(); // адрес → когда не получилось: 10 минут не пробуем снова, сразу отдаём «не вышло»
  let writes = 0;

  const keyOf = (u) => crypto.createHash('sha1').update(u).digest('hex');

  function readCache(key) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, key + '.json'), 'utf8'));
      if (Date.now() - meta.at > TTL) return null;
      return { type: meta.type, body: fs.readFileSync(path.join(dir, key)) };
    } catch {
      return null;
    }
  }

  function writeCache(key, type, body) {
    try {
      fs.writeFileSync(path.join(dir, key), body);
      fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify({ type, at: Date.now() }));
      if (++writes % 200 === 0) prune();
    } catch { /* диск полон или нет прав — не страшно */ }
  }

  /** Самые старые файлы — вон, когда их стало слишком много */
  function prune() {
    try {
      const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.json'));
      if (files.length <= MAX_FILES) return;
      const aged = files.map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
      for (const { f } of aged.slice(0, files.length - MAX_FILES)) {
        fs.rmSync(path.join(dir, f), { force: true });
        fs.rmSync(path.join(dir, f + '.json'), { force: true });
      }
    } catch { /* пустяк */ }
  }

  async function grab(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'image/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = String(res.headers.get('content-type') || '');
    if (!type.startsWith('image/')) throw new Error('не картинка');
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) throw new Error('слишком большая');
    return { type, body };
  }

  async function load(u) {
    const tries = [];
    if (relay) tries.push(`${relay.replace(/\/$/, '')}/img?u=${encodeURIComponent(u)}`);
    tries.push(u);
    let last;
    for (const t of tries) {
      try {
        return await grab(t);
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error('не получилось');
  }

  /** → { type, body } или null */
  return async function get(u) {
    if (!proxyable(u)) return null;
    const key = keyOf(u);
    const cached = readCache(key);
    if (cached) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const f = failed.get(key);
    if (f && Date.now() - f < 10 * 60_000) return null;
    const p = load(u)
      .then((r) => { writeCache(key, r.type, r.body); return r; })
      .catch((e) => {
        log(`[img] ${new URL(u).hostname}: ${e.message}`);
        failed.set(key, Date.now());
        if (failed.size > 5000) failed.clear();
        return null;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}
