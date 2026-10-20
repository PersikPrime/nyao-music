import crypto from 'node:crypto';
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

/**
 * Достаёт аудиопоток из MPEG-TS (так отдаёт куски VK): PAT → PMT → PID аудио → склейка PES без заголовков.
 * Плеер в окне MPEG-TS не играет, а «голый» mp3 или ADTS-AAC — играет. null, если это не TS.
 */
export function demuxTs(buf) {
  if (buf.length < 376 || buf[0] !== 0x47 || buf[188] !== 0x47) return null;
  let pmtPid = -1;
  let audioPid = -1;
  let streamType = 0;
  const out = [];
  for (let i = 0; i + 188 <= buf.length; i += 188) {
    if (buf[i] !== 0x47) continue;
    const pusi = (buf[i + 1] & 0x40) !== 0;
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    const afc = (buf[i + 3] >> 4) & 3;
    let p = i + 4;
    if (afc === 0 || afc === 2) continue;
    if (afc === 3) p += 1 + buf[p];
    if (p >= i + 188) continue;
    if (pid === 0 && pusi) {
      p += 1 + buf[p];
      const secLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
      for (let q = p + 8; q + 4 <= p + 3 + secLen - 4; q += 4) {
        const prog = (buf[q] << 8) | buf[q + 1];
        if (prog !== 0) {
          pmtPid = ((buf[q + 2] & 0x1f) << 8) | buf[q + 3];
          break;
        }
      }
      continue;
    }
    if (pid === pmtPid && pusi && audioPid < 0) {
      p += 1 + buf[p];
      const secLen = ((buf[p + 1] & 0x0f) << 8) | buf[p + 2];
      const infoLen = ((buf[p + 10] & 0x0f) << 8) | buf[p + 11];
      const end = p + 3 + secLen - 4;
      for (let q = p + 12 + infoLen; q + 5 <= end;) {
        const st = buf[q];
        const esPid = ((buf[q + 1] & 0x1f) << 8) | buf[q + 2];
        const esLen = ((buf[q + 3] & 0x0f) << 8) | buf[q + 4];
        if ([0x03, 0x04, 0x0f, 0x11].includes(st)) {
          audioPid = esPid;
          streamType = st;
          break;
        }
        q += 5 + esLen;
      }
      continue;
    }
    if (pid === audioPid) {
      if (pusi && buf[p] === 0 && buf[p + 1] === 0 && buf[p + 2] === 1) p += 9 + buf[p + 8];
      if (p < i + 188) out.push(buf.subarray(p, i + 188));
    }
  }
  if (audioPid < 0) return null;
  return { data: Buffer.concat(out), mime: streamType === 0x0f || streamType === 0x11 ? 'audio/aac' : 'audio/mpeg' };
}

/** IV для AES-128 в HLS: из плейлиста или номер куска (16 байт, big-endian) */
function hlsIv(key, seq) {
  if (key.iv) return Buffer.from(key.iv.replace(/^0x/i, '').padStart(32, '0'), 'hex');
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(seq >>> 0, 12);
  return iv;
}

/**
 * Скачивает HLS-поток целиком в память: init-сегмент + все куски по порядку, по 6 параллельно.
 * Понимает master-плейлист, шифрование AES-128 (VK) и куски в MPEG-TS (их распаковываем в mp3/AAC).
 * Возвращает Buffer; у него свойство mime, если тип звука выяснился по ходу.
 */
export async function downloadHls(fetchFn, playlistUrl, headers = {}) {
  let text = await (await fetchFn(playlistUrl, { headers })).text();
  if (/#EXT-X-STREAM-INF/.test(text)) {
    const variant = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    playlistUrl = new URL(variant, playlistUrl).toString();
    text = await (await fetchFn(playlistUrl, { headers })).text();
  }
  const base = new URL(playlistUrl);
  const abs = (u) => new URL(u, base).toString();
  const segs = [];
  const map = text.match(/#EXT-X-MAP:URI="([^"]+)"/);
  if (map) segs.push({ url: abs(map[1]), key: null, seq: 0 });
  let seq = Number((text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/) || [])[1]) || 0;
  let key = null;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith('#EXT-X-KEY:')) {
      const method = (l.match(/METHOD=([A-Z0-9-]+)/) || [])[1] || 'NONE';
      key = method === 'NONE' ? null : { method, uri: abs((l.match(/URI="([^"]+)"/) || [])[1] || ''), iv: (l.match(/IV=(0x[0-9a-fA-F]+)/) || [])[1] };
      if (key && key.method !== 'AES-128') throw new Error(`шифрование HLS ${key.method} не поддерживается`);
    } else if (l && !l.startsWith('#')) {
      segs.push({ url: abs(l), key, seq: seq++ });
    }
  }
  if (!segs.length) throw new Error('пустой HLS-плейлист');
  const keys = new Map();
  const getKey = (uri) => {
    if (!keys.has(uri)) keys.set(uri, fetchFn(uri, { headers }).then(async (r) => {
      if (!r.ok) throw new Error(`ключ HLS: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }));
    return keys.get(uri);
  };
  const parts = new Array(segs.length);
  let next = 0;
  const worker = async () => {
    while (next < segs.length) {
      const i = next++;
      const s = segs[i];
      const res = await fetchFn(s.url, { headers });
      if (!res.ok) throw new Error(`кусок HLS: HTTP ${res.status}`);
      let data = Buffer.from(await res.arrayBuffer());
      if (s.key) {
        const d = crypto.createDecipheriv('aes-128-cbc', await getKey(s.key.uri), hlsIv(s.key, s.seq));
        data = Buffer.concat([d.update(data), d.final()]);
      }
      parts[i] = data;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, segs.length) }, worker));
  const joined = Buffer.concat(parts);
  const ts = demuxTs(joined);
  if (ts) {
    ts.data.mime = ts.mime;
    return ts.data;
  }
  return joined;
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
  constructor({ ya, yt, sc, vk = null, fetch = globalThis.fetch, fetchBySource = {} }) {
    this.providers = { ya, yt, sc, vk };
    this.fetchers = { ya: fetchBySource.ya || fetch, yt: fetchBySource.yt || fetch, sc: fetchBySource.sc || fetch, vk: fetchBySource.vk || fetch };
    this.hls = new Map(); // trackId → Promise<Buffer>, последние несколько треков SoundCloud
    this.cache = new Map();
    this.pending = new Map();
    this.errors = new Map();
    this.failedClients = new Map(); // trackId → клиенты YouTube, отдавшие 403
  }

  async check(url, headers) {
    try {
      const res = await this.fetchers.yt(url, { headers: { ...headers, Range: 'bytes=0-1' }, signal: AbortSignal.timeout(6000) });
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
    const failure = this.failedClients.get(trackId);
    const exclude = failure && failure.until > Date.now() ? failure.clients : [];
    const job = (source === 'yt' ? provider.streamUrl(srcId, (u, h) => this.check(u, h), log, { exclude }) : provider.streamUrl(srcId))
      .then((r) => {
        const entry = { source, client: r.client, url: r.url, headers: r.headers || {}, expires: Date.now() + (r.ttl || 30 * 60_000), mime: r.mime, hls: !!r.hls, loudnessDb: Number.isFinite(r.loudnessDb) ? r.loudnessDb : null };
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

  /** Громкость YouTube-трека относительно эталона (дБ), если сервис её сообщил */
  async loudness(trackId) {
    if (!trackId.startsWith('yt:')) return null;
    const e = await this.resolve(trackId).catch(() => null);
    return e ? e.loudnessDb : null;
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
          const buf = await this.hls.get(trackId);
          return bufferResponse(buf, range, buf.mime || entry.mime || 'audio/mpeg');
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
        if (entry.source === 'yt' && entry.client && upstream.status === 403) {
          // этот клиент YouTube больше не пускают — для трека берём другой
          const failure = this.failedClients.get(trackId);
          const list = failure && failure.until > Date.now() ? failure.clients : [];
          this.failedClients.set(trackId, { clients: [...new Set([...list, entry.client])], until: Date.now() + 10 * 60_000 });
          if (this.providers.yt.reportBlocked) this.providers.yt.reportBlocked(entry.client, trackId.slice(3));
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
