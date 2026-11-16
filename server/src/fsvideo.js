// Видео в полном экране: ролики к трекам, которые загружают через Nyao Automator.
// Плеер спрашивает по исполнителю и названию — сервер сам строит ключ трека (те же правила, что в приложении),
// поэтому один ролик находится и в Яндексе, и в YouTube Music, и в Spotify.
// Файлы лежат на сервере (<dataDir>/fsvideo) и отдаются с поддержкой перемотки (HTTP Range).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { looseKey, norm, soften } from './track-key.js';

// за Cloudflare тело запроса не больше 100 МБ — оставляем запас
export const MAX_VIDEO = 95 * 1024 * 1024;
const MIME = { mp4: 'video/mp4', webm: 'video/webm' };
const FILE_RE = /^(\d+)-([a-f0-9]{12})\.(mp4|webm)$/;
const CHANNELS = ['nightly', 'stable'];

// ---------- Сжатие: ролик — это фон без звука, поэтому сервер пережимает его сам ----------
// Без звуковой дорожки, не больше 1080p, H.264 с умеренным битрейтом и moov в начале файла (играет до полной загрузки).
// Клип 81 МБ обычно становится 15–25 МБ. Нет ffmpeg или файл не читается — остаётся оригинал.
const FFMPEG = process.env.NYAO_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.NYAO_FFPROBE || 'ffprobe';
function run(cmd, args, { timeoutMs = 20 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `код ${code}`)); });
  });
}
export async function probeVideo(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeoutMs: 60_000 });
  const j = JSON.parse(out);
  const st = (j.streams || [])[0] || {};
  return { width: Number(st.width) || 0, height: Number(st.height) || 0, durationMs: Math.round(Number(j.format && j.format.duration) * 1000) || 0 };
}
export async function compressVideo(src, dst) {
  await run('nice', ['-n', '10', FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', "scale='min(1920,iw)':-2:flags=bicubic", '-c:v', 'libx264', '-preset', 'medium', '-crf', '26',
    '-maxrate', '3500k', '-bufsize', '7000k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', dst]);
}


/** Ключ для роликов: как у текстов, плюс без хвоста « - Radio Edit / Remastered / Live» — сервисы пишут его по-разному */
const stripTail = (title) => String(title || '').replace(/\s+[-–—]\s+[^-–—]*\b(edit|remaster(ed)?|version|live|mono|stereo)\b[^-–—]*$/i, '');
export function videoKey(artist, title) {
  return looseKey(artist, stripTail(title));
}

/** Ключ названия без исполнителя: сервисы по-разному пишут, кто первый и через что перечислены соавторы */
export function videoTitleKey(title) {
  return soften(norm(stripTail(title)));
}

// «rusino, Hatsune Miku», «Hatsune Miku & rusino», «rusino feat. Hatsune Miku», «rusino x Miku», а ещё «(feat. …)» в названии
const ARTIST_SPLIT = /\s*(?:,|&|;|\/|\+|\s(?:feat|ft|featuring|with|vs|x|and|и)\.?\s)\s*/iu;
/** Все исполнители трека — каждый отдельным нормализованным именем */
export function videoArtists(artist, title = '') {
  const parts = String(artist || '').split(ARTIST_SPLIT);
  const feat = /[([]\s*(?:feat|ft|featuring|with)\.?\s+([^)\]]+)[)\]]|(?:^|\s)(?:feat|ft)\.?\s+(.+)$/iu.exec(String(title || ''));
  if (feat) parts.push(...String(feat[1] || feat[2]).split(ARTIST_SPLIT));
  return new Set(parts.map((p) => soften(norm(p))).filter(Boolean));
}
/** Тот же трек: название совпало и есть хотя бы один общий исполнитель */
export function sameTrack(a, b) {
  if (!a.titleKey || a.titleKey !== b.titleKey) return false;
  for (const x of a.artists) if (b.artists.has(x)) return true;
  return false;
}

/** Тип файла по первым байтам: mp4 («ftyp» на 4-м байте) или webm (EBML) */
export function sniffVideo(head) {
  if (!head || head.length < 12) return null;
  if (head.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
  return null;
}

export function fsvideoStore(dataDir) {
  const dir = path.join(dataDir, 'fsvideo');
  return {
    dir,
    path(name) { return FILE_RE.test(name || '') ? path.join(dir, name) : null; },
    newName(id, ext) { return `${id}-${crypto.randomBytes(6).toString('hex')}.${ext}`; },
    remove(name) {
      const p = this.path(name);
      if (p) fs.rmSync(p, { force: true });
    },
    usage() {
      let n = 0;
      try { for (const f of fs.readdirSync(dir)) n += fs.statSync(path.join(dir, f)).size; } catch { /* папки ещё нет */ }
      return n;
    }
  };
}

const num = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
};

function rowOut(r, publicUrl) {
  return {
    id: String(r.id),
    key: r.track_key,
    artist: r.artist,
    title: r.title,
    mode: r.mode,
    startMs: r.start_ms,
    endMs: r.end_ms,
    offsetMs: r.offset_ms,
    loop: !!r.loop,
    dim: r.dim,
    channels: String(r.channels || '').split(',').filter(Boolean),
    enabled: !!r.enabled,
    // сжатие на сервере: '' — не нужно/нет ffmpeg, processing, done, kept (оригинал и так компактный), failed: …
    proc: r.proc || '',
    origSize: Number(r.orig_size) || 0,
    file: r.file ? { url: `${publicUrl}/media/fsv/${r.file}`, size: Number(r.size) || 0, mime: r.mime, width: r.width, height: r.height, durationMs: r.duration_ms } : null,
    views: Number(r.views) || 0,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime()
  };
}

/** Поля ролика из запроса Автоматора (всё, кроме файла) */
function readMeta(b, HttpError, clip) {
  const artist = clip(String(b.artist || '').trim(), 300);
  const title = clip(String(b.title || '').trim(), 300);
  const key = videoKey(artist, title);
  if (!key) throw new HttpError(400, 'Нужны исполнитель и название трека');
  const mode = b.mode === 'whole' ? 'whole' : 'part';
  const startMs = mode === 'whole' ? 0 : num(b.startMs, 0, 3_600_000, 0);
  const endMs = mode === 'whole' ? 0 : num(b.endMs, 0, 3_600_000, 0);
  if (mode === 'part' && endMs && endMs <= startMs) throw new HttpError(400, 'Конец фрагмента должен быть позже начала');
  const channels = (Array.isArray(b.channels) ? b.channels : ['nightly']).filter((c) => CHANNELS.includes(c));
  return {
    key, artist, title, mode, startMs, endMs,
    offsetMs: num(b.offsetMs, 0, 3_600_000, 0),
    loop: b.loop !== false,
    dim: num(b.dim, 0, 85, 45),
    channels: (channels.length ? channels : ['nightly']).join(','),
    enabled: b.enabled !== false
  };
}

export function fsvideoAdminRoutes({ q, HttpError, readJson, clip, guard, publicUrl = '', dataDir = '/data' }) {
  const store = fsvideoStore(dataDir);
  // по одному ролику за раз: ffmpeg не должен съесть весь процессор сервера
  let queue = Promise.resolve();
  const compressLater = (id, name, origSize) => {
    queue = queue.then(() => compressJob(id, name, origSize)).catch(() => {});
    return queue;
  };
  async function compressJob(id, name, origSize) {
    const src = store.path(name);
    const tmp = path.join(store.dir, `.cmp-${id}-${crypto.randomBytes(4).toString('hex')}.mp4`);
    const still = async () => ((await q('SELECT file FROM fs_videos WHERE id = $1', [id])).rows[0] || {}).file === name;
    try {
      if (!src || !(await still())) return;
      await compressVideo(src, tmp);
      const size = fs.statSync(tmp).size;
      if (!(await still())) return;
      if (!size || size > origSize * 0.9) {
        // выигрыш меньше 10% — оставляем оригинал
        await q("UPDATE fs_videos SET proc = 'kept' WHERE id = $1", [id]);
        return;
      }
      const next = store.newName(id, 'mp4');
      fs.renameSync(tmp, path.join(store.dir, next));
      const meta = await probeVideo(path.join(store.dir, next)).catch(() => null);
      await q(
        `UPDATE fs_videos SET file = $2, size = $3, mime = 'video/mp4', proc = 'done', orig_size = $4,
           width = COALESCE($5, width), height = COALESCE($6, height), duration_ms = COALESCE($7, duration_ms) WHERE id = $1`,
        [id, next, size, origSize, meta && meta.width ? meta.width : null, meta && meta.height ? meta.height : null, meta && meta.durationMs ? meta.durationMs : null]
      );
      store.remove(name);
    } catch (e) {
      // ffmpeg не установлен — просто без сжатия; другая ошибка — видно в Автоматоре, играет оригинал
      const proc = e && e.code === 'ENOENT' ? '' : `failed: ${String((e && e.message) || e).slice(0, 200)}`;
      await q('UPDATE fs_videos SET proc = $2 WHERE id = $1 AND file = $3', [id, proc, name]).catch(() => {});
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  }
  const one = async (id) => {
    const { rows } = await q('SELECT * FROM fs_videos WHERE id = $1', [id]);
    if (!rows.length) throw new HttpError(404, 'Нет такого ролика');
    return rows[0];
  };
  return [
    ['GET', /^\/admin\/fsvideos$/, guard('media.read', async () => {
      const { rows } = await q('SELECT * FROM fs_videos ORDER BY updated_at DESC LIMIT 2000');
      let disk = null;
      try {
        fs.mkdirSync(store.dir, { recursive: true });
        const st = fs.statfsSync(store.dir);
        disk = { used: store.usage(), free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
      } catch { /* нет statfs — не показываем */ }
      return { items: rows.map((r) => rowOut(r, publicUrl)), disk, maxBytes: MAX_VIDEO };
    }), true],

    ['POST', /^\/admin\/fsvideos$/, guard('media.write', async ({ req, s, a }) => {
      const m = readMeta(await readJson(req), HttpError, clip);
      const { rows } = await q(
        `INSERT INTO fs_videos (track_key, artist, title, mode, start_ms, end_ms, offset_ms, loop, dim, channels, enabled, by_user, title_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [m.key, m.artist, m.title, m.mode, m.startMs, m.endMs, m.offsetMs, m.loop, m.dim, m.channels, m.enabled, s.uid, videoTitleKey(m.title)]
      );
      await a.audit('fsvideo.create', { type: 'fsvideo', id: rows[0].id, params: { artist: m.artist, title: m.title, mode: m.mode } });
      return rowOut(rows[0], publicUrl);
    }, { write: true }), true],

    ['PUT', /^\/admin\/fsvideos\/(\d+)$/, guard('media.write', async ({ m: mm, req, a }) => {
      const id = Number(mm[1]);
      await one(id);
      const m = readMeta(await readJson(req), HttpError, clip);
      const { rows } = await q(
        `UPDATE fs_videos SET track_key = $2, artist = $3, title = $4, mode = $5, start_ms = $6, end_ms = $7, offset_ms = $8, loop = $9, dim = $10, channels = $11, enabled = $12, title_key = $13, updated_at = now()
          WHERE id = $1 RETURNING *`,
        [id, m.key, m.artist, m.title, m.mode, m.startMs, m.endMs, m.offsetMs, m.loop, m.dim, m.channels, m.enabled, videoTitleKey(m.title)]
      );
      await a.audit('fsvideo.edit', { type: 'fsvideo', id, params: { mode: m.mode, startMs: m.startMs, endMs: m.endMs, enabled: m.enabled, channels: m.channels } });
      return rowOut(rows[0], publicUrl);
    }, { write: true }), true],

    // файл ролика — сырым телом (video/mp4 или video/webm), потоком на диск; размеры и длительность присылает Автоматор
    ['PUT', /^\/admin\/fsvideos\/(\d+)\/file$/, guard('media.write', async ({ m: mm, req, url, a }) => {
      const id = Number(mm[1]);
      const cur = await one(id);
      const len = Number(req.headers['content-length'] || 0);
      if (len > MAX_VIDEO) throw new HttpError(413, `Ролик больше ${Math.round(MAX_VIDEO / 1048576)} МБ — сожми его (1080p, H.264 или VP9)`);
      fs.mkdirSync(store.dir, { recursive: true });
      const tmp = path.join(store.dir, `.up-${id}-${crypto.randomBytes(4).toString('hex')}`);
      let size = 0;
      let head = Buffer.alloc(0);
      const out = fs.createWriteStream(tmp);
      try {
        await pipeline(req, async function* (src) {
          for await (const chunk of src) {
            size += chunk.length;
            if (size > MAX_VIDEO) throw new HttpError(413, 'Ролик слишком большой');
            if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16)]);
            yield chunk;
          }
        }, out);
      } catch (e) {
        fs.rm(tmp, { force: true }, () => {});
        throw e instanceof HttpError ? e : new HttpError(400, `Загрузка оборвалась: ${e.message}`);
      }
      const ext = sniffVideo(head);
      if (!ext || !size) {
        fs.rm(tmp, { force: true }, () => {});
        throw new HttpError(415, 'Это не видео mp4 или webm');
      }
      const name = store.newName(id, ext);
      fs.renameSync(tmp, path.join(store.dir, name));
      const width = num(url.searchParams.get('w'), 0, 8000, 0);
      const height = num(url.searchParams.get('h'), 0, 8000, 0);
      const durationMs = num(url.searchParams.get('ms'), 0, 3_600_000, 0);
      const { rows } = await q(
        "UPDATE fs_videos SET file = $2, size = $3, mime = $4, width = $5, height = $6, duration_ms = $7, proc = 'processing', orig_size = $3, updated_at = now() WHERE id = $1 RETURNING *",
        [id, name, size, MIME[ext], width, height, durationMs]
      );
      if (cur.file && cur.file !== name) store.remove(cur.file);
      await a.audit('fsvideo.file', { type: 'fsvideo', id, params: { size, mime: MIME[ext], width, height, durationMs } });
      compressLater(id, name, size);
      return rowOut(rows[0], publicUrl);
    }, { write: true }), true],

    ['DELETE', /^\/admin\/fsvideos\/(\d+)$/, guard('media.write', async ({ m: mm, a }) => {
      const id = Number(mm[1]);
      const cur = await one(id);
      await q('DELETE FROM fs_videos WHERE id = $1', [id]);
      if (cur.file) store.remove(cur.file);
      await a.audit('fsvideo.delete', { type: 'fsvideo', id, params: { artist: cur.artist, title: cur.title } });
      return { ok: true };
    }, { write: true }), true]
  ];
}

/** Публичное: есть ли ролик к треку (без входа — только название трека, ничего о пользователе) */
export function fsvideoPublicRoutes({ q, HttpError, clip, publicUrl = '', limit = () => {} }) {
  return [
    ['GET', /^\/media\/fsvideo$/, async ({ url, ip }) => {
      limit(ip);
      const artist = clip(url.searchParams.get('artist'), 300);
      const title = clip(url.searchParams.get('title'), 300);
      const key = videoKey(artist, title);
      if (!key) throw new HttpError(400, 'Нужны artist и title');
      const channel = url.searchParams.get('channel') === 'nightly' ? 'nightly' : 'stable';
      const want = { titleKey: videoTitleKey(title), artists: videoArtists(artist, title) };
      // кандидаты — по названию (и по старому ключу); исполнителей сверяем здесь: любой общий соавтор подходит
      const { rows } = await q(
        `SELECT * FROM fs_videos WHERE (title_key = $1 OR track_key = $2 OR title_key = '') AND enabled = true AND file IS NOT NULL ORDER BY updated_at DESC LIMIT 50`,
        [want.titleKey, key]
      );
      const r = rows.find((x) => String(x.channels || '').split(',').includes(channel)
        && (x.track_key === key || sameTrack(want, { titleKey: videoTitleKey(x.title), artists: videoArtists(x.artist, x.title) })));
      if (!r) return { video: null };
      q('UPDATE fs_videos SET views = views + 1 WHERE id = $1', [r.id]).catch(() => {});
      const o = rowOut(r, publicUrl);
      return { video: { id: o.id, url: o.file.url, mime: o.file.mime, width: o.file.width, height: o.file.height, durationMs: o.file.durationMs, mode: o.mode, startMs: o.startMs, endMs: o.endMs, offsetMs: o.offsetMs, loop: o.loop, dim: o.dim, updatedAt: o.updatedAt } };
    }]
  ];
}

/** Файл ролика потоком, с перемоткой. Имя со случайной частью — можно кешировать навсегда */
export async function serveFsVideo(req, res, store, name, q = null) {
  const file = store.path(name);
  if (file && !fs.existsSync(file) && q) {
    // файл заменили (сервер пережал ролик или загрузили новый), а у плеера старая ссылка — ведём на актуальный
    const { rows } = await q('SELECT file FROM fs_videos WHERE id = $1', [Number(FILE_RE.exec(name)[1])]).catch(() => ({ rows: [] }));
    const cur = rows.length && rows[0].file;
    if (cur && cur !== name && store.path(cur) && fs.existsSync(store.path(cur))) {
      res.writeHead(302, { Location: `/media/fsv/${cur}`, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end();
    }
  }
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end('Нет такого ролика');
  }
  const size = fs.statSync(file).size;
  const ext = FILE_RE.exec(name)[3];
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : size - Number(range[2]);
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!(start >= 0 && start <= end)) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': MIME[ext],
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}
