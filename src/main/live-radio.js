// Яндекс Радио (radio.yandex.ru): прямой эфир обычных радиостанций.
// Публичный API сайта radio.api.music.yandex.ru/radio/v1 — вход и токены не нужны:
//   stations?userRegion=…                — станции (по 50, дальше continueFrom)
//   genres                                — жанры
//   stations/{st}/streams/{sr}/url        — ссылка на эфир (HLS, подписана на время)
//   stations/{st}/streams/{sr}/recently-played — что звучало, с id трека в Яндекс Музыке
// Плеер в окне HLS не играет, поэтому эфир отдаём как бесконечный поток ADTS-AAC/mp3:
// main сам читает плейлист, скачивает новые куски и распаковывает MPEG-TS (demuxTs из stream.js).
import { demuxTs } from './stream.js';

const API = 'https://radio.api.music.yandex.ru/radio/v1/';
const REGION = '213'; // Москва: от региона зависят только региональные потоки и порядок
const HEADERS = { origin: 'https://radio.yandex.ru', referer: 'https://radio.yandex.ru/' };

/** Картинка Яндекса: шаблон «…/%%» → нужный размер, без схемы → https */
export function yaImage(u, size = '400x400') {
  if (!u) return '';
  const s = String(u).replace('%%', size);
  return /^https?:/.test(s) ? s : `https://${s}`;
}

/** id трека Яндекс Музыки из ссылки music.yandex.ru/album/1/track/2 */
export function yaTrackId(url) {
  const m = /\/track\/(\d+)/.exec(url || '');
  return m ? m[1] : '';
}

/** Станция из ответа API → компактный вид для окна и телефона */
export function mapStation(s) {
  const c = s.cardInfo || {};
  const streams = (s.streams || []).map((x) => ({ slug: x.slug, name: x.compactName || x.name || '' }));
  return {
    slug: s.slug,
    name: s.name,
    desc: c.shortDescription || c.ultraShortDescription || '',
    tag: c.ultraShortDescription || '',
    logo: yaImage(c.logo),
    bg: c.logoBackgroundColor || c.themeColor || '#222226',
    theme: c.themeColor || c.logoBackgroundColor || '#222226',
    genres: (s.genres || []).map((g) => g.slug),
    listeners: (s.listeners && s.listeners.count) || 0,
    streams,
    stream: s.userDefaultStreamSlug || (streams[0] && streams[0].slug) || '',
  };
}

/** Трек из «недавно звучало» */
export function mapOnAir(item) {
  const t = (item && item.track) || {};
  return {
    title: t.title || '',
    artist: t.artist || '',
    cover: yaImage(t.yandexCover || t.externalCover),
    yaId: yaTrackId(t.yaMusicUrl) || String(t.trackId || '').split(':')[0],
    at: item.timestamp ? item.timestamp * 1000 : 0,
  };
}

/** Медиа-плейлист HLS: номер первого куска, длительность и куски по порядку */
export function parseMedia(text, base) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let seq = Number((text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1]) || 0;
  const target = Number((text.match(/#EXT-X-TARGETDURATION:(\d+)/) || [])[1]) || 6;
  const segs = [];
  for (const l of lines) {
    if (l && !l.startsWith('#')) segs.push({ seq: seq++, url: new URL(l, base).toString() });
  }
  return { segs, target, ended: /#EXT-X-ENDLIST/.test(text), encrypted: /#EXT-X-KEY:METHOD=(?!NONE)/.test(text) };
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

export class LiveRadio {
  constructor({ fetch = globalThis.fetch } = {}) {
    this.fetch = fetch;
    this.cache = new Map(); // ключ → { at, value }
  }

  async json(path, ttl = 0) {
    const hit = ttl && this.cache.get(path);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const url = `${API}${path}${path.includes('?') ? '&' : '?'}userRegion=${REGION}`;
    const r = await this.fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`Яндекс Радио: HTTP ${r.status}`);
    const value = await r.json();
    if (ttl) this.cache.set(path, { at: Date.now(), value });
    return value;
  }

  /** Все станции (страниц немного, ~7), популярные первыми; кеш полчаса */
  async stations() {
    const hit = this.cache.get('all');
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value;
    const out = [];
    let cont = '';
    for (let page = 0; page < 20; page++) {
      const j = await this.json(`stations${cont ? `?continueFrom=${encodeURIComponent(cont)}` : ''}`);
      out.push(...(j.stations || []).map(mapStation));
      if (!j.hasNext || !j.continueFrom) break;
      cont = j.continueFrom;
    }
    out.sort((a, b) => b.listeners - a.listeners);
    this.cache.set('all', { at: Date.now(), value: out });
    return out;
  }

  async genres() {
    const j = await this.json('genres', 6 * 3600_000);
    return (j.genres || []).map((g) => ({ slug: g.slug, name: g.name }));
  }

  async streamUrl(station, stream) {
    const j = await this.json(`stations/${encodeURIComponent(station)}/streams/${encodeURIComponent(stream)}/url`);
    if (!j.url) throw new Error('станция не отдала ссылку на эфир');
    return j.url;
  }

  /** Что звучало (новые первыми). У разговорных станций — пусто */
  async recent(station, stream) {
    const j = await this.json(`stations/${encodeURIComponent(station)}/streams/${encodeURIComponent(stream)}/recently-played`, 15_000);
    return (j.tracks || []).map(mapOnAir).filter((t) => t.title);
  }

  async text(url, signal) {
    const r = await this.fetch(url, { headers: HEADERS, signal });
    if (!r.ok) throw new Error(`эфир: HTTP ${r.status}`);
    return r.text();
  }

  /** Медиа-плейлист эфира (в master — самый качественный вариант, он первый) */
  async mediaUrl(station, stream, signal) {
    const url = await this.streamUrl(station, stream);
    const text = await this.text(url, signal);
    if (!/#EXT-X-STREAM-INF/.test(text)) return url;
    const variant = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    return new URL(variant, url).toString();
  }

  async segment(url, signal) {
    const r = await this.fetch(url, { headers: HEADERS, signal });
    if (!r.ok) throw new Error(`кусок эфира: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const ts = demuxTs(buf);
    return ts || { data: buf, mime: /\.mp3(\?|$)/.test(url) ? 'audio/mpeg' : 'audio/aac' };
  }

  /**
   * Ответ для nyao://live/<станция>/<поток>: бесконечный аудиопоток.
   * Начинаем с трёх последних кусков (≈18 с запаса), дальше докачиваем новые по мере появления.
   * Ссылки подписаны на время — при ошибке берём новую и продолжаем с того же места.
   */
  async response(station, stream) {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let media = await this.mediaUrl(station, stream, signal);
    let pl = parseMedia(await this.text(media, signal), media);
    if (pl.encrypted) throw new Error('эфир этой станции зашифрован — пока не играет');
    if (!pl.segs.length) throw new Error('эфир пуст');
    const start = pl.segs.slice(-3);
    const first = await this.segment(start[0].url, signal);
    let last = start[0].seq;
    let queue = start.slice(1);
    const self = this;
    let fails = 0;
    const body = new ReadableStream({
      start(c) { c.enqueue(first.data); },
      async pull(c) {
        while (!signal.aborted) {
          try {
            if (!queue.length) {
              await sleep(Math.max(1000, pl.target * 500), signal);
              if (signal.aborted) return;
              pl = parseMedia(await self.text(media, signal), media);
              queue = pl.segs.filter((s) => s.seq > last);
              // эфир перезапустился (номера кусков пошли с начала) — берём живой край
              if (!queue.length && pl.segs.length && pl.segs[pl.segs.length - 1].seq < last) queue = pl.segs.slice(-2);
              if (!queue.length) {
                if (pl.ended) { c.close(); return; }
                continue;
              }
            }
            const s = queue.shift();
            const part = await self.segment(s.url, signal);
            last = s.seq;
            fails = 0;
            c.enqueue(part.data);
            return;
          } catch (e) {
            if (signal.aborted) return;
            if (++fails > 5) { c.error(e); return; }
            await sleep(1500 * fails, signal);
            try { media = await self.mediaUrl(station, stream, signal); queue = []; } catch { /* следующая попытка */ }
          }
        }
      },
      cancel() { ctrl.abort(); },
    });
    return new Response(body, { status: 200, headers: { 'content-type': first.mime, 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  }
}
