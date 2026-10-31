// Admin API для Nyao Automator. Все маршруты /admin/* — с входом и проверкой права на сервере;
// каждое изменяющее действие — в журнал admin_audit. Роли приходят из ADMIN_IDS («tgId:роль, …»),
// без них все из DEV_IDS считаются владельцами.
import fs from 'node:fs';
import { SERVICES } from './status.js';
import { WORKFLOWS } from './github.js';
import { lyricsAdminRoutes } from './admin-lyrics.js';
import { labelRoutes } from './admin-label.js';
import { pushAdminRoutes } from './admin-push.js';
import { profileAdminRoutes } from './admin-profiles.js';

export const PERMISSIONS = [
  'users.read', 'users.sessions', 'users.edit', 'users.ban',
  'status.read', 'status.write',
  'releases.read', 'builds.run', 'mirror.write', 'notes.write',
  'lyrics.read', 'lyrics.review', 'lyrics.roles', 'lyrics.reports', 'lyrics.edit', 'lyrics.export',
  'label.read', 'label.write',
  'server.read', 'logs.read', 'ops.restart', 'ops.deploy', 'ops.logs',
  'push.read', 'push.test', 'push.broadcast',
  'audit.read', 'audit.all',
  'stats.read', 'automator.read',
  'profiles.read', 'profiles.moderate'
];

const all = () => [...PERMISSIONS];
const reads = () => PERMISSIONS.filter((p) => p.endsWith('.read') || p === 'audit.all');
export const ROLES = {
  owner: all(),
  admin: all().filter((p) => !['lyrics.roles', 'ops.deploy', 'ops.restart'].includes(p)),
  support: ['users.read', 'users.sessions', 'status.read', 'audit.read', 'automator.read', 'profiles.read', 'profiles.moderate'],
  // назначать роли LyricLabs может только владелец
  lyrics: [...PERMISSIONS.filter((p) => p.startsWith('lyrics.') && p !== 'lyrics.roles'), 'audit.read', 'automator.read'],
  label: [...PERMISSIONS.filter((p) => p.startsWith('label.')), 'audit.read', 'automator.read'],
  viewer: [...reads(), 'automator.read']
};

/** «111:owner,222:lyrics» → Map tgId → роль. Без списка — devIds становятся owner */
export function parseAdminIds(raw, devIds = []) {
  const map = new Map();
  for (const part of String(raw || '').split(/[,\s]+/)) {
    const [id, role] = part.split(':').map((x) => x.trim());
    if (/^\d{3,20}$/.test(id || '') && ROLES[role]) map.set(id, role);
  }
  if (!map.size) for (const id of devIds) if (/^\d{3,20}$/.test(String(id))) map.set(String(id), 'owner');
  return map;
}

const SECRET_KEYS = /token|secret|password|key|cookie|authorization/i;
/** Параметры для журнала: без секретов и без простыней текста */
export function cleanParams(p) {
  if (!p || typeof p !== 'object') return p ?? null;
  if (Array.isArray(p)) return p.slice(0, 200).map(cleanParams);
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    if (SECRET_KEYS.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 500) : v && typeof v === 'object' ? cleanParams(v) : v;
  }
  return out;
}

/** Ограничитель на сессию: не больше limit запросов за окно windowMs */
function sessionLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (sid) => {
    const now = Date.now();
    let h = hits.get(sid);
    if (!h || now - h.start > windowMs) {
      h = { start: now, n: 0 };
      hits.set(sid, h);
    }
    if (++h.n > limit) return false;
    return true;
  };
}

/** Список целых id прямо в SQL (pg-mem не ищет по «= ANY(массив)» на первичном ключе); пустой список — ни одной строки */
export const idList = (ids) => {
  const safe = [...new Set((ids || []).map(Number).filter((x) => Number.isInteger(x) && x >= 0))];
  return safe.length ? `IN (${safe.join(',')})` : 'IN (-1)';
};

const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const cursorOf = (v) => Math.max(0, Math.floor(num(v)));

/**
 * ctx: { q, HttpError, readJson, clip, adminIds (Map), status (StatusFile), cfg ({ minBuild }), mirror, github, push,
 *        logs (LogBuffer), log, dataDir, publicUser, setMinBuild }
 * Возвращает { routes, init(), tick() }
 */
export function adminRoutes(ctx) {
  const { q, HttpError, readJson, clip, adminIds, status, cfg, mirror, github, logs, log = () => {}, dataDir = '/data' } = ctx;
  const limit = sessionLimiter(30, 10_000);
  const dangerLimit = sessionLimiter(20, 60_000);

  function roleOf(s) {
    const role = adminIds.get(String(s.user.tgId));
    return role || null;
  }

  async function audit(s, action, { type = '', id = '', params = null, result = 'ok', ip = '' } = {}, role = null) {
    try {
      await q(
        'INSERT INTO admin_audit (admin_id, admin_tg, role, action, target_type, target_id, params, result, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [s ? s.uid : null, s ? String(s.user.tgId) : '', role || (s ? roleOf(s) : '') || '', action, String(type), String(id ?? ''), params == null ? null : JSON.stringify(cleanParams(params)), result, String(ip || '').slice(0, 64)]
      );
    } catch (e) {
      log(`[admin] журнал: ${e.message}`);
    }
  }

  /** Маршрут с проверкой права. write = true — действие изменяющее: отдельный лимит и запись в журнал через a.audit */
  function guard(perm, fn, { write = false } = {}) {
    return async (c) => {
      const { s, ip, url } = c;
      const role = roleOf(s);
      if (!role) {
        await audit(s, 'attempt', { type: 'route', id: url.pathname, result: 'denied', ip }, '');
        throw new HttpError(403, 'Нет доступа к Nyao Automator');
      }
      if (!limit(s.sid)) throw new HttpError(429, 'Слишком много запросов — подожди пару секунд');
      const perms = ROLES[role];
      if (perm && !perms.includes(perm)) {
        await audit(s, 'attempt', { type: 'permission', id: perm, params: { path: url.pathname }, result: 'denied', ip }, role);
        throw new HttpError(403, `Недостаточно прав (${perm})`);
      }
      if (write && !dangerLimit(s.sid)) throw new HttpError(429, 'Слишком много изменений подряд — подожди минуту');
      const a = {
        role,
        perms,
        audit: (action, target = {}) => audit(s, action, { ...target, ip }, role)
      };
      return fn({ ...c, a });
    };
  }

  // ---------- настройки в базе ----------
  async function getSetting(key, def = null) {
    const { rows } = await q('SELECT value FROM app_settings WHERE key = $1', [key]);
    if (!rows.length) return def;
    const v = rows[0].value;
    return typeof v === 'string' ? JSON.parse(v) : v;
  }
  async function setSetting(key, value) {
    await q(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    );
  }

  async function init() {
    try {
      const mb = await getSetting('min_build');
      if (mb && Number(mb.value) > 0) cfg.minBuild = Number(mb.value);
    } catch (e) {
      log(`[admin] настройки: ${e.message}`);
    }
  }

  // ---------- расписание техработ ----------
  async function tick(now = new Date()) {
    if (!status) return;
    try {
      const planned = await q(`SELECT * FROM status_schedule WHERE state = 'planned' AND start_at <= $1 ORDER BY start_at`, [now]);
      for (const r of planned.rows) {
        const m = typeof r.maintenance === 'string' ? JSON.parse(r.maintenance) : r.maintenance;
        const cur = status.get();
        const next = status.set({ ...cur, maintenance: { ...m, active: true } });
        await q(`UPDATE status_schedule SET state = 'active' WHERE id = $1`, [r.id]);
        await q('INSERT INTO status_history (by_user, data) VALUES ($1, $2)', [r.by_user, JSON.stringify({ ...next, scheduled: Number(r.id) })]);
        log(`[status] по расписанию: техработы включены (№${r.id})`);
      }
      const active = await q(`SELECT * FROM status_schedule WHERE state = 'active' AND end_at IS NOT NULL AND end_at <= $1`, [now]);
      for (const r of active.rows) {
        const cur = status.get();
        const next = status.set({ ...cur, maintenance: { active: false } });
        await q(`UPDATE status_schedule SET state = 'done' WHERE id = $1`, [r.id]);
        await q('INSERT INTO status_history (by_user, data) VALUES ($1, $2)', [r.by_user, JSON.stringify({ ...next, scheduled: Number(r.id) })]);
        log(`[status] по расписанию: техработы выключены (№${r.id})`);
      }
    } catch (e) {
      log(`[admin] расписание: ${e.message}`);
    }
  }

  const userRow = (r) => ({ id: String(r.id), tgId: String(r.tg_id), name: r.name, username: r.username || null, picture: r.picture || null, createdAt: r.created_at });

  /** Сессии пользователей (для списка и карточки) */
  async function sessionsOf(ids) {
    if (!ids.length) return new Map();
    const { rows } = await q(`SELECT id, user_id, device, platform, build, created_at, last_seen FROM sessions WHERE user_id ${idList(ids)} ORDER BY last_seen DESC`);
    const map = new Map();
    for (const r of rows) {
      const list = map.get(String(r.user_id)) || [];
      list.push({ id: String(r.id), device: r.device, platform: r.platform, build: r.build == null ? null : Number(r.build), createdAt: r.created_at, lastSeen: r.last_seen });
      map.set(String(r.user_id), list);
    }
    return map;
  }

  const routes = [
    // ---------- 7.1 Общее ----------
    ['GET', /^\/admin\/me$/, guard(null, async ({ s, a }) => ({ user: s.user, role: a.role, permissions: a.perms, server: { minBuild: cfg.minBuild, github: !!(github && github.configured), push: !!ctx.push } })), true],

    // ---------- 7.2 Пользователи ----------
    ['GET', /^\/admin\/users$/, guard('users.read', async ({ url }) => {
      const p = url.searchParams;
      const qs = String(p.get('q') || '').trim();
      const platform = clip(p.get('platform') || '', 16);
      const buildLt = num(p.get('build_lt'));
      const activeSince = p.get('active_since') ? new Date(p.get('active_since')) : null;
      const banned = p.get('banned') === '1';
      const lim = Math.min(500, Math.max(1, num(p.get('limit'), 100)));
      const offset = cursorOf(p.get('cursor'));
      const where = [];
      const params = [];
      if (qs) {
        params.push(`%${qs.toLowerCase()}%`, qs);
        where.push(`(lower(u.name) LIKE $${params.length - 1} OR lower(coalesce(u.username, '')) LIKE $${params.length - 1} OR u.tg_id = $${params.length} OR CAST(u.id AS TEXT) = $${params.length})`);
      }
      if (platform) {
        params.push(platform);
        where.push(`u.id IN (SELECT sx.user_id FROM sessions sx WHERE sx.platform = $${params.length})`);
      }
      if (buildLt > 0) {
        // «версия ниже N» — по самой новой сессии пользователя
        const mx = await q('SELECT user_id, max(build) AS b FROM sessions GROUP BY user_id');
        where.push(`u.id ${idList(mx.rows.filter((r) => r.b != null && Number(r.b) < buildLt).map((r) => r.user_id))}`);
      }
      if (activeSince && !Number.isNaN(activeSince.getTime())) {
        params.push(activeSince);
        where.push(`u.id IN (SELECT sa.user_id FROM sessions sa WHERE sa.last_seen >= $${params.length})`);
      }
      if (banned) where.push('u.id IN (SELECT ub.user_id FROM user_bans ub)');
      const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = await q(`SELECT count(*) AS n FROM users u ${sql}`, params);
      const { rows } = await q(`SELECT u.* FROM users u ${sql} ORDER BY u.id DESC LIMIT ${lim} OFFSET ${offset}`, params);
      const ids = rows.map((r) => Number(r.id));
      const sess = await sessionsOf(ids);
      const since30 = new Date(Date.now() - 30 * 86_400_000);
      const [bans, profiles, plays, friends] = ids.length
        ? await Promise.all([
            q(`SELECT user_id, reason, at FROM user_bans WHERE user_id ${idList(ids)}`),
            q(`SELECT user_id, nick, invisible, visibility FROM profiles WHERE user_id ${idList(ids)}`),
            q(`SELECT user_id, count(*) AS n FROM plays WHERE user_id ${idList(ids)} AND played_at >= $1 GROUP BY user_id`, [since30]),
            q(`SELECT a, b FROM friendships WHERE status = 'friends' AND (a ${idList(ids)} OR b ${idList(ids)})`)
          ])
        : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
      const banMap = new Map(bans.rows.map((r) => [String(r.user_id), r]));
      const profMap = new Map(profiles.rows.map((r) => [String(r.user_id), r]));
      const playMap = new Map(plays.rows.map((r) => [String(r.user_id), Number(r.n)]));
      const friendCount = new Map();
      for (const f of friends.rows) for (const k of [String(f.a), String(f.b)]) friendCount.set(k, (friendCount.get(k) || 0) + 1);
      const items = rows.map((r) => {
        const ss = sess.get(String(r.id)) || [];
        const pr = profMap.get(String(r.id));
        const ban = banMap.get(String(r.id));
        const builds = ss.map((x) => x.build).filter((x) => x != null);
        return {
          ...userRow(r),
          nick: pr ? pr.nick : null,
          invisible: !!(pr && pr.invisible),
          dev: !!(s0(ctx.devIds).has(String(r.tg_id))),
          admin: adminIds.get(String(r.tg_id)) || null,
          lastSeen: ss[0] ? ss[0].lastSeen : null,
          platforms: [...new Set(ss.map((x) => x.platform).filter(Boolean))],
          build: builds.length ? Math.max(...builds) : null,
          sessions: ss.length,
          friends: friendCount.get(String(r.id)) || 0,
          plays30: playMap.get(String(r.id)) || 0,
          banned: ban ? { reason: ban.reason, at: ban.at } : null
        };
      });
      return { items, total: Number(total.rows[0].n), cursor: offset + rows.length < Number(total.rows[0].n) ? String(offset + rows.length) : null, minBuild: cfg.minBuild };
    }), true],

    ['GET', /^\/admin\/users\/(\d+)$/, guard('users.read', async ({ m }) => {
      const id = Number(m[1]);
      const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
      if (!rows.length) throw new HttpError(404, 'Нет такого пользователя');
      const u = rows[0];
      const since30 = new Date(Date.now() - 30 * 86_400_000);
      const [sess, prof, ban, fr, st, pl, au, lyricsRole] = await Promise.all([
        sessionsOf([id]),
        q('SELECT * FROM profiles WHERE user_id = $1', [id]),
        q('SELECT * FROM user_bans WHERE user_id = $1', [id]),
        q(`SELECT f.a, f.b, f.status, f.requester, f.created_at, ua.name AS a_name, ua.username AS a_username, ub.name AS b_name, ub.username AS b_username
             FROM friendships f JOIN users ua ON ua.id = f.a JOIN users ub ON ub.id = f.b WHERE f.a = $1 OR f.b = $1 ORDER BY f.created_at DESC`, [id]),
        q('SELECT key, updated_at, data FROM state WHERE user_id = $1 ORDER BY key', [id]),
        q('SELECT source, artist, listened, played_at FROM plays WHERE user_id = $1 AND played_at >= $2 ORDER BY played_at DESC LIMIT 20000', [id, since30]),
        q(`SELECT * FROM admin_audit WHERE target_type = 'user' AND target_id = $1 ORDER BY at DESC LIMIT 200`, [String(id)]),
        q('SELECT role FROM lyrics_roles WHERE user_id = $1', [id])
      ]);
      const bySource = {};
      const byArtist = new Map();
      let minutes = 0;
      for (const p of pl.rows) {
        bySource[p.source || '?'] = (bySource[p.source || '?'] || 0) + 1;
        const art = String(p.artist || '').split(/,\s+|\s+(?:feat|ft)\.?\s+/i)[0].trim() || '—';
        byArtist.set(art, (byArtist.get(art) || 0) + 1);
        minutes += (Number(p.listened) || 0) / 60;
      }
      const p = prof.rows[0];
      return {
        user: { ...userRow(u), dev: s0(ctx.devIds).has(String(u.tg_id)), admin: adminIds.get(String(u.tg_id)) || null, lyricsRole: lyricsRole.rows[0] ? lyricsRole.rows[0].role : null },
        profile: p ? { nick: p.nick, nickSet: !!p.nick_set, bio: p.bio, visibility: p.visibility, invisible: !!p.invisible, showNow: !!p.show_now, showStats: !!p.show_stats, allowDuo: p.allow_duo !== false, updatedAt: p.updated_at } : null,
        banned: ban.rows[0] ? { reason: ban.rows[0].reason, at: ban.rows[0].at, by: ban.rows[0].by_user == null ? null : String(ban.rows[0].by_user) } : null,
        sessions: sess.get(String(id)) || [],
        friends: fr.rows.map((f) => {
          const other = Number(f.a) === id ? { id: String(f.b), name: f.b_name, username: f.b_username } : { id: String(f.a), name: f.a_name, username: f.a_username };
          return { ...other, status: f.status, incoming: f.status === 'pending' && Number(f.requester) !== id, since: f.created_at };
        }),
        // только размеры: содержимое миксов и настроек админу не показываем
        state: st.rows.map((r) => ({ key: r.key, updatedAt: r.updated_at, size: (typeof r.data === 'string' ? r.data : JSON.stringify(r.data) || '').length })),
        plays: { days: 30, count: pl.rows.length, minutes: Math.round(minutes), bySource, topArtists: [...byArtist].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([artist, n]) => ({ artist, n })) },
        audit: au.rows.map(auditRow)
      };
    }), true],

    ['POST', /^\/admin\/users\/(\d+)\/sessions\/revoke$/, guard('users.sessions', async ({ m, req, a }) => {
      const id = Number(m[1]);
      const b = await readJson(req);
      const sid = b.sessionId ? Number(b.sessionId) : null;
      const r = sid
        ? await q('DELETE FROM sessions WHERE user_id = $1 AND id = $2', [id, sid])
        : await q('DELETE FROM sessions WHERE user_id = $1', [id]);
      await a.audit('users.sessions.revoke', { type: 'user', id, params: { sessionId: sid, removed: r.rowCount } });
      return { ok: true, removed: r.rowCount ?? null };
    }, { write: true }), true],

    ['POST', /^\/admin\/users\/(\d+)\/ban$/, guard('users.ban', async ({ m, req, s, a }) => {
      const id = Number(m[1]);
      const b = await readJson(req);
      const reason = clip(String(b.reason || '').trim(), 500);
      if (!reason) throw new HttpError(400, 'Укажи причину блокировки');
      if (id === s.uid) throw new HttpError(400, 'Себя заблокировать нельзя');
      const u = await q('SELECT tg_id FROM users WHERE id = $1', [id]);
      if (!u.rows.length) throw new HttpError(404, 'Нет такого пользователя');
      if (adminIds.has(String(u.rows[0].tg_id))) throw new HttpError(400, 'Админов Automator блокировать нельзя — сначала убери роль');
      await q('INSERT INTO user_bans (user_id, reason, by_user) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, by_user = EXCLUDED.by_user, at = now()', [id, reason, s.uid]);
      await q('DELETE FROM sessions WHERE user_id = $1', [id]);
      await a.audit('users.ban', { type: 'user', id, params: { reason } });
      return { ok: true };
    }, { write: true }), true],

    ['POST', /^\/admin\/users\/(\d+)\/unban$/, guard('users.ban', async ({ m, a }) => {
      const id = Number(m[1]);
      const r = await q('DELETE FROM user_bans WHERE user_id = $1', [id]);
      await a.audit('users.unban', { type: 'user', id, params: { was: r.rowCount } });
      return { ok: true };
    }, { write: true }), true],

    ['POST', /^\/admin\/users\/(\d+)\/profile$/, guard('users.edit', async ({ m, req, a }) => {
      const id = Number(m[1]);
      const b = await readJson(req);
      const { rows } = await q('SELECT * FROM profiles WHERE user_id = $1', [id]);
      if (!rows.length) throw new HttpError(404, 'У пользователя ещё нет профиля');
      const changes = {};
      if (b.nick === null) {
        // сброс ника: временный служебный ник, при следующем входе приложение попросит выбрать новый
        const tmp = `user${id}`;
        await q('UPDATE profiles SET nick = $1, nick_lc = $2, nick_set = false, updated_at = now() WHERE user_id = $3', [tmp, tmp.toLowerCase(), id]);
        changes.nick = 'reset';
      }
      if (typeof b.invisible === 'boolean') {
        await q('UPDATE profiles SET invisible = $1, updated_at = now() WHERE user_id = $2', [b.invisible, id]);
        changes.invisible = b.invisible;
      }
      if (typeof b.visibility === 'string' && ['everyone', 'friends', 'nobody'].includes(b.visibility)) {
        await q('UPDATE profiles SET visibility = $1, updated_at = now() WHERE user_id = $2', [b.visibility, id]);
        changes.visibility = b.visibility;
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'Нечего менять: nick: null, invisible: true/false или visibility');
      await a.audit('users.profile', { type: 'user', id, params: changes });
      return { ok: true, changes };
    }, { write: true }), true],

    // ---------- 7.3 Статус ----------
    ['GET', /^\/admin\/status$/, guard('status.read', async () => {
      const sch = await q(`SELECT * FROM status_schedule WHERE state <> 'done' ORDER BY start_at`);
      return { status: status ? status.get() : null, minBuild: cfg.minBuild, minBuildEnv: cfg.minBuildEnv || 0, services: [...SERVICES], schedule: sch.rows.map(scheduleRow) };
    }), true],

    ['PUT', /^\/admin\/status$/, guard('status.write', async ({ req, s, a }) => {
      if (!status) throw new HttpError(503, 'Файл статуса не настроен на сервере');
      const b = await readJson(req);
      const cur = status.get();
      const next = status.set({
        maintenance: b.maintenance !== undefined ? b.maintenance : cur.maintenance,
        outages: b.outages !== undefined ? b.outages : cur.outages
      });
      let minBuild = cfg.minBuild;
      if (b.minBuild !== undefined) {
        minBuild = Math.max(0, Math.floor(num(b.minBuild)));
        await setSetting('min_build', { value: minBuild });
        cfg.minBuild = minBuild;
      }
      await q('INSERT INTO status_history (by_user, data) VALUES ($1, $2)', [s.uid, JSON.stringify({ ...next, minBuild })]);
      await a.audit('status.write', { type: 'status', id: 'current', params: { maintenance: next.maintenance, outages: next.outages, minBuild } });
      return { status: next, minBuild };
    }, { write: true }), true],

    ['GET', /^\/admin\/status\/history$/, guard('status.read', async ({ url }) => {
      const lim = Math.min(500, Math.max(1, num(url.searchParams.get('limit'), 100)));
      const { rows } = await q(`SELECT h.id, h.at, h.by_user, h.data, u.name, u.username FROM status_history h LEFT JOIN users u ON u.id = h.by_user ORDER BY h.at DESC LIMIT ${lim}`);
      return { items: rows.map((r) => ({ id: String(r.id), at: r.at, by: r.by_user == null ? null : { id: String(r.by_user), name: r.name, username: r.username }, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data })) };
    }), true],

    ['POST', /^\/admin\/status\/schedule$/, guard('status.write', async ({ req, s, a }) => {
      const b = await readJson(req);
      const at = new Date(b.at);
      if (Number.isNaN(at.getTime())) throw new HttpError(400, 'at — дата и время включения (ISO)');
      const dur = Math.max(0, Math.floor(num(b.durationMin)));
      const m = b.maintenance && typeof b.maintenance === 'object' ? b.maintenance : {};
      const maintenance = { title: clip(m.title || '', 80), text: clip(m.text || '', 400), until: clip(m.until || '', 60) };
      const { rows } = await q(
        'INSERT INTO status_schedule (start_at, end_at, maintenance, by_user) VALUES ($1, $2, $3, $4) RETURNING *',
        [at, dur ? new Date(at.getTime() + dur * 60_000) : null, JSON.stringify(maintenance), s.uid]
      );
      await a.audit('status.schedule', { type: 'schedule', id: rows[0].id, params: { at: at.toISOString(), durationMin: dur, maintenance } });
      return { item: scheduleRow(rows[0]) };
    }, { write: true }), true],

    ['DELETE', /^\/admin\/status\/schedule\/(\d+)$/, guard('status.write', async ({ m, a }) => {
      const r = await q(`DELETE FROM status_schedule WHERE id = $1 AND state <> 'done'`, [m[1]]);
      if (!r.rowCount) throw new HttpError(404, 'Нет такого расписания');
      await a.audit('status.schedule.delete', { type: 'schedule', id: m[1] });
      return { ok: true };
    }, { write: true }), true],

    // ---------- 7.4 Релизы ----------
    ['GET', /^\/admin\/releases$/, guard('releases.read', async ({ url }) => {
      const channel = url.searchParams.get('channel');
      let list = [];
      let error = null;
      try {
        list = github ? await github.releases(40) : [];
      } catch (e) {
        error = e.message;
      }
      if (channel && ['stable', 'dev', 'nightly'].includes(channel)) list = list.filter((r) => r.channel === channel);
      // сколько пользователей на каждой сборке (по последней сессии пользователя за 30 дней)
      const dist = await buildDistribution();
      const byBuild = new Map();
      for (const d of dist) byBuild.set(d.build, (byBuild.get(d.build) || 0) + d.users);
      const latest = mirror ? mirror.latest() : null;
      return {
        items: list.map((r) => ({
          ...r,
          users: byBuild.get(r.build) || 0,
          hot: r.assets.some((x) => x.name.endsWith('.nui')),
          signed: r.assets.some((x) => x.name.endsWith('.nui')) && r.assets.some((x) => x.name.endsWith('.nui.sig')),
          mirrored: latest && latest.tag_name === r.tag ? latest.mirrored : null
        })),
        distribution: dist,
        error
      };
    }), true],

    ['GET', /^\/admin\/releases\/distribution$/, guard('releases.read', async () => ({ items: await buildDistribution() })), true],

    ['POST', /^\/admin\/builds$/, guard('builds.run', async ({ req, a }) => {
      needGithub();
      const b = await readJson(req);
      const wf = String(b.workflow || '');
      if (!['desktop', 'android', 'server'].includes(wf)) throw new HttpError(400, 'workflow: desktop, android или server');
      const ref = clip(String(b.ref || 'main').trim(), 100);
      if (!/^[\w./-]+$/.test(ref)) throw new HttpError(400, 'Странное имя ветки');
      try {
        await github.dispatch(wf, ref);
      } catch (e) {
        await a.audit('builds.run', { type: 'workflow', id: wf, params: { ref }, result: `error: ${e.message}` });
        throw new HttpError(502, e.message);
      }
      await a.audit('builds.run', { type: 'workflow', id: wf, params: { ref } });
      return { ok: true, workflow: WORKFLOWS[wf], ref };
    }, { write: true }), true],

    ['GET', /^\/admin\/builds$/, guard('releases.read', async ({ url }) => {
      needGithub();
      const wf = url.searchParams.get('workflow');
      try {
        return { items: await github.runs({ workflow: wf && WORKFLOWS[wf] ? wf : null, limit: Math.min(100, num(url.searchParams.get('limit'), 30)) }) };
      } catch (e) {
        throw new HttpError(502, e.message);
      }
    }), true],

    ['GET', /^\/admin\/mirror$/, guard('releases.read', async () => {
      if (!mirror) return { items: [], latest: null };
      const latest = mirror.latest();
      const chans = Object.fromEntries(Object.entries(mirror.channels || {}).map(([k, v]) => [k, v.tag_name]));
      const items = [];
      const add = (rel) => {
        if (!rel) return;
        for (const a of rel.assets || []) {
          const key = `${rel.tag_name}/${a.name}`;
          const file = mirror.file(rel.tag_name, a.name);
          let onDisk = null;
          try {
            onDisk = file && fs.existsSync(file) ? fs.statSync(file).size : null;
          } catch {
            onDisk = null;
          }
          items.push({ tag: rel.tag_name, name: a.name, size: a.size, ready: mirror.ready.has(key), onDisk, match: onDisk != null && onDisk === a.size });
        }
      };
      add(mirror.release);
      for (const c of Object.values(mirror.channels || {})) add(c);
      return { latest: latest && { tag: latest.tag_name, mirrored: latest.mirrored }, channels: chans, busy: !!mirror.busy, dir: mirror.dir, items };
    }), true],

    ['POST', /^\/admin\/mirror\/resync$/, guard('mirror.write', async ({ req, a }) => {
      if (!mirror) throw new HttpError(503, 'Зеркала нет');
      const b = await readJson(req);
      // «Перекачать»: забыть, что файлы уже есть — sync скачает заново те, что не совпали
      if (b.force) {
        for (const k of [...mirror.ready]) {
          const [tag, name] = k.split('/');
          const f = mirror.file(tag, name);
          mirror.ready.delete(k);
          try {
            if (f) fs.rmSync(`${f}.asset`, { force: true });
          } catch {}
        }
      }
      mirror.sync().catch(() => {});
      await a.audit('mirror.resync', { type: 'mirror', id: 'all', params: { force: !!b.force } });
      return { ok: true, started: true };
    }, { write: true }), true],

    ['GET', /^\/admin\/notes$/, guard('releases.read', async ({ url }) => {
      needGithub();
      const version = clip(String(url.searchParams.get('version') || '').trim(), 20);
      const channel = clip(String(url.searchParams.get('channel') || '').trim(), 10);
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new HttpError(400, 'version — например 0.8.95');
      try {
        return await github.getNotes({ version, channel: ['dev', 'nightly'].includes(channel) ? channel : '' });
      } catch (e) {
        throw new HttpError(502, e.message);
      }
    }), true],

    ['PUT', /^\/admin\/notes$/, guard('notes.write', async ({ req, s, a }) => {
      needGithub();
      const b = await readJson(req);
      const version = clip(String(b.version || '').trim(), 20);
      const channel = ['dev', 'nightly'].includes(b.channel) ? b.channel : '';
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new HttpError(400, 'version — например 0.8.95');
      const text = String(b.text || '');
      if (!text.trim()) throw new HttpError(400, 'Пустые заметки');
      if (text.length > 100_000) throw new HttpError(413, 'Слишком длинные заметки');
      try {
        const r = await github.putNotes({ version, channel, text, author: s.user.username ? `@${s.user.username}` : s.user.name });
        await a.audit('notes.write', { type: 'notes', id: `v${version}${channel ? `-${channel}` : ''}`, params: { branch: r.branch, updated: r.updated, length: text.length } });
        return r;
      } catch (e) {
        throw new HttpError(502, e.message);
      }
    }, { write: true }), true],

    // ---------- 7.7 Сервер ----------
    ['GET', /^\/admin\/health$/, guard('server.read', async () => {
      const t0 = performance.now();
      let db = { ok: false, ms: null, size: null, connections: null };
      try {
        await q('SELECT 1');
        db.ok = true;
        db.ms = Math.round(performance.now() - t0);
        const size = await q('SELECT pg_database_size(current_database()) AS n').catch(() => null);
        if (size) db.size = Number(size.rows[0].n);
        const conn = await q('SELECT count(*) AS n FROM pg_stat_activity').catch(() => null);
        if (conn) db.connections = Number(conn.rows[0].n);
      } catch {}
      let disk = null;
      try {
        const st = fs.statfsSync(dataDir);
        disk = { path: dataDir, total: Number(st.blocks) * Number(st.bsize), free: Number(st.bavail) * Number(st.bsize) };
      } catch {}
      const mem = process.memoryUsage();
      const latest = mirror ? mirror.latest() : null;
      const tokens = await q('SELECT count(*) AS n FROM push_tokens').catch(() => ({ rows: [{ n: 0 }] }));
      const counts = {};
      for (const t of ['users', 'sessions', 'plays', 'lyrics_tracks', 'lyrics_versions']) {
        const r = await q(`SELECT count(*) AS n FROM ${t}`).catch(() => null);
        counts[t] = r ? Number(r.rows[0].n) : null;
      }
      return {
        ok: db.ok,
        time: new Date().toISOString(),
        process: { uptimeSec: Math.round(process.uptime()), rss: mem.rss, heapUsed: mem.heapUsed, node: process.version, pid: process.pid },
        db,
        disk,
        mirror: latest ? { tag: latest.tag_name, mirrored: latest.mirrored, busy: !!mirror.busy } : null,
        push: { configured: !!ctx.push, tokens: Number(tokens.rows[0].n) },
        github: !!(github && github.configured),
        minBuild: cfg.minBuild,
        counts,
        status: status ? status.get() : null
      };
    }), true],

    ['GET', /^\/admin\/logs$/, guard('logs.read', async ({ url }) => {
      if (!logs) return { items: [], last: 0 };
      const p = url.searchParams;
      const items = logs.query({ since: num(p.get('since')), q: p.get('q') || '', level: p.get('level') || '', limit: Math.min(5000, num(p.get('limit'), 1000)) });
      return { items, last: logs.seq };
    }), true],

    ['POST', /^\/admin\/ops$/, guard(null, async ({ req, a }) => {
      needGithub();
      const b = await readJson(req);
      const action = String(b.action || '');
      const perm = { restart: 'ops.restart', deploy: 'ops.deploy', 'collect-logs': 'ops.logs' }[action];
      if (!perm) throw new HttpError(400, 'action: restart, deploy или collect-logs');
      if (!a.perms.includes(perm)) {
        await a.audit('attempt', { type: 'permission', id: perm, result: 'denied' });
        throw new HttpError(403, `Недостаточно прав (${perm})`);
      }
      const ref = clip(String(b.ref || 'main').trim(), 100);
      if (!/^[\w./-]+$/.test(ref)) throw new HttpError(400, 'Странное имя ветки');
      try {
        if (action === 'deploy') await github.dispatch('server', ref);
        else await github.dispatch('ops', ref, { action: action === 'restart' ? 'restart' : 'logs', tail: String(Math.min(5000, Math.max(50, num(b.tail, 500)))) });
      } catch (e) {
        await a.audit(`ops.${action}`, { type: 'server', id: ref, result: `error: ${e.message}` });
        throw new HttpError(502, e.message);
      }
      await a.audit(`ops.${action}`, { type: 'server', id: ref, params: { tail: b.tail } });
      return { ok: true, workflow: action === 'deploy' ? WORKFLOWS.server : WORKFLOWS.ops, ref };
    }, { write: true }), true],

    ['GET', /^\/admin\/ops\/(\d+)$/, guard('server.read', async ({ m }) => {
      needGithub();
      try {
        return await github.run(m[1]);
      } catch (e) {
        throw new HttpError(502, e.message);
      }
    }), true],

    ['GET', /^\/admin\/ops\/(\d+)\/artifacts\/(\d+)$/, guard('ops.logs', async ({ m }) => {
      needGithub();
      try {
        return { files: await github.artifactFiles(m[2]) };
      } catch (e) {
        throw new HttpError(502, e.message);
      }
    }), true],

    // ---------- 7.9 Журнал ----------
    ['GET', /^\/admin\/audit$/, guard('audit.read', async ({ url, s, a }) => {
      const p = url.searchParams;
      const where = [];
      const params = [];
      // без audit.all — только свои действия
      if (!a.perms.includes('audit.all')) {
        params.push(s.uid);
        where.push(`admin_id = $${params.length}`);
      } else if (p.get('admin')) {
        params.push(String(p.get('admin')));
        where.push(`(CAST(admin_id AS TEXT) = $${params.length} OR admin_tg = $${params.length})`);
      }
      if (p.get('action')) {
        params.push(`${String(p.get('action')).toLowerCase()}%`);
        where.push(`lower(action) LIKE $${params.length}`);
      }
      if (p.get('target')) {
        const [type, id] = String(p.get('target')).split(':');
        params.push(type);
        where.push(`target_type = $${params.length}`);
        if (id) {
          params.push(id);
          where.push(`target_id = $${params.length}`);
        }
      }
      if (p.get('from')) {
        params.push(new Date(p.get('from')));
        where.push(`at >= $${params.length}`);
      }
      if (p.get('to')) {
        params.push(new Date(p.get('to')));
        where.push(`at < $${params.length}`);
      }
      const lim = Math.min(1000, Math.max(1, num(p.get('limit'), 200)));
      const offset = cursorOf(p.get('cursor'));
      const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = await q(`SELECT count(*) AS n FROM admin_audit ${sql}`, params);
      const { rows } = await q(`SELECT a.*, u.name, u.username FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ${sql.replace(/\b(admin_id|admin_tg|action|target_type|target_id|at)\b/g, 'a.$1')} ORDER BY a.at DESC, a.id DESC LIMIT ${lim} OFFSET ${offset}`, params);
      return { items: rows.map(auditRow), total: Number(total.rows[0].n), cursor: offset + rows.length < Number(total.rows[0].n) ? String(offset + rows.length) : null };
    }), true],

    // ---------- 7.9 Статистика (обезличенно) ----------
    ['GET', /^\/admin\/stats\/overview$/, guard('stats.read', async ({ url }) => {
      const { from, to } = range(url);
      const [plays, users, sess] = await Promise.all([
        q('SELECT user_id, source, played_at FROM plays WHERE played_at >= $1 AND played_at < $2 LIMIT 2000000', [from, to]),
        q('SELECT created_at FROM users WHERE created_at >= $1 AND created_at < $2', [from, to]),
        q('SELECT user_id, platform, build, last_seen FROM sessions WHERE last_seen >= $1', [new Date(to.getTime() - 30 * 86_400_000)])
      ]);
      const day = (d) => new Date(d).toISOString().slice(0, 10);
      const days = [];
      for (let t = new Date(day(from)); t < to; t = new Date(t.getTime() + 86_400_000)) days.push(day(t));
      const dau = new Map(days.map((d) => [d, new Set()]));
      const bySource = {};
      const sourceByDay = new Map(days.map((d) => [d, {}]));
      for (const p of plays.rows) {
        const d = day(p.played_at);
        if (dau.has(d)) dau.get(d).add(String(p.user_id));
        bySource[p.source || '?'] = (bySource[p.source || '?'] || 0) + 1;
        const sd = sourceByDay.get(d);
        if (sd) sd[p.source || '?'] = (sd[p.source || '?'] || 0) + 1;
      }
      // WAU / MAU: уникальные за 7 / 30 дней до каждого дня
      const perDay = new Map(days.map((d) => [d, new Set()]));
      for (const p of plays.rows) {
        const d = day(p.played_at);
        if (perDay.has(d)) perDay.get(d).add(String(p.user_id));
      }
      const window = (i, n) => {
        const set = new Set();
        for (let k = Math.max(0, i - n + 1); k <= i; k++) for (const u of perDay.get(days[k])) set.add(u);
        return set.size;
      };
      const regByDay = new Map(days.map((d) => [d, 0]));
      for (const u of users.rows) {
        const d = day(u.created_at);
        if (regByDay.has(d)) regByDay.set(d, regByDay.get(d) + 1);
      }
      const series = days.map((d, i) => ({ day: d, dau: dau.get(d).size, wau: window(i, 7), mau: window(i, 30), plays: Object.values(sourceByDay.get(d)).reduce((a, b) => a + b, 0), newUsers: regByDay.get(d), sources: sourceByDay.get(d) }));
      // платформы и версии: по последней сессии каждого пользователя за 30 дней
      const lastByUser = new Map();
      for (const s of sess.rows) {
        const cur = lastByUser.get(String(s.user_id));
        if (!cur || new Date(s.last_seen) > new Date(cur.last_seen)) lastByUser.set(String(s.user_id), s);
      }
      const platforms = {};
      const builds = {};
      for (const s of lastByUser.values()) {
        platforms[s.platform || '?'] = (platforms[s.platform || '?'] || 0) + 1;
        const b = s.build == null ? 'нет' : String(s.build);
        builds[b] = (builds[b] || 0) + 1;
      }
      const total = await q('SELECT count(*) AS n FROM users');
      const lyr = await lyricsCoverage();
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        totals: { users: Number(total.rows[0].n), newUsers: users.rows.length, plays: plays.rows.length, activeUsers: new Set(plays.rows.map((p) => String(p.user_id))).size, active30: lastByUser.size },
        series,
        bySource,
        platforms,
        builds,
        lyrics: lyr
      };
    }), true],

    ['GET', /^\/admin\/stats\/plays$/, guard('stats.read', async ({ url }) => {
      const { from, to } = range(url);
      const groupBy = ['track', 'artist', 'source'].includes(url.searchParams.get('groupBy')) ? url.searchParams.get('groupBy') : 'track';
      const lim = Math.min(500, Math.max(1, num(url.searchParams.get('limit'), 50)));
      const { rows } = await q('SELECT track_id, source, title, artist, listened FROM plays WHERE played_at >= $1 AND played_at < $2 LIMIT 2000000', [from, to]);
      const agg = new Map();
      for (const p of rows) {
        const key = groupBy === 'track' ? p.track_id : groupBy === 'artist' ? String(p.artist || '').split(/,\s+|\s+(?:feat|ft)\.?\s+/i)[0].trim() || '—' : p.source || '?';
        const cur = agg.get(key) || { key, title: p.title, artist: p.artist, source: p.source, plays: 0, minutes: 0 };
        cur.plays++;
        cur.minutes += (Number(p.listened) || 0) / 60;
        agg.set(key, cur);
      }
      const items = [...agg.values()].sort((a, b) => b.plays - a.plays).slice(0, lim).map((x) => ({ ...x, minutes: Math.round(x.minutes) }));
      return { from: from.toISOString(), to: to.toISOString(), groupBy, total: rows.length, items };
    }), true],

    // ---------- 7.10 Сам Automator ----------
    ['GET', /^\/admin\/automator\/latest$/, guard('automator.read', async () => {
      if (!github || !github.configured) return { tag: null, assets: [], error: 'На сервере нет токена GitHub — обновления Automator недоступны' };
      try {
        const r = await github.automatorLatest();
        return { ...r, assets: r.assets.map((a) => ({ ...a, url: `/admin/automator/dl/${encodeURIComponent(a.name)}` })) };
      } catch (e) {
        return { tag: null, assets: [], error: e.message };
      }
    }), true],

    ['GET', /^\/admin\/automator\/dl\/([A-Za-z0-9._-]+)$/, guard('automator.read', async ({ m, res }) => {
      needGithub();
      let file;
      try {
        file = await github.automatorAsset(m[1]);
      } catch (e) {
        throw new HttpError(502, e.message);
      }
      if (!file) throw new HttpError(404, 'В последнем релизе нет такого файла');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': file.size, 'Content-Disposition': `attachment; filename="${file.name}"`, 'Cache-Control': 'no-store' });
      const { Readable } = await import('node:stream');
      const { pipeline } = await import('node:stream/promises');
      await pipeline(Readable.fromWeb(file.body), res);
      return { __sent: true };
    }), true],

    ...lyricsAdminRoutes({ ...ctx, guard }),
    ...labelRoutes({ ...ctx, guard, getSetting, setSetting }),
    ...pushAdminRoutes({ ...ctx, guard }),
    ...profileAdminRoutes({ ...ctx, guard })
  ];

  function needGithub() {
    if (!github || !github.configured) throw new HttpError(503, 'На сервере нет токена GitHub (GH_ADMIN_TOKEN) — сборки, заметки и операции недоступны');
  }

  async function buildDistribution() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const { rows } = await q('SELECT user_id, platform, build, last_seen FROM sessions WHERE last_seen >= $1', [since]);
    const last = new Map();
    for (const r of rows) {
      const k = `${r.user_id}/${r.platform}`;
      const cur = last.get(k);
      if (!cur || new Date(r.last_seen) > new Date(cur.last_seen)) last.set(k, r);
    }
    const agg = new Map();
    for (const r of last.values()) {
      const k = `${r.platform || '?'}/${r.build == null ? 0 : r.build}`;
      const cur = agg.get(k) || { platform: r.platform || '?', build: r.build == null ? 0 : Number(r.build), users: 0 };
      cur.users++;
      agg.set(k, cur);
    }
    return [...agg.values()].sort((a, b) => b.build - a.build || a.platform.localeCompare(b.platform));
  }

  async function lyricsCoverage() {
    try {
      const [tracks, pub, words] = await Promise.all([
        q('SELECT count(*) AS n FROM lyrics_tracks WHERE NOT hidden'),
        q('SELECT count(*) AS n FROM lyrics_tracks WHERE NOT hidden AND published_version IS NOT NULL'),
        q(`SELECT count(*) AS n FROM lyrics_tracks t JOIN lyrics_versions v ON v.id = t.published_version WHERE NOT t.hidden AND v.words <> ''`)
      ]);
      return { tracks: Number(tracks.rows[0].n), published: Number(pub.rows[0].n), withWords: Number(words.rows[0].n) };
    } catch {
      return null;
    }
  }

  function range(url) {
    const p = url.searchParams;
    const to = p.get('to') ? new Date(p.get('to')) : new Date();
    const from = p.get('from') ? new Date(p.get('from')) : new Date(to.getTime() - 30 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new HttpError(400, 'Плохой период');
    if (to - from > 400 * 86_400_000) throw new HttpError(400, 'Период — не больше 400 дней');
    return { from, to };
  }

  return { routes, init, tick, audit, roleOf };
}

const s0 = (ids) => new Set((ids || []).map(String));

function auditRow(r) {
  return {
    id: String(r.id),
    at: r.at,
    admin: r.admin_id == null ? null : { id: String(r.admin_id), tgId: r.admin_tg, name: r.name || null, username: r.username || null },
    role: r.role,
    action: r.action,
    target: { type: r.target_type, id: r.target_id },
    params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params,
    result: r.result,
    ip: r.ip
  };
}

function scheduleRow(r) {
  return { id: String(r.id), startAt: r.start_at, endAt: r.end_at, maintenance: typeof r.maintenance === 'string' ? JSON.parse(r.maintenance) : r.maintenance, state: r.state, by: r.by_user == null ? null : String(r.by_user), createdAt: r.created_at };
}
