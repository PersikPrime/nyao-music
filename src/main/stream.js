// Локальный прокси аудио: плеер в окне играет nyao://stream/<id>,
// а здесь мы находим прямую ссылку нужного сервиса, кешируем её и отдаём байты с поддержкой Range.
// Так перемотка работает одинаково для обоих сервисов, а протухшие ссылки обновляются сами.
//
// YouTube ходит через fetch из Node, а не через сеть Electron: googlevideo сверяет заголовки
// (User-Agent клиента), а сетевой стек Chromium может их подменять. Тот же путь использует
// скрипт npm run yt-test. Аудио YouTube запрашиваем кусками по 4 МБ, как yt-dlp:
// открытый Range без конца googlevideo иногда режет или замедляет.

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];
const YT_CHUNK = 4 * 1024 * 1024;

export function chunkRange(range, chunk = YT_CHUNK) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  const start = m && m[1] ? Number(m[1]) : 0;
  const askedEnd = m && m[2] ? Number(m[2]) : Infinity;
  const end = Math.min(askedEnd, start + chunk - 1);
  return `bytes=${start}-${end}`;
}

/** Скачивает HLS-поток (SoundCloud) целиком в память: init-сегмент + все куски по порядку, по 6 параллельно */
export async function downloadHls(fetchFn, playlistUrl, headers = {}) {
  const text = await (await fetchFn(playlistUrl, { headers })).text();
  const base = new URL(playlistUrl);
  const abs = (u) => new URL(u, base).toString();
  const urls = [];
  const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/);
  if (map) urls.push(abs(map[1]));
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l && !l.startsWith('#')) urls.push(abs(l));
  }
  if (!urls.length) throw new Error('пустой HLS-плейлист');
  const parts = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const res = await fetchFn(urls[i], { headers });
      if (!res.ok) throw new Error(`кусок HLS: HTTP ${res.status}`);
      parts[i] = Buffer.from(await res.arrayBuffer());
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, worker));
  return Buffer.concat(parts);
}

/** Отдаёт буфер с поддержкой Range — так перемотка работает и для HLS */
export function bufferResponse(buf, range, mime) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  const headers = { 'content-type': mime, 'accept-ranges': 'bytes' };
  if (!m) return new Response(buf, { status: 200, headers: { ...headers, 'content-length': String(buf.length) } });
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
  if (start >= buf.length) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${buf.length}` } });
  return new Response(buf.subarray(start, end + 1), {
    status: 206,
    headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${buf.length}` }
  });
}

export class StreamService {
  constructor({ ya, yt, sc, fetch = globalThis.fetch, fetchBySource = {} }) {
    this.providers = { ya, yt, sc };
    this.fetchers = { ya: fetchBySource.ya || fetch, yt: fetchBySource.yt || fetch, sc: fetchBySource.sc || fetch };
    this.hls = new Map(); // trackId → Promise<Buffer>, последние несколько треков SoundCloud
    this.cache = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.failedClients = new Map(); // trackId → клиенты YouTube, отдавшие 403
  }

  async check(url, headers) {
    try {
      const res = await this.fetchers.yt(url, { headers: { ...headers, Range: 'bytes=0-1' } });
      if (res.body && res.body.cancel) res.body.cancel().catch(() => {});
      return res.status;
    } catch (e) {
      console.warn('[stream] пробный запрос не прошёл:', e.cause ? e.cause.code || e.cause.message : e.message);
      return 0;
    }
  }

  lastError(trackId) {
    return this.errors.get(trackId) || null;
  }

  async resolve(trackId, force = false) {
    const cached = this.cache.get(trackId);
    if (!force && cached && cached.expires > Date.now()) return cached;
    if (!force && this.pending.has(trackId)) return this.pending.get(trackId);
    const [source, ...rest] = trackId.split(':');
    const srcId = rest.join(':');
    const provider = this.providers[source];
    if (!provider) throw new Error(`Неизвестный источник: ${source}`);
    const log = (msg) => console.log('[yt]', msg);
    const exclude = this.failedClients.get(trackId) || [];
    const job = (source === 'yt' ? provider.streamUrl(srcId, (u, h) => this.check(u, h), log, { exclude }) : provider.streamUrl(srcId))
      .then((r) => {
        const entry = { source, client: r.client, url: r.url, headers: r.headers || {}, expires: Date.now() + (r.ttl || 30 * 60_000), mime: r.mime, hls: !!r.hls };
        this.cache.set(trackId, entry);
        this.errors.delete(trackId);
        return entry;
      })
      .catch((e) => {
        console.error(`[stream] ${trackId}: ${e.message}`);
        this.errors.set(trackId, e.message);
        throw e;
      })
      .finally(() => this.pending.delete(trackId));
    this.pending.set(trackId, job);
    return job;
  }

  // Предзагрузка ссылки для следующего трека, ошибки молча игнорируем
  prepare(trackId) {
    this.resolve(trackId).catch(() => {});
  }

  async handle(request) {
    const u = new URL(request.url);
    const trackId = decodeURIComponent(u.pathname.replace(/^\//, ''));
    const range = request.headers.get('range');
    for (let attempt = 0; attempt < 3; attempt++) {
      let entry;
      try {
        entry = await this.resolve(trackId, attempt > 0);
      } catch (e) {
        return new Response(e.message, { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      if (entry.hls) {
        try {
          if (!this.hls.has(trackId)) {
            const job = downloadHls(this.fetchers[entry.source], entry.url, entry.headers);
            this.hls.set(trackId, job);
            job.catch(() => this.hls.delete(trackId));
            while (this.hls.size > 4) this.hls.delete(this.hls.keys().next().value);
          }
          return bufferResponse(await this.hls.get(trackId), range, entry.mime || 'audio/mpeg');
        } catch (e) {
          console.warn(`[stream] ${trackId}: HLS не скачался (${e.message}), обновляю ссылку`);
          this.errors.set(trackId, `HLS: ${e.message}`);
          this.cache.delete(trackId);
          this.hls.delete(trackId);
          continue;
        }
      }
      const headers = { ...entry.headers };
      if (entry.source === 'yt') headers.Range = chunkRange(range);
      else if (range) headers.Range = range;
      let upstream;
      try {
        upstream = await this.fetchers[entry.source](entry.url, { headers });
      } catch (e) {
        const why = e.cause ? e.cause.code || e.cause.message : e.message;
        console.error(`[stream] ${trackId}: сеть не ответила (${why})`);
        this.errors.set(trackId, `сеть не ответила: ${why}`);
        return new Response('network error', { status: 502 });
      }
      if (entry.source === 'yt') console.log(`[stream] ${trackId} ${headers.Range} → ${upstream.status}`);
      if (upstream.status === 403 || upstream.status === 410) {
        console.warn(`[stream] ${trackId}: источник ответил ${upstream.status}, обновляю ссылку`);
        this.errors.set(trackId, `источник ответил HTTP ${upstream.status}`);
        this.cache.delete(trackId);
        if (entry.source === 'yt' && entry.client) {
          // этот клиент YouTube больше не пускают — для трека берём другой
          const list = this.failedClients.get(trackId) || [];
          this.failedClients.set(trackId, [...list, entry.client]);
          if (this.providers.yt.reportBlocked) this.providers.yt.reportBlocked(entry.client);
        }
        if (upstream.body && upstream.body.cancel) upstream.body.cancel().catch(() => {});
        continue;
      }
      const out = new Headers();
      for (const h of PASS_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) out.set(h, v);
      }
      if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
      if (entry.mime && !(out.get('content-type') || '').startsWith('audio')) out.set('content-type', entry.mime.split(';')[0]);
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
    return new Response('Ссылка на поток недоступна', { status: 502 });
  }
}
