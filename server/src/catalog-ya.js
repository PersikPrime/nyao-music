// Каталог треков Яндекс Музыки для сайта текстов: только метаданные (название, исполнитель, альбом,
// длительность, обложка) — без входа и без токенов. Тексты отсюда не берём.

const API = 'https://api.music.yandex.net';
const HEADERS = { 'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621', 'User-Agent': 'Yandex-Music-API', 'Accept-Language': 'ru' };
const TTL = 10 * 60_000;

export function mapYaTrack(t) {
  if (!t || t.id == null) return null;
  const album = (t.albums && t.albums[0]) || {};
  const cover = t.coverUri || album.coverUri;
  return {
    yaId: String(t.id),
    title: String(t.title || '') + (t.version ? ` (${t.version})` : ''),
    artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', '),
    album: album.title || '',
    duration: Math.round((t.durationMs || 0) / 1000),
    cover: cover ? `https://${String(cover).replace('%%', '200x200')}` : null
  };
}

export class YaCatalog {
  constructor({ fetch = globalThis.fetch, log = () => {} } = {}) {
    this.fetch = fetch;
    this.log = log;
    this.cache = new Map();
  }

  async get(path, query) {
    const url = `${API}${path}${query ? '?' + new URLSearchParams(query) : ''}`;
    const hit = this.cache.get(url);
    if (hit && hit.until > Date.now()) return hit.data;
    const res = await this.fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      this.log(`[catalog] Яндекс ${path}: ${res.status}`);
      throw Object.assign(new Error(`Каталог Яндекса ответил ${res.status}`), { status: res.status });
    }
    const json = await res.json();
    const data = json && 'result' in json ? json.result : json;
    this.cache.set(url, { data, until: Date.now() + TTL });
    while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
    return data;
  }

  /** Поиск треков → до 20 штук */
  async search(q) {
    const r = await this.get('/search', { text: q, type: 'track', page: '0', nocorrect: 'false' });
    return ((r && r.tracks && r.tracks.results) || []).map(mapYaTrack).filter((t) => t && t.title && t.artist).slice(0, 20);
  }

  /**
   * Метаданные трека по публичной странице open.spotify.com (og-теги, без входа и ключей).
   * → { title, artist, album, duration, cover } или null
   */
  async spotifyTrack(id) {
    const key = `sp:${id}`;
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return hit.data;
    const res = await this.fetch(`https://open.spotify.com/track/${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NyaoLyricLabs/1.0)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw Object.assign(new Error(`Spotify ответил ${res.status}`), { status: res.status });
    const html = await res.text();
    const meta = (name) => {
      const m = new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`, 'i').exec(html) || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${name}"`, 'i').exec(html);
      return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
    };
    const title = meta('og:title');
    // исполнитель: тег music:musician_description, заголовок «Трек - song and lyrics by Исполнитель | Spotify»
    // или описание вида «Listen to … on Spotify. Song · Исполнитель · 2021»
    const head = /<title>([^<]*)<\/title>/i.exec(html);
    const byTitle = head && / - song(?: and lyrics)? by (.+?) \| Spotify\s*$/i.exec(head[1].replace(/&amp;/g, '&'));
    const parts = meta('og:description').replace(/^Listen to .*? on Spotify\.\s*/i, '').split(' · ').map((x) => x.trim())
      .filter((x) => x && x !== title && !/^(song|single|album|ep|\d{4})$/i.test(x));
    const artist = meta('music:musician_description') || (byTitle && byTitle[1]) || parts[0] || '';
    const data = title && artist ? { title, artist, album: '', duration: Number(meta('music:duration')) || 0, cover: meta('og:image') || null } : null;
    this.cache.set(key, { data, until: Date.now() + TTL });
    return data;
  }

  /**
   * ISRC записи через открытый API Deezer (без ключей): ищем трек с тем же названием и длительностью (±2 с).
   * → 'USRC17607839' или null. Только метаданные.
   */
  async isrcFor({ title, artist, duration }) {
    const get = async (url) => {
      const res = await this.fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`Deezer ответил ${res.status}`);
      return res.json();
    };
    const q = `artist:"${String(artist).split(',')[0].trim()}" track:"${String(title).trim()}"`;
    const r = await get(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: '10' })}`);
    const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const hit = ((r && r.data) || []).find((d) => low(d.title) === low(title) && (!duration || Math.abs(Number(d.duration) - duration) <= 2));
    if (!hit) return null;
    const t = await get(`https://api.deezer.com/track/${encodeURIComponent(hit.id)}`);
    return t && t.isrc ? String(t.isrc).toUpperCase() : null;
  }

  /** Трек по id (для «Добавить текст» по ссылке и проверки метаданных при отправке) */
  async track(id) {
    const r = await this.get(`/tracks/${encodeURIComponent(id)}`);
    return mapYaTrack(Array.isArray(r) ? r[0] : null);
  }
}
