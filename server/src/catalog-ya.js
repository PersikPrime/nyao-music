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

  /** Трек по id (для «Добавить текст» по ссылке и проверки метаданных при отправке) */
  async track(id) {
    const r = await this.get(`/tracks/${encodeURIComponent(id)}`);
    return mapYaTrack(Array.isArray(r) ? r[0] : null);
  }
}
