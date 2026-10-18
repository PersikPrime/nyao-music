// VK Музыка (dev-ветка): внутренние запросы сайта vk.com (al_audio.php) от имени сессии,
// в которую пользователь вошёл в обычном окне VK. Пароль к нам не попадает — только cookie этой сессии.
//
// Официального API у VK Музыки нет, поэтому всё здесь — по тому, как работает веб-версия vk.com/audio:
// • трек — массив из полей (id, owner_id, url, title, performer, duration, …, hashes, cover, …);
// • ссылка на звук приходит пустой — её даёт act=reload_audio по «полному id» с хешами;
// • ссылка «замаскирована» (audio_api_unavailable) — снимаем маску тем же алгоритмом, что yt-dlp;
// • звук — HLS (.m3u8), куски иногда зашифрованы AES-128 (это расшифровывает stream.js).
// VK время от времени всё это меняет — тогда смотрим vk-debug.log.
import { recencyPick } from '../freshness.js';

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

/**
 * Ответы vk.com часто в windows-1251, а не в UTF-8 — отсюда «�����» вместо русских названий.
 * Берём кодировку из заголовка, а если её нет и UTF-8 не сходится — читаем как windows-1251.
 */
export function decodeVk(buf, contentType = '') {
  const cs = (/charset=([\w-]+)/i.exec(contentType || '') || [])[1];
  if (cs && !/utf-?8/i.test(cs)) {
    try {
      return new TextDecoder(cs.toLowerCase()).decode(buf);
    } catch {
      // неизвестная кодировка — пробуем дальше
    }
  }
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('\uFFFD')) return utf;
  return new TextDecoder('windows-1251').decode(buf);
}

export function isAudioItem(a) {
  return Array.isArray(a) && a.length > I.hashes && /^-?\d+$/.test(String(a[I.id])) && /^-?\d+$/.test(String(a[I.owner])) && typeof a[I.title] === 'string' && typeof a[I.performer] === 'string';
}

export function mapAudio(a) {
  const owner = String(a[I.owner]);
  const id = String(a[I.id]);
  let covers = String(a[I.cover] || '').split(',').filter((u) => /^https?:/.test(u));
  // обложка могла переехать в другое поле — ищем любую ссылку на картинку в массиве трека
  if (!covers.length) {
    const any = a.find((x) => typeof x === 'string' && /^https:\/\/[^\s"]+\.(jpe?g|png|webp)/i.test(x));
    if (any) covers = any.split(',').filter((u) => /^https?:/.test(u));
  }
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
  } else if (typeof node === 'string' && /^\s*[[{]/.test(node) && node.length > 20) {
    // VK иногда кладёт JSON строкой внутрь ответа
    try {
      collectAudios(JSON.parse(node), out, depth + 1);
    } catch {
      // не JSON — может, HTML
      htmlAudios(node, out, depth);
    }
  } else if (typeof node === 'string') {
    htmlAudios(node, out, depth);
  }
  return out;
}

function htmlAudios(html, out, depth) {
  if (!html.includes('data-audio=')) return;
  for (const m of html.matchAll(/data-audio="([^"]+)"/g)) {
    try {
      collectAudios(JSON.parse(unescapeHtml(m[1])), out, depth + 1);
    } catch {
      // не JSON — пропускаем
    }
  }
}

/** Трек из api.vk.com (audio.search и т.п.) → такой же массив, как на сайте, чтобы дальше всё работало одинаково */
export function apiAudioToItem(o) {
  const a = new Array(15).fill('');
  const th = (o.album && o.album.thumb) || {};
  a[I.id] = o.id;
  a[I.owner] = o.owner_id;
  a[I.url] = o.url || '';
  a[I.title] = String(o.title || '');
  a[I.performer] = String(o.artist || '');
  a[I.duration] = Number(o.duration) || 0;
  a[I.hashes] = '';
  a[I.cover] = th.photo_1200 || th.photo_600 || th.photo_300 || th.photo_270 || '';
  return a;
}

/** Плейлисты из мобильной версии: ссылки вида act=audio_playlist{владелец}_{id}&access_hash=… */
export function parsePlaylistsHtml(html) {
  const out = new Map();
  const re = /act=audio_playlist(-?\d+)_(\d+)(?:&(?:amp;)?access_hash=([0-9a-f]+))?[^>]*>([\s\S]{0,1500}?)<\/a>/g;
  for (const m of String(html).matchAll(re)) {
    const key = `${m[1]}_${m[2]}`;
    if (out.has(key)) continue;
    const inner = m[4];
    const title = (/class="[^"]*(?:Title|title)[^"]*"[^>]*>([^<]+)</.exec(inner) || [])[1] || '';
    const cover = (/url\((?:&quot;|'|")?(https:[^)'"&]+)/.exec(inner) || [])[1] || null;
    out.set(key, { owner: m[1], id: m[2], hash: m[3] || '', title: title.trim(), cover });
  }
  return [...out.values()];
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
    this.works = {}; // какой способ поиска/рекомендаций сработал
    this.token = null;
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
    const text = decodeVk(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
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
  async likedTracks(limit = 5000) {
    if (!this.uid) await this.refresh();
    return this.loadPlaylist(this.uid, -1, '', limit);
  }

  /** Треки плейлиста (playlist_id -1 — «Моя музыка») */
  async loadPlaylist(ownerId, playlistId, accessHash = '', limit = 5000) {
    const out = [];
    let offset = 0;
    for (let page = 0; page < 60 && out.length < limit; page++) {
      const data = await this.post('load_section', { owner_id: ownerId, playlist_id: playlistId, offset, type: 'playlist', access_hash: accessHash || '', is_loading_all: 1 });
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

  /** Свои плейлисты VK: id вида vk:владелец_плейлист_ключ */
  async playlists() {
    if (!this.uid) await this.refresh();
    const uid = this.uid;
    const tries = [
      ['api audio.getPlaylists', async () => {
        const r = await this.api('audio.getPlaylists', { owner_id: String(uid), count: '100' });
        return ((r && r.items) || []).map((p) => {
          const th = (p.thumbs && p.thumbs[0]) || p.photo || {};
          return { owner: p.owner_id, id: p.id, hash: p.access_key || '', title: p.title, count: p.count, cover: th.photo_600 || th.photo_300 || th.photo_270 || null };
        });
      }],
      ['m.vk', async () => {
        const base = (this.getBase() || BASE).replace('://', '://m.');
        const res = await this.fetch(`${base}/audio?act=audio_playlists${uid}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const html = decodeVk(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
        return parsePlaylistsHtml(html);
      }]
    ];
    for (const [name, fn] of this.preferWorking('playlists', tries)) {
      try {
        const list = (await fn()).filter((p) => p && p.id != null && p.owner != null);
        if (list.length) {
          this.works.playlists = name;
          return list.map((p) => ({ id: `vk:${p.owner}_${p.id}_${p.hash || ''}`, source: 'vk', title: unescapeHtml(p.title) || 'Плейлист', count: Number(p.count) || 0, cover: p.cover || null, subtitle: 'VK Музыка' }));
        }
      } catch (e) {
        this.debug(`playlists / ${name}: ${e.message}`);
      }
    }
    return [];
  }

  async playlistTracks(id) {
    const m = /^vk:(-?\d+)_(-?\d+)_?(\w*)$/.exec(String(id));
    if (!m) throw new Error('Странный плейлист VK');
    return this.loadPlaylist(m[1], m[2], m[3]);
  }

  async section(name, extra = {}) {
    if (!this.uid) await this.refresh();
    const data = await this.post('section', { owner_id: this.uid, section: name, claim: 0, is_layer: 0, ...extra });
    const items = collectAudios(data);
    if (!items.length) this.debug(`section ${name} ${JSON.stringify(extra)}: треков не нашлось:\n${JSON.stringify(data).slice(0, 3000)}`);
    return this.remember(items);
  }

  /**
   * Токен api.vk.com, который выдаёт сам vk.com своей веб-версии (как делает сайт).
   * Живёт только в памяти, никуда не сохраняется и не уходит.
   */
  async webToken() {
    if (this.token && this.token.until > Date.now()) return this.token.value;
    const base = this.getBase() || BASE;
    const host = base.includes('vk.ru') ? 'https://login.vk.ru' : 'https://login.vk.com';
    const res = await this.fetch(`${host}/?act=web_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Referer: `${base}/` },
      body: 'version=1&app_id=6287487'
    });
    const text = decodeVk(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      throw new Error(`web_token: HTTP ${res.status}, не JSON: ${text.slice(0, 300)}`);
    }
    const t = j && j.data && j.data.access_token;
    if (!t) throw new Error(`web_token: нет токена: ${text.slice(0, 300)}`);
    const exp = Number(j.data.expires) || 0;
    this.token = { value: t, until: exp > 1e9 ? exp * 1000 - 60_000 : Date.now() + 30 * 60_000 };
    return t;
  }

  async api(method, params = {}) {
    const token = await this.webToken();
    const base = this.getBase() || BASE;
    const host = base.includes('vk.ru') ? 'https://api.vk.ru' : 'https://api.vk.com';
    const res = await this.fetch(`${host}/method/${method}?v=5.199&client_id=6287487`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Referer: `${base}/` },
      body: new URLSearchParams({ access_token: token, ...params }).toString()
    });
    const j = JSON.parse(decodeVk(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type')));
    if (j.error) {
      if (j.error.error_code === 5) this.token = null;
      throw new Error(`${method}: ${j.error.error_code} ${j.error.error_msg}`);
    }
    return j.response;
  }

  apiTracks(resp) {
    const items = (resp && (resp.items || (Array.isArray(resp) ? resp : resp.audios))) || [];
    return this.remember(items.filter((o) => o && o.owner_id != null && o.id != null).map(apiAudioToItem));
  }

  /** Мобильная версия отдаёт треки прямо в HTML (data-audio) */
  async mobile(path) {
    const base = (this.getBase() || BASE).replace('://', '://m.');
    const res = await this.fetch(`${base}${path}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    const text = decodeVk(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
    const items = collectAudios(text.replace(/^\s*<!--/, ''));
    if (!items.length) this.debug(`m${path}: треков не нашлось (HTTP ${res.status}):\n${text.slice(0, 1500)}`);
    return this.remember(items);
  }

  /** Пробует способы по очереди, пока какой-то не вернёт треки; каждый сбой — в vk-debug.log */
  async firstOf(what, tries) {
    for (const [name, fn] of tries) {
      try {
        const list = await fn();
        if (list.length) {
          if (this.works[what] !== name) this.debug(`${what}: сработал способ «${name}» (${list.length} треков)`);
          this.works[what] = name;
          return list;
        }
      } catch (e) {
        this.debug(`${what} / ${name}: ${e.message}`);
        if (/войди заново|Нужен вход/.test(e.message)) throw e;
      }
    }
    return [];
  }

  search(q) {
    const tries = [
      ['section', () => this.section('search', { q })],
      ['api audio.search', async () => this.apiTracks(await this.api('audio.search', { q, count: 100, auto_complete: 1, sort: 2 }))],
      ['m.vk', () => this.mobile(`/audio?act=search&q=${encodeURIComponent(q)}`)]
    ];
    return this.firstOf('search', this.preferWorking('search', tries));
  }

  recommendations() {
    const tries = [
      ['section recoms', () => this.section('recoms')],
      ['api audio.getRecommendations', async () => this.apiTracks(await this.api('audio.getRecommendations', { count: 100, shuffle: 1 }))],
      ['section explore', () => this.section('explore')]
    ];
    return this.firstOf('recoms', this.preferWorking('recoms', tries));
  }

  /** Тот способ, что сработал в прошлый раз, пробуем первым */
  preferWorking(what, tries) {
    const w = this.works[what];
    return w ? [...tries.filter((t) => t[0] === w), ...tries.filter((t) => t[0] !== w)] : tries;
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
  async wavePool({ diversity = 'favorite', exclude = new Set(), size = 20, fresh: freshness = 60 } = {}) {
    const pool = new Map();
    for (const t of await this.recommendations().catch(() => [])) if (!exclude.has(t.id)) pool.set(t.id, t);
    let liked = [];
    try {
      // свежие лайки чаще старых
      const all = await this.likedTracks(200);
      liked = recencyPick(all, all.length, freshness);
    } catch (e) {
      this.debug(`wavePool liked: ${e.message}`);
    }
    if (diversity !== 'discover' || !pool.size) {
      const fresh = liked.filter((t) => !exclude.has(t.id));
      for (const t of fresh.slice(0, pool.size ? Math.ceil(size / 3) : size)) pool.set(t.id, t);
    }
    // рекомендаций нет, а все лайки недавно звучали — всё равно даём пару своих, чтобы VK не пропадал из волны
    if (!pool.size) for (const t of liked.slice(0, 3)) pool.set(t.id, t);
    if (!pool.size) this.debug('wavePool: пусто — ни рекомендаций, ни «Моей музыки»');
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
      let found = null;
      let data = null;
      try {
        data = await this.post('reload_audio', { ids: full });
        found = collectAudios(data).find((x) => `${x[I.owner]}_${x[I.id]}` === String(srcId)) || collectAudios(data)[0];
      } catch (e) {
        this.debug(`reload_audio ${full}: ${e.message}`);
      }
      if (!found || !found[I.url]) {
        // трек пришёл из api.vk.com без хешей — спрашиваем ссылку там же
        try {
          const r = await this.api('audio.getById', { audios: String(srcId) });
          const o = (Array.isArray(r) ? r : (r && r.items) || [])[0];
          if (o && o.url) found = apiAudioToItem(o);
        } catch (e) {
          this.debug(`audio.getById ${srcId}: ${e.message}`);
        }
      }
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
