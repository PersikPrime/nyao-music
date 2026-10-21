// HTTP API сервера Nyao Music. Без фреймворков: маршрутов мало, зависимостей меньше — меньше дыр.
import { sharePage, shareRoutes } from './share.js';
import crypto from 'node:crypto';
import { normalizeStatus } from './status.js';
import fs from 'node:fs';
import { pkce } from './telegram.js';
import { Hub } from './hub.js';
import { summarize, periodRange } from './stats.js';
import { socialRoutes } from './social.js';

const LOGIN_TTL = 10 * 60_000;
const MAX_BODY = 512 * 1024;
const KEY_RE = /^[a-z0-9_-]{1,32}$/;
const NOW_FRESH_DAYS = 7;
const CONNECT_CMDS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'volume', 'playTracks', 'like']);
const CODE_RE = /^[A-Z0-9]{6}$/;

/** Трек от клиента → только нужные поля, обрезанные по длине */
export function cleanTrack(t) {
  if (!t || !t.id) return null;
  return { id: clip(t.id, 128), source: clip(t.source, 8), srcId: clip(t.srcId, 128), title: clip(t.title, 256), artist: clip(t.artist, 256), album: clip(t.album, 256), albumId: t.albumId ? clip(t.albumId, 64) : null, duration: Math.round(Number(t.duration) || 0), cover: t.cover ? clip(t.cover, 512) : null };
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
export const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isHtml = typeof body === 'string';
  const data = isHtml ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    ...headers
  });
  res.end(data);
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Тело запроса — не JSON');
  }
}

/** Простой ограничитель: не больше limit запросов за минуту с одного адреса на группу маршрутов */
function limiter(limit) {
  const hits = new Map();
  setInterval(() => hits.clear(), 60_000).unref();
  return (ip) => {
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    if (n > limit) throw new HttpError(429, 'Слишком часто, подожди минутку');
  };
}

export function page(title, text, ok = true, action = null) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Nyao Music</title>
<style>
:root{color-scheme:dark;--bg:#0b0b0f;--card:#16161d;--fg:#f3f1f7;--muted:#9a97a6;--acc:${ok ? '#b69cff' : '#ff7a8a'}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#2a1f4d 0,var(--bg) 60%);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{max-width:420px;width:100%;background:var(--card);border:1px solid #ffffff12;border-radius:28px;padding:36px 28px;text-align:center}
.dot{width:72px;height:72px;margin:0 auto 20px;border-radius:24px;background:var(--acc);display:grid;place-items:center;font-size:36px;color:#0b0b0f}
h1{margin:0 0 8px;font-size:24px}p{margin:0;color:var(--muted)}
.btn{display:inline-block;margin-top:22px;padding:14px 26px;border-radius:999px;background:var(--acc);color:#0b0b0f;font-weight:700;text-decoration:none}
</style></head><body><div class="card"><div class="dot">${ok ? '✓' : '!'}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>${action ? `<a class="btn" href="${esc(action.href)}">${esc(action.label)}</a>` : ''}</div></body></html>`;
}

/** Первая сборка, которая вообще разговаривает с сервером (0.4 (24)) — её считаем у клиентов без заголовка X-Nyao-Build */
export const FIRST_SERVER_BUILD = 24;

/** Номер сборки клиента: заголовок X-Nyao-Build (с 0.5), иначе — 0.4 (24/25) без заголовка */
export function clientBuild(req) {
  const n = Number(req.headers['x-nyao-build']);
  return Number.isInteger(n) && n > 0 ? n : FIRST_SERVER_BUILD;
}

/** minBuild — минимальная разрешённая сборка: старее — сервер просит обновиться (426) */
export function createApp({ db, tg, mirror = null, log = console.log, minBuild = 0, status = null, hub = new Hub(), push = null, publicUrl = '', webUrl = '', webHosts = [], androidCerts = [] }) {
  const logins = new Map(); // state → { verifier, device, platform, at, status, token?, user?, error? }
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of logins) if (now - v.at > LOGIN_TTL) logins.delete(k);
  }, 60_000).unref();
  const authLimit = limiter(30);
  const apiLimit = limiter(600);

  const q = (sql, params) => db.query(sql, params);

  async function auth(req) {
    const h = req.headers.authorization || '';
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(h);
    if (!m) throw new HttpError(401, 'Нужен вход в аккаунт Nyao');
    const { rows } = await q(
      `SELECT s.id AS sid, s.device, s.platform, u.id, u.tg_id, u.name, u.username, u.picture
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
      [sha256(m[1])]
    );
    if (!rows.length) throw new HttpError(401, 'Сессия закончилась, войди заново');
    const r = rows[0];
    q('UPDATE sessions SET last_seen = now() WHERE id = $1', [r.sid]).catch(() => {});
    return { sid: Number(r.sid), uid: Number(r.id), user: publicUser(r), device: r.device, platform: r.platform };
  }

  function publicUser(r) {
    return { id: String(r.id), tgId: String(r.tg_id), name: r.name, username: r.username || null, picture: r.picture || null };
  }

  async function finishLogin(state, profile) {
    const login = logins.get(state);
    const { rows } = await q(
      `INSERT INTO users (tg_id, name, username, picture) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tg_id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username, picture = EXCLUDED.picture
       RETURNING id, tg_id, name, username, picture`,
      [profile.tgId, profile.name, profile.username, profile.picture]
    );
    const user = rows[0];
    const token = newToken();
    await q('INSERT INTO sessions (user_id, token_hash, device, platform) VALUES ($1, $2, $3, $4)', [user.id, sha256(token), login.device, login.platform]);
    Object.assign(login, { status: 'done', token, user: publicUser(user) });
  }

  const social = socialRoutes({ q, hub, push, HttpError, readJson, clip, cleanTrack, page, publicUrl, webUrl, sharePage: (o) => sharePage({ ...o, mirror }) });
  const share = shareRoutes({ q, mirror, androidCerts, webHosts });
  const routes = [
    ['GET', /^\/health$/, async () => ({ ok: true, minBuild, telegram: tg.configured, relay: !String(tg.tokenUrl || '').startsWith('https://oauth.telegram.org') })],
    // техработы и сбои сервисов — приложения спрашивают раз в 2 минуты (без входа и без проверки сборки)
    ['GET', /^\/status$/, async () => (status ? status.get() : normalizeStatus(null))],

    // ---------- Вход ----------
    ['POST', /^\/auth\/start$/, async ({ req, ip }) => {
      authLimit(ip);
      if (!tg.configured) throw new HttpError(503, 'Вход через Telegram ещё не настроен на сервере');
      const body = await readJson(req);
      const state = newToken();
      const { verifier, challenge } = pkce();
      logins.set(state, { verifier, device: clip(body.device, 64) || 'Устройство', platform: clip(body.platform, 16), at: Date.now(), status: 'pending' });
      return { id: state, url: tg.authUrl({ state, challenge }), expiresIn: LOGIN_TTL / 1000 };
    }],
    ['GET', /^\/auth\/telegram\/callback$/, async ({ url, ip }) => {
      authLimit(ip);
      const state = url.searchParams.get('state') || '';
      const login = logins.get(state);
      if (!login || login.status !== 'pending') return page('Ссылка устарела', 'Начни вход заново в Nyao Music.', false);
      const err = url.searchParams.get('error');
      if (err) {
        Object.assign(login, { status: 'error', error: 'Вход отменён' });
        return page('Вход отменён', 'Можно закрыть эту вкладку и попробовать ещё раз.', false);
      }
      try {
        const profile = await tg.exchange(url.searchParams.get('code') || '', login.verifier);
        await finishLogin(state, profile);
        return page(`Привет, ${profile.name}!`, 'Готово — возвращайся в Nyao Music, вкладку можно закрыть.');
      } catch (e) {
        log(`[auth] ${e.message}`);
        if (/abort|timeout|fetch failed|ECONN|ETIMEDOUT/i.test(String(e.message) + String(e.cause && e.cause.code))) {
          Object.assign(login, { status: 'error', error: 'Сервер не достучался до Telegram' });
          return page('Сервер не видит Telegram', 'Вход подтверждён, но сервер Nyao не смог связаться с Telegram. Попробуй позже.', false);
        }
        Object.assign(login, { status: 'error', error: 'Telegram не подтвердил вход' });
        return page('Не получилось', 'Telegram не подтвердил вход. Попробуй ещё раз.', false);
      }
    }],
    ['GET', /^\/auth\/poll$/, async ({ url, ip }) => {
      apiLimit(ip);
      const state = url.searchParams.get('id') || '';
      const login = logins.get(state);
      if (!login) throw new HttpError(410, 'Время входа вышло');
      if (login.status === 'pending') return { status: 'pending' };
      logins.delete(state); // токен отдаём ровно один раз
      if (login.status === 'error') throw new HttpError(400, login.error);
      return { status: 'done', token: login.token, user: login.user };
    }],
    ['POST', /^\/auth\/logout$/, async ({ s }) => {
      await q('DELETE FROM sessions WHERE id = $1', [s.sid]);
      return { ok: true };
    }, true],

    // ---------- Аккаунт и устройства ----------
    ['GET', /^\/me$/, async ({ s }) => {
      const { rows } = await q('SELECT id, device, platform, created_at, last_seen FROM sessions WHERE user_id = $1 ORDER BY last_seen DESC', [s.uid]);
      return {
        user: s.user,
        devices: rows.map((d) => ({ id: String(d.id), device: d.device, platform: d.platform, createdAt: d.created_at, lastSeen: d.last_seen, current: Number(d.id) === s.sid }))
      };
    }, true],
    ['DELETE', /^\/devices\/(\d+)$/, async ({ s, m }) => {
      await q('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [m[1], s.uid]);
      return { ok: true };
    }, true],

    // ---------- История прослушиваний ----------
    ['POST', /^\/history$/, async ({ s, req }) => {
      const body = await readJson(req);
      const plays = (Array.isArray(body.plays) ? body.plays : []).slice(0, 200);
      for (const p of plays) {
        if (!p || !p.trackId) continue;
        const at = new Date(p.playedAt || Date.now());
        if (Number.isNaN(at.getTime())) continue;
        // прослушивание из истории самого сервиса (Spotify «недавно прослушанное»): то же, что уже
        // записал Nyao (или другое устройство уже прислало), не дублируем — ищем этот трек рядом по времени
        if (p.imported) {
          const win = Math.max(0, Math.round(Number(p.duration) || 0)) + 600;
          const { rows } = await q(
            'SELECT 1 FROM plays WHERE user_id = $1 AND track_id = $2 AND played_at BETWEEN $3 AND $4 LIMIT 1',
            [s.uid, clip(p.trackId, 128), new Date(at.getTime() - win * 1000), new Date(at.getTime() + win * 1000)]
          );
          if (rows.length) continue;
        }
        await q(
          `INSERT INTO plays (user_id, session_id, track_id, source, title, artist, cover, duration, listened, skipped, played_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [s.uid, s.sid, clip(p.trackId, 128), clip(p.source, 8), clip(p.title, 256), clip(p.artist, 256), clip(p.cover, 512) || null, Math.max(0, Math.round(Number(p.duration) || 0)), Math.max(0, Math.round(Number(p.listened) || 0)), !!p.skipped, at]
        );
      }
      return { ok: true, saved: plays.length };
    }, true],
    ['GET', /^\/history$/, async ({ s, url }) => {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 7));
      const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit')) || 500));
      const since = new Date(Date.now() - days * 86_400_000);
      const { rows } = await q(
        `SELECT track_id, source, title, artist, cover, duration, listened, skipped, played_at FROM plays
          WHERE user_id = $1 AND played_at >= $2 ORDER BY played_at DESC LIMIT $3`,
        [s.uid, since, limit]
      );
      return {
        plays: rows.map((r) => ({ trackId: r.track_id, source: r.source, title: r.title, artist: r.artist, cover: r.cover, duration: r.duration, listened: r.listened, skipped: r.skipped, playedAt: r.played_at }))
      };
    }, true],

    // ---------- Синхронизируемые данные (настройки волны, миксы…) ----------
    ['GET', /^\/state$/, async ({ s }) => {
      const { rows } = await q('SELECT key, data, updated_at FROM state WHERE user_id = $1', [s.uid]);
      return Object.fromEntries(rows.map((r) => [r.key, { data: r.data, updatedAt: new Date(r.updated_at).getTime() }]));
    }, true],
    ['PUT', /^\/state\/([^/]+)$/, async ({ s, m, req }) => {
      const key = decodeURIComponent(m[1]);
      if (!KEY_RE.test(key)) throw new HttpError(400, 'Плохой ключ');
      const body = await readJson(req);
      if (body.data === undefined) throw new HttpError(400, 'Нет data');
      const at = Number(body.updatedAt) || Date.now();
      // побеждает более свежая запись: старое устройство не затрёт новые изменения
      const cur = await q('SELECT data, updated_at FROM state WHERE user_id = $1 AND key = $2', [s.uid, key]);
      if (cur.rows.length && new Date(cur.rows[0].updated_at).getTime() > at) {
        return { data: cur.rows[0].data, updatedAt: new Date(cur.rows[0].updated_at).getTime(), stale: true };
      }
      await q(
        `INSERT INTO state (user_id, key, data, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [s.uid, key, JSON.stringify(body.data), new Date(at)]
      );
      return { data: body.data, updatedAt: at };
    }, true],

    // ---------- «Сейчас играет» и продолжение на другом устройстве ----------
    ['PUT', /^\/now$/, async ({ s, req }) => {
      const body = await readJson(req);
      const t = body.track;
      if (!t || !t.id) {
        await q('DELETE FROM now_playing WHERE session_id = $1', [s.sid]);
        social.onNow(s.uid, null).catch(() => {});
        return { ok: true };
      }
      const data = {
        track: cleanTrack(t),
        position: Math.max(0, Number(body.position) || 0),
        playing: !!body.playing,
        context: clip(body.context, 32),
        ...(body.volume != null ? { volume: Math.max(0, Math.min(1, Number(body.volume) || 0)) } : {})
      };
      // очередь (откуда играет и что дальше) присылают только при смене трека — иначе оставляем прежнюю
      let queue;
      if (body.queue && Array.isArray(body.queue.tracks)) {
        const tracks = body.queue.tracks.slice(0, 100).map(cleanTrack).filter(Boolean);
        queue = { tracks, index: Math.max(0, Math.min(tracks.length - 1, Number(body.queue.index) || 0)), label: clip(body.queue.label, 128), mode: ['wave', 'radio', 'list'].includes(body.queue.mode) ? body.queue.mode : 'list' };
      } else {
        const cur = await q('SELECT data FROM now_playing WHERE session_id = $1', [s.sid]);
        const old = cur.rows[0] && (typeof cur.rows[0].data === 'string' ? JSON.parse(cur.rows[0].data) : cur.rows[0].data);
        if (old && old.queue && old.track && data.track && old.track.id === data.track.id) queue = old.queue;
      }
      if (queue) data.queue = queue;
      await q(
        `INSERT INTO now_playing (session_id, user_id, data, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (session_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [s.sid, s.uid, JSON.stringify(data)]
      );
      // пульт на других устройствах видит изменения сразу
      const { queue: _q, ...light } = data; // очередь в живые события не кладём — её берут из /connect/devices
      hub.pushUser(s.uid, { type: 'now', deviceId: String(s.sid), device: s.device, platform: s.platform, updatedAt: Date.now(), ...light }, s.sid);
      social.onNow(s.uid, light).catch((e) => log(`[social] now: ${e.message}`));
      return { ok: true };
    }, true],
    ['GET', /^\/now$/, async ({ s }) => {
      const since = new Date(Date.now() - NOW_FRESH_DAYS * 86_400_000);
      const { rows } = await q(
        `SELECT n.session_id, n.data, n.updated_at, ss.device, ss.platform FROM now_playing n JOIN sessions ss ON ss.id = n.session_id
          WHERE n.user_id = $1 AND n.session_id <> $2 AND n.updated_at >= $3 ORDER BY n.updated_at DESC`,
        [s.uid, s.sid, since]
      );
      return { devices: rows.map((r) => ({ deviceId: String(r.session_id), device: r.device, platform: r.platform, updatedAt: new Date(r.updated_at).getTime(), ...r.data })) };
    }, true],

    // ---------- Живые события (длинный опрос) ----------
    ['GET', /^\/events$/, async ({ s, url }) => {
      const cursor = Math.max(0, Number(url.searchParams.get('cursor')) || 0);
      const wait = url.searchParams.get('wait') === '0' ? 0 : undefined;
      return hub.wait(s.sid, s.uid, cursor, wait);
    }, true],

    // ---------- Nyao Connect: пульт для своих устройств ----------
    ['GET', /^\/connect\/devices$/, async ({ s }) => {
      const { rows } = await q(
        `SELECT ss.id, ss.device, ss.platform, ss.last_seen, n.data, n.updated_at FROM sessions ss LEFT JOIN now_playing n ON n.session_id = ss.id
          WHERE ss.user_id = $1 ORDER BY ss.last_seen DESC`,
        [s.uid]
      );
      return {
        devices: rows.map((r) => ({
          deviceId: String(r.id), device: r.device, platform: r.platform, current: Number(r.id) === s.sid,
          online: Number(r.id) === s.sid || hub.isOnline(Number(r.id)),
          ...(r.data ? { ...r.data, updatedAt: new Date(r.updated_at).getTime() } : {})
        }))
      };
    }, true],
    ['POST', /^\/connect\/(\d+)\/cmd$/, async ({ s, m, req }) => {
      const target = Number(m[1]);
      const body = await readJson(req);
      if (!CONNECT_CMDS.has(body.cmd)) throw new HttpError(400, 'Неизвестная команда');
      const { rows } = await q('SELECT id FROM sessions WHERE id = $1 AND user_id = $2', [target, s.uid]);
      if (!rows.length) throw new HttpError(404, 'Нет такого устройства');
      if (target === s.sid) throw new HttpError(400, 'Это и есть это устройство');
      if (!hub.isOnline(target)) throw new HttpError(409, 'Устройство не в сети — открой на нём Nyao Music');
      let args = {};
      if (body.cmd === 'seek') args = { position: Math.max(0, Number(body.args && body.args.position) || 0) };
      if (body.cmd === 'volume') args = { volume: Math.max(0, Math.min(1, Number(body.args && body.args.volume) || 0)) };
      if (body.cmd === 'playTracks') {
        const a = body.args || {};
        const tracks = (Array.isArray(a.tracks) ? a.tracks : []).slice(0, 300).map(cleanTrack).filter(Boolean);
        if (!tracks.length) throw new HttpError(400, 'Нет треков');
        args = { tracks, index: Math.max(0, Math.min(tracks.length - 1, Number(a.index) || 0)), position: Math.max(0, Number(a.position) || 0), title: clip(a.title, 128), play: a.play !== false };
      }
      hub.push(target, { type: 'cmd', cmd: body.cmd, args, from: { deviceId: String(s.sid), device: s.device } });
      return { ok: true };
    }, true],

    // ---------- «Слушать вместе» ----------
    ['GET', /^\/rooms\/current$/, async ({ s }) => {
      const r = hub.roomOf(s.sid);
      return { room: r ? { ...hub.snapshot(r), isHost: r.hostSid === s.sid } : null };
    }, true],
    ['POST', /^\/rooms$/, async ({ s }) => {
      const room = hub.createRoom(s.sid, s.uid, { name: s.user.name || 'Хост', picture: s.user.picture, device: s.device });
      return { room: { ...room, isHost: true } };
    }, true],
    ['POST', /^\/rooms\/([A-Za-z0-9]{6})\/join$/, async ({ s, m }) => {
      let room;
      try {
        room = hub.joinRoom(m[1].toUpperCase(), s.sid, s.uid, { name: s.user.name || 'Гость', picture: s.user.picture });
      } catch (e) {
        throw new HttpError(e.status || 400, e.message);
      }
      if (!room) throw new HttpError(404, 'Комнаты с таким кодом нет — проверь код');
      return { room: { ...room, isHost: hub.roomOf(s.sid).hostSid === s.sid } };
    }, true],
    ['POST', /^\/rooms\/([A-Za-z0-9]{6})\/leave$/, async ({ s, m }) => ({ ok: hub.leaveRoom(m[1].toUpperCase(), s.sid) }), true],
    ['PUT', /^\/rooms\/([A-Za-z0-9]{6})\/state$/, async ({ s, m, req }) => {
      const body = await readJson(req);
      const room = hub.setRoomState(m[1].toUpperCase(), s.sid, { track: cleanTrack(body.track), position: body.position, playing: body.playing });
      if (!room) throw new HttpError(403, 'Управлять может только тот, кто создал комнату');
      return { room: { ...room, isHost: true } };
    }, true],
    ['POST', /^\/rooms\/([A-Za-z0-9]{6})\/react$/, async ({ s, m, req }) => {
      const body = await readJson(req);
      if (!hub.react(m[1].toUpperCase(), s.sid, body.emoji)) throw new HttpError(400, 'Не получилось отправить реакцию');
      return { ok: true };
    }, true],

    // ---------- Итоги ----------
    ['GET', /^\/stats$/, async ({ s, url }) => {
      const period = ['week', 'month', 'year', 'all'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'month';
      const tz = Math.max(-840, Math.min(840, Number(url.searchParams.get('tz')) || 0));
      const year = Number(url.searchParams.get('year')) || null;
      const { from, to } = periodRange(period, { tz, year: year && year > 2000 && year < 3000 ? year : null });
      const { rows } = await q(
        `SELECT track_id, source, title, artist, cover, duration, listened, skipped, played_at FROM plays
          WHERE user_id = $1 AND played_at >= $2 AND played_at < $3 ORDER BY played_at LIMIT 300000`,
        [s.uid, new Date(from), new Date(to)]
      );
      return { period, from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...summarize(rows, { tz }) };
    }, true],

    // ---------- Обновления ----------
    ['GET', /^\/updates\/latest$/, async () => {
      const rel = mirror && mirror.latest();
      if (!rel) throw new HttpError(503, 'Сервер ещё не знает о релизах');
      return { ...rel, min_build: minBuild };
    }],
    ...social,
    ...share
  ];

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // за Cloudflare настоящий адрес — в CF-Connecting-IP (иначе все запросы были бы «с одного IP» Cloudflare)
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (req.method === 'OPTIONS') return send(res, 204, '');
    try {
      // файлы зеркала отдаём потоком, с поддержкой докачки
      const dl = /^\/dl\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (dl && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(req, res, mirror && mirror.file(dl[1], dl[2]));
      for (const [method, re, fn, needAuth] of routes) {
        const m = re.exec(url.pathname);
        if (!m || method !== req.method) continue;
        let s = null;
        if (needAuth) {
          apiLimit(ip);
          // слишком старая сборка: синхронизацию не даём, просим обновиться
          if (minBuild && clientBuild(req) < minBuild) {
            const e = new HttpError(426, 'Эта версия Nyao Music устарела — обнови приложение в настройках');
            e.extra = { minBuild };
            throw e;
          }
          s = await auth(req);
        }
        const out = await fn({ req, res, url, m, s, ip });
        return send(res, 200, out);
      }
      throw new HttpError(404, 'Нет такого адреса');
    } catch (e) {
      if (!(e instanceof HttpError)) log(`[api] ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      return send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Ошибка сервера', ...(e.extra || {}) });
    }
  };
}

function serveFile(req, res, file) {
  if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'Файла нет' });
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : size - Number(range[2]);
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start < 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
  }
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename="${file.split(/[\\/]/).pop()}"`,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file, { start, end }).pipe(res);
}
