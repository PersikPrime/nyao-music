// Мини-соцсеть Nyao: ник и профиль, друзья, приглашения (ссылка / QR / касание телефонов),
// «друзья сейчас», присланные треки, приглашения в комнату и реакции. Без переписки — только музыка.
// Приватность по умолчанию: профиль видят только друзья, «невидимка» прячет всё сразу.
import crypto from 'node:crypto';
import { REACTIONS } from './hub.js';

export const NICK_RE = /^[a-z0-9_.]{3,24}$/;
const RESERVED = new Set(['admin', 'nyao', 'nyaomusic', 'support', 'help', 'root', 'system', 'moderator', 'official', 'takko_official']);
const VISIBILITY = ['all', 'friends', 'nobody'];
const NOW_FRESH_MS = 10 * 60_000;
const INVITE_TTL_MS = 7 * 86_400_000;
const INVITE_ABC = 'abcdefghjkmnpqrstuvwxyz23456789';

const rand = (abc, n) => [...crypto.randomBytes(n)].map((x) => abc[x % abc.length]).join('');
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const asObj = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

/** Проверка ника: длина, символы, зарезервированные слова. → текст ошибки или null */
export function nickProblem(nick) {
  const n = String(nick || '').trim().replace(/^@/, '');
  if (n.length < 3) return 'Ник — минимум 3 символа';
  if (n.length > 24) return 'Ник — максимум 24 символа';
  if (!NICK_RE.test(n.toLowerCase())) return 'Только латиница, цифры, точка и _';
  if (/^[._]|[._]$/.test(n) || /\.\./.test(n)) return 'Точка и _ не могут стоять в начале, в конце или подряд';
  if (RESERVED.has(n.toLowerCase()) || /^user_[a-z0-9]{6}$/.test(n.toLowerCase())) return 'Этот ник занят';
  return null;
}

export function socialRoutes({ q, hub, push, HttpError, readJson, clip, cleanTrack, page, publicUrl = '' }) {
  /** Профиль пользователя; если его ещё нет — заводим с ником user_xxxxxx */
  async function ensureProfile(uid) {
    const cur = await q('SELECT * FROM profiles WHERE user_id = $1', [uid]);
    if (cur.rows.length) return cur.rows[0];
    for (let i = 0; i < 10; i++) {
      const nick = `user_${rand('abcdefghijklmnopqrstuvwxyz0123456789', 6)}`;
      try {
        await q('INSERT INTO profiles (user_id, nick, nick_lc) VALUES ($1, $2, $2)', [uid, nick]);
        return (await q('SELECT * FROM profiles WHERE user_id = $1', [uid])).rows[0];
      } catch (e) {
        // гонка двух запросов одного пользователя: профиль уже создан другим запросом
        const again = await q('SELECT * FROM profiles WHERE user_id = $1', [uid]);
        if (again.rows.length) return again.rows[0];
      }
    }
    throw new HttpError(500, 'Не получилось создать профиль');
  }

  async function relation(me, other) {
    if (me === other) return 'self';
    const bl = await q('SELECT user_id FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1)', [me, other]);
    if (bl.rows.some((r) => Number(r.user_id) === me)) return 'blocked';
    if (bl.rows.length) return 'blocked_by';
    const [a, b] = pair(me, other);
    const f = await q('SELECT status, requester FROM friendships WHERE a = $1 AND b = $2', [a, b]);
    if (!f.rows.length) return 'none';
    if (f.rows[0].status === 'friends') return 'friends';
    return Number(f.rows[0].requester) === me ? 'outgoing' : 'incoming';
  }

  /** Маленькая карточка пользователя для списков */
  function card(r) {
    return { id: String(r.user_id ?? r.id), nick: r.nick, name: r.name || '', picture: r.picture || null };
  }

  async function userCard(uid) {
    const { rows } = await q('SELECT u.id, u.name, u.picture, p.nick FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1', [uid]);
    return rows.length ? card(rows[0]) : null;
  }

  /** Что сейчас играет у пользователя (самое свежее устройство), если он это показывает */
  async function nowOf(uid, prof) {
    if (!prof.show_now || prof.invisible) return null;
    const { rows } = await q('SELECT data, updated_at FROM now_playing WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [uid]);
    if (!rows.length) return null;
    const at = new Date(rows[0].updated_at).getTime();
    if (Date.now() - at > NOW_FRESH_MS) return null;
    const d = asObj(rows[0].data);
    if (!d || !d.track) return null;
    return { track: d.track, playing: !!d.playing, updatedAt: at };
  }

  async function topOf(uid) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const { rows } = await q(
      `SELECT track_id, title, artist, cover, listened FROM plays WHERE user_id = $1 AND played_at >= $2 ORDER BY played_at DESC LIMIT 5000`,
      [uid, since]
    );
    const artists = new Map();
    const tracks = new Map();
    let seconds = 0;
    for (const r of rows) {
      seconds += Number(r.listened) || 0;
      const main = String(r.artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
      if (main) artists.set(main, (artists.get(main) || 0) + 1);
      const t = tracks.get(r.track_id) || { trackId: r.track_id, title: r.title, artist: r.artist, cover: r.cover, plays: 0 };
      t.plays++;
      tracks.set(r.track_id, t);
    }
    return {
      minutes: Math.round(seconds / 60),
      plays: rows.length,
      topArtists: [...artists].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([name, plays]) => ({ name, plays })),
      topTracks: [...tracks.values()].sort((x, y) => y.plays - x.plays).slice(0, 5)
    };
  }

  /** Событие другу: сразу на устройства, которые на связи, и push на остальные */
  async function notify(uid, event, pushMsg) {
    hub.pushUser(uid, { type: 'social', ...event });
    if (!push || !pushMsg) return;
    try {
      const { rows } = await q('SELECT session_id, token FROM push_tokens WHERE user_id = $1', [uid]);
      for (const r of rows) {
        if (hub.isOnline(Number(r.session_id))) continue;
        push.send(r.token, pushMsg).catch(async (e) => {
          // токен больше не действует (приложение удалили) — забываем его
          if (e && e.gone) await q('DELETE FROM push_tokens WHERE session_id = $1', [r.session_id]).catch(() => {});
        });
      }
    } catch {}
  }

  async function addInbox(to, from, kind, data) {
    const { rows } = await q('INSERT INTO inbox (to_user, from_user, kind, data) VALUES ($1, $2, $3, $4) RETURNING id, created_at', [to, from, kind, JSON.stringify(data)]);
    return { id: String(rows[0].id), createdAt: new Date(rows[0].created_at).getTime() };
  }

  async function makeFriends(x, y, requester) {
    const [a, b] = pair(x, y);
    await q(
      `INSERT INTO friendships (a, b, status, requester) VALUES ($1, $2, 'friends', $3)
       ON CONFLICT (a, b) DO UPDATE SET status = 'friends'`,
      [a, b, requester]
    );
  }

  async function needFriend(me, other) {
    if ((await relation(me, other)) !== 'friends') throw new HttpError(403, 'Это можно только с друзьями');
  }

  async function findUser(body) {
    if (body.userId) {
      const { rows } = await q('SELECT user_id FROM profiles WHERE user_id = $1', [Number(body.userId) || 0]);
      return rows.length ? Number(rows[0].user_id) : null;
    }
    const nick = String(body.nick || '').trim().replace(/^@/, '').toLowerCase();
    if (!nick) return null;
    const { rows } = await q('SELECT user_id FROM profiles WHERE nick_lc = $1', [nick]);
    return rows.length ? Number(rows[0].user_id) : null;
  }

  function ownProfile(p, s) {
    return {
      ...s.user,
      nick: p.nick, nickSet: !!p.nick_set, bio: p.bio,
      visibility: p.visibility, showNow: p.show_now, showStats: p.show_stats, showLikes: p.show_likes, invisible: p.invisible,
      statusTrack: asObj(p.status_track), pinned: asObj(p.pinned) || []
    };
  }

  // «Друзья сейчас» в реальном времени: при смене трека или паузе друзья на связи получают событие
  const lastNow = new Map(); // uid → 'trackId|playing'
  async function onNow(uid, data) {
    const key = data && data.track ? `${data.track.id}|${!!data.playing}` : '';
    if (lastNow.get(uid) === key) return;
    lastNow.set(uid, key);
    if (lastNow.size > 50_000) lastNow.clear();
    const { rows } = await q('SELECT show_now, invisible FROM profiles WHERE user_id = $1', [uid]);
    if (!rows.length || !rows[0].show_now || rows[0].invisible) return;
    const now = data && data.track ? { track: data.track, playing: !!data.playing, updatedAt: Date.now() } : null;
    for (const f of await friendIds(uid)) hub.pushUser(f, { type: 'social', kind: 'now', user: { id: String(uid) }, now });
  }

  const routes = [
    // ---------- Свой профиль ----------
    ['GET', /^\/profile$/, async ({ s }) => ownProfile(await ensureProfile(s.uid), s), true],
    ['PUT', /^\/profile$/, async ({ s, req }) => {
      const body = await readJson(req);
      const p = await ensureProfile(s.uid);
      const sets = [];
      const vals = [];
      const set = (col, v) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length + 1}`);
      };
      if (body.nick !== undefined) {
        const nick = String(body.nick || '').trim().replace(/^@/, '');
        if (nick.toLowerCase() !== p.nick_lc) {
          const bad = nickProblem(nick);
          if (bad) throw new HttpError(400, bad);
          const taken = await q('SELECT user_id FROM profiles WHERE nick_lc = $1 AND user_id <> $2', [nick.toLowerCase(), s.uid]);
          if (taken.rows.length) throw new HttpError(409, 'Этот ник уже занят');
        }
        set('nick', nick);
        set('nick_lc', nick.toLowerCase());
        set('nick_set', true);
      }
      if (body.bio !== undefined) set('bio', clip(String(body.bio || '').replace(/\s+/g, ' ').trim(), 160));
      if (body.visibility !== undefined) {
        if (!VISIBILITY.includes(body.visibility)) throw new HttpError(400, 'Видимость: all, friends или nobody');
        set('visibility', body.visibility);
      }
      for (const [k, col] of [['showNow', 'show_now'], ['showStats', 'show_stats'], ['showLikes', 'show_likes'], ['invisible', 'invisible']]) {
        if (body[k] !== undefined) set(col, !!body[k]);
      }
      if (body.statusTrack !== undefined) set('status_track', body.statusTrack ? JSON.stringify(cleanTrack(body.statusTrack)) : null);
      if (body.pinned !== undefined) {
        const list = (Array.isArray(body.pinned) ? body.pinned : []).slice(0, 3).map((x) => ({ id: clip(x && x.id, 128), title: clip(x && x.title, 128), cover: x && x.cover ? clip(x.cover, 512) : null, kind: clip(x && x.kind, 16) })).filter((x) => x.id);
        set('pinned', JSON.stringify(list));
      }
      if (sets.length) {
        try {
          await q(`UPDATE profiles SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1`, [s.uid, ...vals]);
        } catch (e) {
          if (/unique|duplicate/i.test(e.message)) throw new HttpError(409, 'Этот ник уже занят');
          throw e;
        }
      }
      // «невидимка» включилась — друзья сразу перестают видеть, что играет
      if (body.invisible === true || body.showNow === false) {
        for (const f of await friendIds(s.uid)) hub.pushUser(f, { type: 'social', kind: 'now', user: { id: String(s.uid) }, now: null });
      }
      return ownProfile(await ensureProfile(s.uid), s);
    }, true],
    ['GET', /^\/nick\/check$/, async ({ s, url }) => {
      const nick = String(url.searchParams.get('nick') || '').trim().replace(/^@/, '');
      const bad = nickProblem(nick);
      if (bad) return { ok: false, error: bad };
      const { rows } = await q('SELECT user_id FROM profiles WHERE nick_lc = $1', [nick.toLowerCase()]);
      if (rows.length && Number(rows[0].user_id) !== s.uid) return { ok: false, error: 'Этот ник уже занят' };
      return { ok: true };
    }, true],

    // ---------- Чужой профиль и поиск ----------
    ['GET', /^\/users\/search$/, async ({ s, url }) => {
      const raw = String(url.searchParams.get('q') || '').trim().replace(/^@/, '').toLowerCase();
      if (raw.length < 2) return { users: [] };
      const like = raw.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
      const { rows } = await q(
        `SELECT u.id, u.name, u.picture, p.nick, p.visibility FROM profiles p JOIN users u ON u.id = p.user_id
          WHERE p.nick_lc LIKE $1 AND p.user_id <> $2 ORDER BY p.nick_lc LIMIT 30`,
        [like, s.uid]
      );
      const out = [];
      for (const r of rows) {
        const rel = await relation(s.uid, Number(r.id));
        if (rel === 'blocked_by' || rel === 'blocked') continue;
        // «никто» не ищется вовсе, кроме точного ника; друзья видят друг друга всегда
        if (r.visibility === 'nobody' && rel !== 'friends' && r.nick.toLowerCase() !== raw) continue;
        out.push({ ...card(r), relation: rel });
        if (out.length >= 20) break;
      }
      return { users: out };
    }, true],
    ['GET', /^\/users\/([A-Za-z0-9_.]{1,24})$/, async ({ s, m }) => {
      const key = m[1].toLowerCase();
      const { rows } = await q(
        `SELECT u.id, u.name, u.picture, p.* FROM profiles p JOIN users u ON u.id = p.user_id WHERE ${/^\d+$/.test(key) ? 'p.user_id = $1' : 'p.nick_lc = $1'}`,
        [/^\d+$/.test(key) ? Number(key) : key]
      );
      if (!rows.length) throw new HttpError(404, 'Такого пользователя нет');
      const p = rows[0];
      const uid = Number(p.user_id);
      const rel = await relation(s.uid, uid);
      if (rel === 'blocked_by') throw new HttpError(404, 'Такого пользователя нет');
      const base = { ...card(p), relation: rel };
      const open = rel === 'self' || rel === 'friends' ? p.visibility !== 'nobody' || rel === 'self' : p.visibility === 'all';
      if (!open || rel === 'blocked') return { ...base, private: true };
      const friendsCount = (await q(`SELECT count(*)::int AS n FROM friendships WHERE (a = $1 OR b = $1) AND status = 'friends'`, [uid])).rows[0].n;
      return {
        ...base,
        private: false,
        bio: p.bio,
        friends: Number(friendsCount) || 0,
        statusTrack: asObj(p.status_track),
        pinned: asObj(p.pinned) || [],
        now: rel === 'friends' || rel === 'self' ? await nowOf(uid, p) : null,
        stats: p.show_stats ? await topOf(uid) : null
      };
    }, true],

    // ---------- Друзья ----------
    ['GET', /^\/friends$/, async ({ s }) => {
      await ensureProfile(s.uid);
      const { rows } = await q(
        `SELECT f.a, f.b, f.status, f.requester, f.created_at, u.id, u.name, u.picture, p.nick, p.show_now, p.invisible
           FROM friendships f
           JOIN users u ON u.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
           JOIN profiles p ON p.user_id = u.id
          WHERE f.a = $1 OR f.b = $1`,
        [s.uid]
      );
      const friends = [];
      const incoming = [];
      const outgoing = [];
      for (const r of rows) {
        const c = card(r);
        if (r.status === 'friends') {
          const now = await nowOf(Number(r.id), r);
          friends.push({ ...c, now, online: !r.invisible && hasOnline(Number(r.id)) });
        } else if (Number(r.requester) === s.uid) outgoing.push(c);
        else incoming.push({ ...c, at: new Date(r.created_at).getTime() });
      }
      // сначала те, кто слушает прямо сейчас
      friends.sort((x, y) => (y.now ? y.now.updatedAt : 0) - (x.now ? x.now.updatedAt : 0) || x.nick.localeCompare(y.nick));
      return { friends, incoming, outgoing };
    }, true],
    ['POST', /^\/friends\/request$/, async ({ s, req }) => {
      const body = await readJson(req);
      const other = await findUser(body);
      if (!other) throw new HttpError(404, 'Такого пользователя нет');
      if (other === s.uid) throw new HttpError(400, 'Это ты сам');
      const rel = await relation(s.uid, other);
      if (rel === 'blocked') throw new HttpError(409, 'Сначала разблокируй этого пользователя');
      if (rel === 'blocked_by') throw new HttpError(404, 'Такого пользователя нет');
      if (rel === 'friends') return { relation: 'friends' };
      if (rel === 'incoming') {
        // встречная заявка — просто принимаем
        await makeFriends(s.uid, other, other);
        const me = await userCard(s.uid);
        await notify(other, { kind: 'friend-accepted', user: me }, { title: 'Теперь вы друзья', body: `${me.name || '@' + me.nick} принял заявку`, data: { kind: 'friend-accepted', user: me.id } });
        return { relation: 'friends' };
      }
      if (rel === 'none') {
        const [a, b] = pair(s.uid, other);
        await q(`INSERT INTO friendships (a, b, status, requester) VALUES ($1, $2, 'pending', $3) ON CONFLICT (a, b) DO NOTHING`, [a, b, s.uid]);
        const me = await userCard(s.uid);
        await notify(other, { kind: 'friend-request', user: me }, { title: 'Заявка в друзья', body: `${me.name || '@' + me.nick} хочет дружить в Nyao`, data: { kind: 'friend-request', user: me.id } });
      }
      return { relation: 'outgoing' };
    }, true],
    ['POST', /^\/friends\/(\d+)\/accept$/, async ({ s, m }) => {
      const other = Number(m[1]);
      if ((await relation(s.uid, other)) !== 'incoming') throw new HttpError(404, 'Заявки нет');
      await makeFriends(s.uid, other, other);
      const me = await userCard(s.uid);
      await notify(other, { kind: 'friend-accepted', user: me }, { title: 'Теперь вы друзья', body: `${me.name || '@' + me.nick} принял заявку`, data: { kind: 'friend-accepted', user: me.id } });
      return { relation: 'friends' };
    }, true],
    // отклонить заявку, отменить свою или удалить из друзей — одно и то же: связь исчезает
    ['DELETE', /^\/friends\/(\d+)$/, async ({ s, m }) => {
      const [a, b] = pair(s.uid, Number(m[1]));
      await q('DELETE FROM friendships WHERE a = $1 AND b = $2', [a, b]);
      return { relation: 'none' };
    }, true],
    ['POST', /^\/blocks\/(\d+)$/, async ({ s, m }) => {
      const other = Number(m[1]);
      if (other === s.uid) throw new HttpError(400, 'Это ты сам');
      const [a, b] = pair(s.uid, other);
      await q('DELETE FROM friendships WHERE a = $1 AND b = $2', [a, b]);
      await q('INSERT INTO blocks (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [s.uid, other]);
      return { relation: 'blocked' };
    }, true],
    ['DELETE', /^\/blocks\/(\d+)$/, async ({ s, m }) => {
      await q('DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2', [s.uid, Number(m[1])]);
      return { relation: 'none' };
    }, true],
    ['GET', /^\/blocks$/, async ({ s }) => {
      const { rows } = await q('SELECT u.id, u.name, u.picture, p.nick FROM blocks bl JOIN users u ON u.id = bl.blocked_id JOIN profiles p ON p.user_id = u.id WHERE bl.user_id = $1', [s.uid]);
      return { users: rows.map(card) };
    }, true],

    // ---------- Приглашения: ссылка, QR, касание телефонов ----------
    ['POST', /^\/invites$/, async ({ s }) => {
      await ensureProfile(s.uid);
      // одна живая ссылка на человека: повторный запрос отдаёт ту же, пока не истекла
      const cur = await q('SELECT code, expires_at FROM invites WHERE user_id = $1 AND expires_at > now() ORDER BY expires_at DESC LIMIT 1', [s.uid]);
      let code = cur.rows[0] && cur.rows[0].code;
      let exp = cur.rows[0] && new Date(cur.rows[0].expires_at).getTime();
      if (!code || exp - Date.now() < 86_400_000) {
        code = rand(INVITE_ABC, 10);
        exp = Date.now() + INVITE_TTL_MS;
        await q('INSERT INTO invites (code, user_id, expires_at) VALUES ($1, $2, $3)', [code, s.uid, new Date(exp)]);
      }
      return { code, url: `${publicUrl}/add/${code}`, expiresAt: exp };
    }, true],
    ['POST', /^\/invites\/([a-z0-9]{6,16})\/use$/, async ({ s, m }) => {
      const { rows } = await q('SELECT user_id FROM invites WHERE code = $1 AND expires_at > now()', [m[1]]);
      if (!rows.length) throw new HttpError(404, 'Приглашение устарело — попроси новое');
      const other = Number(rows[0].user_id);
      if (other === s.uid) return { relation: 'self', user: await userCard(other) };
      const rel = await relation(s.uid, other);
      if (rel === 'blocked' || rel === 'blocked_by') throw new HttpError(409, 'Не получилось добавить');
      await ensureProfile(s.uid);
      if (rel !== 'friends') {
        // открыть приглашение — значит согласиться обоим: его дали лично, заявка не нужна
        await makeFriends(s.uid, other, other);
        const me = await userCard(s.uid);
        await notify(other, { kind: 'friend-accepted', user: me }, { title: 'Новый друг в Nyao', body: `${me.name || '@' + me.nick} добавил тебя по приглашению`, data: { kind: 'friend-accepted', user: me.id } });
      }
      return { relation: 'friends', user: await userCard(other) };
    }, true],
    // ссылка открылась в браузере (у друга нет приложения или Android не перехватил ссылку)
    ['GET', /^\/add\/([a-z0-9]{6,16})$/, async ({ m }) => {
      const { rows } = await q('SELECT u.name, p.nick FROM invites i JOIN users u ON u.id = i.user_id JOIN profiles p ON p.user_id = u.id WHERE i.code = $1 AND i.expires_at > now()', [m[1]]);
      if (!rows.length) return page('Приглашение устарело', 'Попроси друга показать новый QR-код или ссылку.', false);
      return page(`${rows[0].name || '@' + rows[0].nick} зовёт в Nyao Music`, `Установи Nyao Music и открой эту ссылку ещё раз — вы сразу станете друзьями. Ник: @${rows[0].nick}`);
    }],

    // ---------- Музыка друзьям: треки, приглашения в комнату, реакции ----------
    ['POST', /^\/share$/, async ({ s, req }) => {
      const body = await readJson(req);
      const to = Number(body.to) || 0;
      await needFriend(s.uid, to);
      const track = cleanTrack(body.track);
      if (!track) throw new HttpError(400, 'Нет трека');
      const emoji = REACTIONS.includes(body.emoji) ? body.emoji : null;
      const me = await userCard(s.uid);
      const item = await addInbox(to, s.uid, 'track', { track, emoji });
      await notify(to, { kind: 'track', ...item, from: me, track, emoji }, { title: `${me.name || '@' + me.nick} прислал трек${emoji ? ' ' + emoji : ''}`, body: `${track.artist} — ${track.title}`, data: { kind: 'track', inbox: item.id } });
      return { ok: true };
    }, true],
    ['POST', /^\/friends\/(\d+)\/invite$/, async ({ s, m }) => {
      const to = Number(m[1]);
      await needFriend(s.uid, to);
      const room = hub.roomOf(s.sid);
      if (!room) throw new HttpError(409, 'Сначала создай комнату «Вместе»');
      const me = await userCard(s.uid);
      const item = await addInbox(to, s.uid, 'room', { code: room.code });
      await notify(to, { kind: 'room', ...item, from: me, code: room.code }, { title: `${me.name || '@' + me.nick} зовёт слушать вместе`, body: 'Нажми, чтобы присоединиться к комнате', data: { kind: 'room', code: room.code } });
      return { ok: true };
    }, true],
    ['POST', /^\/friends\/(\d+)\/react$/, async ({ s, m, req }) => {
      const to = Number(m[1]);
      await needFriend(s.uid, to);
      const body = await readJson(req);
      if (!REACTIONS.includes(body.emoji)) throw new HttpError(400, 'Такой реакции нет');
      const me = await userCard(s.uid);
      const track = body.track ? cleanTrack(body.track) : null;
      const item = await addInbox(to, s.uid, 'react', { emoji: body.emoji, track });
      await notify(to, { kind: 'react', ...item, from: me, emoji: body.emoji, track }, { title: `${me.name || '@' + me.nick}: ${body.emoji}`, body: track ? `на «${track.title}»` : 'на то, что ты слушаешь', data: { kind: 'react', inbox: item.id } });
      return { ok: true };
    }, true],
    ['GET', /^\/inbox$/, async ({ s }) => {
      const { rows } = await q(
        `SELECT i.id, i.kind, i.data, i.created_at, i.read_at, u.id AS uid, u.name, u.picture, p.nick FROM inbox i
           JOIN users u ON u.id = i.from_user JOIN profiles p ON p.user_id = u.id
          WHERE i.to_user = $1 ORDER BY i.created_at DESC LIMIT 100`,
        [s.uid]
      );
      return {
        items: rows.map((r) => ({ id: String(r.id), kind: r.kind, ...asObj(r.data), from: card({ ...r, id: r.uid }), createdAt: new Date(r.created_at).getTime(), read: !!r.read_at })),
        unread: rows.filter((r) => !r.read_at).length
      };
    }, true],
    ['POST', /^\/inbox\/read$/, async ({ s, req }) => {
      const body = await readJson(req);
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 200);
      if (body.all) await q('UPDATE inbox SET read_at = now() WHERE to_user = $1 AND read_at IS NULL', [s.uid]);
      else for (const id of ids) await q('UPDATE inbox SET read_at = now() WHERE id = $1 AND to_user = $2', [id, s.uid]);
      return { ok: true };
    }, true],

    // ---------- Push ----------
    ['PUT', /^\/push\/token$/, async ({ s, req }) => {
      const body = await readJson(req);
      const token = clip(body.token, 4096);
      if (!token) {
        await q('DELETE FROM push_tokens WHERE session_id = $1', [s.sid]);
        return { ok: true };
      }
      await q(
        `INSERT INTO push_tokens (session_id, user_id, token, platform, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (session_id) DO UPDATE SET token = EXCLUDED.token, platform = EXCLUDED.platform, updated_at = now()`,
        [s.sid, s.uid, token, clip(body.platform, 16)]
      );
      return { ok: true, push: !!push };
    }, true]
  ];
  routes.onNow = onNow;
  return routes;

  async function friendIds(uid) {
    const { rows } = await q(`SELECT a, b FROM friendships WHERE (a = $1 OR b = $1) AND status = 'friends'`, [uid]);
    return rows.map((r) => (Number(r.a) === uid ? Number(r.b) : Number(r.a)));
  }

  function hasOnline(uid) {
    for (const [sid, b] of hub.boxes) if (b.uid === uid && hub.isOnline(sid)) return true;
    return false;
  }
}
