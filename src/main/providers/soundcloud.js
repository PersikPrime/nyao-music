// SoundCloud через внутреннее API сайта (api-v2.soundcloud.com) — им пользуется сам soundcloud.com.
// client_id достаём из скриптов сайта (он публичный и иногда меняется), вход — OAuth-токен из cookie oauth_token.
// Звук: progressive mp3 (прямая ссылка) или HLS (список кусков), см. streamUrl.

const API = 'https://api-v2.soundcloud.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function bigArtwork(url) {
  return url ? url.replace(/-(large|t\d+x\d+|small|tiny|badge|crop)\./, '-t500x500.') : null;
}

export function mapTrack(t) {
  if (!t || t.id == null || t.kind && t.kind !== 'track') return null;
  const user = t.user || {};
  return {
    id: `sc:${t.id}`,
    source: 'sc',
    srcId: String(t.id),
    albumId: null,
    albumRef: null,
    artistRef: null,
    title: t.title || 'Без названия',
    artist: (t.publisher_metadata && t.publisher_metadata.artist) || user.username || 'SoundCloud',
    album: '',
    duration: Math.round((t.full_duration || t.duration || 0) / 1000),
    cover: bigArtwork(t.artwork_url || user.avatar_url),
    // BLOCK — недоступен в стране; SNIP — только 30-секундный отрывок (нужен Go+)
    available: t.policy !== 'BLOCK' && t.streamable !== false,
    preview: t.policy === 'SNIP'
  };
}

/** SoundCloud прислал капчу DataDome вместо ответа: в err.captcha — ссылка на неё */
export class CaptchaError extends Error {
  constructor(url) {
    super('SoundCloud просит пройти проверку (капчу)');
    this.captcha = url;
  }
}

export class SoundCloudProvider {
  constructor({ token = null, fetch = globalThis.fetch, writeFetch = null } = {}) {
    this.token = token;
    this.fetch = fetch;
    // Запросы на запись (лайки) идут через сессию браузера, где ты входил: там cookie защиты DataDome
    // и отпечаток настоящего Chromium. Без них SoundCloud отвечает 403 и капчей.
    this.writeFetch = writeFetch;
    this.clientId = null;
    this.account = null;
    this.raw = new Map(); // id → исходный объект трека (нужен для потока)
  }

  get loggedIn() {
    return !!this.token;
  }

  setToken(token) {
    this.token = token;
    this.account = null;
  }

  /** client_id из JS-бандлов soundcloud.com */
  async getClientId(force = false) {
    if (this.clientId && !force) return this.clientId;
    const page = await (await this.fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA } })).text();
    const scripts = [...page.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
    for (const src of scripts) {
      try {
        const js = await (await this.fetch(src, { headers: { 'User-Agent': UA } })).text();
        const m = js.match(/client_id\s*[:=]\s*"([A-Za-z0-9]{32})"/) || js.match(/client_id=([A-Za-z0-9]{32})/);
        if (m) {
          this.clientId = m[1];
          return this.clientId;
        }
      } catch {
        // следующий скрипт
      }
    }
    throw new Error('SoundCloud: не удалось получить client_id (сайт поменялся?)');
  }

  async request(method, path, { query = {}, retry = true } = {}) {
    const clientId = await this.getClientId();
    const url = new URL(path.startsWith('http') ? path : API + path);
    url.searchParams.set('client_id', clientId);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const write = method !== 'GET' && this.writeFetch;
    const headers = { Accept: 'application/json', Origin: 'https://soundcloud.com', Referer: 'https://soundcloud.com/' };
    if (!write) headers['User-Agent'] = UA; // в сессии браузера свой User-Agent — не подменяем его
    if (this.token) headers.Authorization = `OAuth ${this.token}`;
    const res = await (write ? this.writeFetch : this.fetch)(url.toString(), { method, headers });
    if ((res.status === 401 || res.status === 403) && retry && !this.token) {
      // client_id протух — берём свежий и повторяем
      await this.getClientId(true);
      return this.request(method, path, { query, retry: false });
    }
    const text = await res.text();
    if (res.status === 403) {
      const m = text.match(/https:\/\/[a-z.]*captcha-delivery\.com\/[^"\s]+/);
      if (m) throw new CaptchaError(m[0].replace(/\\u0026/g, '&'));
    }
    if (!res.ok) throw new Error(`SoundCloud ${method} ${url.pathname}: ${res.status} ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  }

  remember(list) {
    for (const t of list) if (t && t.id != null) this.raw.set(String(t.id), t);
    return list.map(mapTrack).filter(Boolean);
  }

  async getAccount() {
    if (this.account) return this.account;
    const me = await this.request('GET', '/me');
    this.account = { uid: me.id, name: me.username || me.full_name || 'SoundCloud', plus: /go/i.test((me.creator_subscriptions || []).map((s) => s.product && s.product.id).join(',')) };
    return this.account;
  }

  /** Добирает полные данные треков, у которых пришёл только id */
  async fullTracks(items) {
    const missing = items.filter((t) => t && !t.title).map((t) => t.id);
    const full = new Map(items.filter((t) => t && t.title).map((t) => [String(t.id), t]));
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = await this.request('GET', '/tracks', { query: { ids: missing.slice(i, i + 50).join(',') } });
      for (const t of chunk || []) full.set(String(t.id), t);
    }
    return items.map((t) => t && full.get(String(t.id))).filter(Boolean);
  }

  async likedTracks(limit = 300) {
    const { uid } = await this.getAccount();
    let res = await this.request('GET', `/users/${uid}/track_likes`, { query: { limit: 200 } });
    const out = [];
    for (let page = 0; res && page < 5; page++) {
      out.push(...(res.collection || []).map((x) => x.track).filter(Boolean));
      if (out.length >= limit || !res.next_href) break;
      res = await this.request('GET', res.next_href);
    }
    return this.remember(out.slice(0, limit));
  }

  async playlists() {
    const { uid } = await this.getAccount();
    const res = await this.request('GET', `/users/${uid}/playlists`, { query: { limit: 50 } });
    return (res.collection || []).map((p) => ({
      id: `sc:${p.id}`,
      source: 'sc',
      title: p.title,
      count: p.track_count || 0,
      cover: bigArtwork(p.artwork_url || (p.tracks && p.tracks[0] && p.tracks[0].artwork_url))
    }));
  }

  async playlistTracks(playlistId) {
    const id = playlistId.replace(/^sc:/, '');
    const p = await this.request('GET', `/playlists/${id}`);
    return this.remember(await this.fullTracks(p.tracks || []));
  }

  async search(q) {
    const res = await this.request('GET', '/search/tracks', { query: { q, limit: 30 } });
    return this.remember(res.collection || []);
  }

  async related(srcId) {
    const res = await this.request('GET', `/tracks/${srcId}/related`, { query: { limit: 30 } });
    return this.remember(res.collection || []);
  }

  async like(track, on = true) {
    const { uid } = await this.getAccount();
    await this.request(on ? 'PUT' : 'DELETE', `/users/${uid}/track_likes/${track.srcId}`);
  }

  /** Пул для «Моей волны»: «похожие» на случайные лайки */
  async wavePool({ diversity = 'favorite', exclude = new Set(), size = 20 } = {}) {
    let liked = [];
    try {
      liked = await this.likedTracks(200);
    } catch {
      liked = [];
    }
    const likedIds = new Set(liked.map((t) => t.id));
    const seeds = [...liked].sort(() => Math.random() - 0.5).slice(0, 3);
    const pool = new Map();
    for (const s of seeds) {
      try {
        for (const t of await this.related(s.srcId)) {
          if (!t.available || t.preview || exclude.has(t.id)) continue;
          if (diversity === 'discover' && likedIds.has(t.id)) continue;
          pool.set(t.id, t);
        }
      } catch {
        // следующий сид
      }
      if (pool.size >= size) break;
    }
    if (diversity === 'favorite') {
      for (const t of liked.filter((x) => !exclude.has(x.id) && !x.preview).sort(() => Math.random() - 0.5).slice(0, Math.ceil(size / 3))) pool.set(t.id, t);
    }
    return [...pool.values()].sort(() => Math.random() - 0.5).slice(0, size);
  }

  /**
   * Ссылка на звук. Предпочтение: progressive mp3 → HLS mp3 → HLS AAC. Зашифрованный HLS (Go+) не поддерживаем.
   * Возвращает { url, hls, mime, ttl }.
   */
  async streamUrl(srcId) {
    let t = this.raw.get(String(srcId));
    if (!t || !t.media) {
      t = (await this.request('GET', '/tracks', { query: { ids: srcId } }))[0];
      if (t) this.raw.set(String(srcId), t);
    }
    if (!t) throw new Error('SoundCloud не нашёл трек');
    const list = ((t.media && t.media.transcodings) || []).filter((x) => x.format && !/encrypted/.test(x.format.protocol) && !x.snipped);
    const score = (x) => (x.format.protocol === 'progressive' ? 3 : /mpeg/.test(x.format.mime_type) ? 2 : 1);
    const best = list.sort((a, b) => score(b) - score(a))[0];
    if (!best) throw new Error(t.policy === 'SNIP' ? 'Трек доступен только с подпиской SoundCloud Go+' : 'У трека нет доступного потока');
    const res = await this.request('GET', best.url, { query: t.track_authorization ? { track_authorization: t.track_authorization } : {} });
    const hls = best.format.protocol !== 'progressive';
    return { url: res.url, hls, mime: hls ? (/mpeg/.test(best.format.mime_type) ? 'audio/mpeg' : 'audio/mp4') : 'audio/mpeg', headers: { 'User-Agent': UA }, ttl: 20 * 60_000 };
  }
}
