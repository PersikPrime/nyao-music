// VK Музыка (dev-ветка): внутренние запросы сайта vk.com (al_audio.php) от имени сессии,
// в которую пользователь вошёл в обычном окне VK. Пароль к нам не попадает — только cookie этой сессии.
//
// Официального API у VK Музыки нет, поэтому всё здесь — по тому, как работает веб-версия vk.com/audio:
// • трек — массив из полей (id, owner_id, url, title, performer, duration, …, hashes, cover, …);
// • ссылка на звук приходит пустой — её даёт act=reload_audio по «полному id» с хешами;
// • ссылка «замаскирована» (audio_api_unavailable) — снимаем маску тем же алгоритмом, что yt-dlp;
// • звук — HLS (.m3u8), куски иногда зашифрованы AES-128 (это расшифровывает stream.js).
// VK время от времени всё это меняет — тогда смотрим vk-debug.log.

const BASE = 'https://vk.com';
const B64 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=';

/** Индексы полей трека в массиве VK (AUDIO_ITEM_INDEX_* из скриптов vk.com) */
const I = { id: 0, owner: 1, url: 2, title: 3, performer: 4, duration: 5, hashes: 13, cover: 14 };

export function vkDecode(enc) {
  let dec = '';
  let e = 0;
  let n = 0;
  for (const c of enc) {
    const r = B64.indexOf(c);
    if (r < 0) continue;
    const cond = n % 4;
    e = cond ? 64 * e + r : r;
    n++;
    if (cond) dec += String.fromCharCode(255 & (e >> ((-2 * n) & 6)));
  }
  return dec;
}

/** Снимает маску со ссылки (перенос _unmask_url из yt-dlp). uid — id вошедшего пользователя */
export function unmaskUrl(maskUrl, uid) {
  if (!maskUrl || !maskUrl.includes('audio_api_unavailable')) return maskUrl;
  const extra = maskUrl.split('?extra=')[1].split('#');
  const parts = vkDecode(extra[1]).split(String.fromCharCode(11));
  const base = parts[1];
  const chars = vkDecode(extra[0]).split('');
  const len = chars.length;
  const indexes = new Array(len);
  let index = Number(base) ^ uid;
  for (let n = len - 1; n >= 0; n--) {
    // в Python: (url_len * (n + 1) ^ index + n) % url_len — «^» слабее «+»
    index = (((len * (n + 1)) ^ (index + n)) % len + len) % len;
    indexes[n] = index;
  }
  for (let n = 1; n < len; n++) {
    const c = chars[n];
    const j = indexes[len - 1 - n];
    chars[n] = chars[j];
    chars[j] = c;
  }
  return chars.join('');
}

const unescapeHtml = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '');

export function isAudioItem(a) {
  return Array.isArray(a) && a.length > I.hashes && /^-?\d+$/.test(String(a[I.id])) && /^-?\d+$/.test(String(a[I.owner])) && typeof a[I.title] === 'string' && typeof a[I.performer] === 'string';
}

export function mapAudio(a) {
  const owner = String(a[I.owner]);
  const id = String(a[I.id]);
  const covers = String(a[I.cover] || '').split(',').filter((u) => /^https?:/.test(u));
  return {
    id: `vk:${owner}_${id}`,
    source: 'vk',
    srcId: `${owner}_${id}`,
    albumId: null,
    albumRef: null,
    artistRef: null,
    title: unescapeHtml(a[I.title]) || 'Без названия',
    artist: unescapeHtml(a[I.performer]) || 'VK',
    album: '',
    duration: Number(a[I.duration]) || 0,
    cover: covers.length ? covers[covers.length - 1] : null,
    available: true
  };
}

/** Достаёт все треки из ответа VK, где бы они ни лежали: массивы, вложенные объекты, HTML с data-audio="…" */
export function collectAudios(node, out = [], depth = 0) {
  if (depth > 12 || node == null) return out;
  if (isAudioItem(node)) {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const x of node) collectAudios(x, out, depth + 1);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) collectAudios(v, out, depth + 1);
  } else if (typeof node === 'string' && node.includes('data-audio=')) {
    for (const m of node.matchAll(/data-audio="([^"]+)"/g)) {
      try {
        collectAudios(JSON.parse(unescapeHtml(m[1])), out, depth + 1);
      } catch {
        // не JSON — пропускаем
      }
    }
  }
  return out;
}

/** Объект плейлиста в ответе load_section: { list: [...], hasMore, nextOffset } */
function findPlaylist(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (!Array.isArray(node) && Array.isArray(node.list)) return node;
  for (const v of Object.values(node)) {
    const r = findPlaylist(v, depth + 1);
    if (r) return r;
  }
  return null;
}

export class VKProvider {
  /**
   * fetch — запросы через сессию окна входа VK (cookie); getUserId — async () => id или null;
   * debug — запись сырых ответов в vk-debug.log, чтобы чинить, когда VK что-то поменяет
   */
  constructor({ fetch, getUserId, getBase = () => BASE, debug = () => {} }) {
    this.fetch = fetch;
    this.getUserId = getUserId;
    this.getBase = getBase;
    this.debug = debug;
    this.uid = null;
    this.account = null;
    this.raw = new Map(); // srcId → исходный массив трека (нужны хеши для ссылки и лайка)
  }

  get loggedIn() {
    return !!this.uid;
  }

  async refresh() {
    this.uid = await this.getUserId().catch(() => null);
    if (!this.uid) this.account = null;
    return this.uid;
  }

  setLoggedOut() {
    this.uid = null;
    this.account = null;
  }

  async post(act, params = {}) {
    if (!this.uid) await this.refresh();
    if (!this.uid) throw new Error('Нужен вход во VK');
    const body = new URLSearchParams({ al: '1', act, ...params });
    const base = this.getBase() || BASE;
    const res = await this.fetch(`${base}/al_audio.php?act=${encodeURIComponent(act)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: base,
        Referer: `${base}/audios${this.uid}`
      },
      body: body.toString()
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text.replace(/^\s*<!--/, ''));
    } catch {
      this.debug(`${act} ${JSON.stringify(params)} → HTTP ${res.status}, не JSON:\n${text.slice(0, 2000)}`);
      throw new Error(`VK ответил не тем, что ждали (HTTP ${res.status}) — подробности в vk-debug.log`);
    }
    const payload = json && json.payload;
    if (!Array.isArray(payload)) {
      this.debug(`${act} → нет payload:\n${text.slice(0, 2000)}`);
      throw new Error('VK изменил формат ответа — подробности в vk-debug.log');
    }
    const code = String(payload[0]);
    if (code === '3') {
      this.setLoggedOut();
      throw new Error('Сессия VK закончилась — войди заново');
    }
    if (code === '8') throw new Error('VK: ' + unescapeHtml(String((payload[1] && payload[1][0]) || 'ошибка')).replace(/^"|"$/g, ''));
    return payload[1];
  }

  remember(list) {
    const seen = new Set();
    const out = [];
    for (const a of list) {
      const t = mapAudio(a);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      this.raw.set(t.srcId, a);
      out.push(t);
    }
    return out;
  }

  async getAccount() {
    if (this.account) return this.account;
    if (!this.uid) await this.refresh();
    if (!this.uid) throw new Error('Нужен вход во VK');
    this.account = { uid: this.uid, name: `VK id${this.uid}` };
    return this.account;
  }

  /** «Моя музыка» */
  async likedTracks(limit = 500) {
    if (!this.uid) await this.refresh();
    const out = [];
    let offset = 0;
    for (let page = 0; page < 10 && out.length < limit; page++) {
      const data = await this.post('load_section', { owner_id: this.uid, playlist_id: -1, offset, type: 'playlist', access_hash: '', is_loading_all: 1 });
      const pl = findPlaylist(data);
      const items = collectAudios(pl ? pl.list : data);
      if (!items.length) {
        if (page === 0) this.debug(`load_section: треков не нашлось:\n${JSON.stringify(data).slice(0, 3000)}`);
        break;
      }
      out.push(...items);
      if (!pl || !pl.hasMore) break;
      offset = Number(pl.nextOffset) || offset + items.length;
    }
    return this.remember(out.slice(0, limit));
  }

  async section(name, extra = {}) {
    const data = await this.post('section', { section: name, claim: 0, is_layer: 0, ...extra });
    const items = collectAudios(data);
    if (!items.length) this.debug(`section ${name} ${JSON.stringify(extra)}: треков не нашлось:\n${JSON.stringify(data).slice(0, 3000)}`);
    return this.remember(items);
  }

  search(q) {
    return this.section('search', { q });
  }

  recommendations() {
    return this.section('recoms');
  }

  hashes(srcId) {
    const a = this.raw.get(String(srcId));
    return a ? String(a[I.hashes] || '').split('/') : [];
  }

  async like(track, on = true) {
    const [owner, id] = String(track.srcId).split('_');
    const h = this.hashes(track.srcId);
    if (on) {
      if (!h[0]) throw new Error('VK не дал ключ для лайка этого трека');
      await this.post('add', { group_id: 0, audio_owner_id: owner, audio_id: id, hash: h[0], from: 'search' });
    } else {
      if (!h[3]) throw new Error('VK не дал ключ для удаления этого трека');
      await this.post('delete_audio', { oid: owner, aid: id, hash: h[3], restore: 1 });
    }
  }

  /** Пул для «Моей волны»: рекомендации VK + немного своих лайков (для «Любимого») */
  async wavePool({ diversity = 'favorite', exclude = new Set(), size = 20 } = {}) {
    const pool = new Map();
    try {
      for (const t of await this.recommendations()) if (!exclude.has(t.id)) pool.set(t.id, t);
    } catch (e) {
      this.debug(`wavePool recoms: ${e.message}`);
    }
    if (diversity !== 'discover') {
      try {
        const liked = (await this.likedTracks(200)).filter((t) => !exclude.has(t.id));
        for (const t of liked.sort(() => Math.random() - 0.5).slice(0, Math.ceil(size / 3))) pool.set(t.id, t);
      } catch {
        // без лайков — только рекомендации
      }
    }
    return [...pool.values()].sort(() => Math.random() - 0.5).slice(0, size);
  }

  /** Ссылка на звук: reload_audio по полному id → снять маску → HLS или прямой mp3 */
  async streamUrl(srcId) {
    if (!this.uid) await this.refresh();
    let a = this.raw.get(String(srcId));
    let url = a && a[I.url];
    if (!url) {
      const h = a ? String(a[I.hashes] || '').split('/') : [];
      const full = h.length > 5 ? `${srcId}_${h[2]}_${h[5]}` : String(srcId);
      const data = await this.post('reload_audio', { ids: full });
      const found = collectAudios(data).find((x) => `${x[I.owner]}_${x[I.id]}` === String(srcId)) || collectAudios(data)[0];
      if (!found || !found[I.url]) {
        this.debug(`reload_audio ${full}: ссылки нет:\n${JSON.stringify(data).slice(0, 2000)}`);
        throw new Error('VK не дал ссылку на трек (возможно, он недоступен в твоей стране или нужна подписка)');
      }
      a = found;
      this.raw.set(String(srcId), found);
      url = found[I.url];
    }
    const real = unmaskUrl(url, this.uid);
    const hls = /\.m3u8(\?|$)/.test(real);
    const base = this.getBase() || BASE;
    return { url: real, hls, mime: 'audio/mpeg', headers: { Referer: `${base}/`, Origin: base }, ttl: 20 * 60_000 };
  }
}
