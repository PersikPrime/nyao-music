// Флаги функций: включить пробную функцию части пользователей без нового релиза (из Автоматора).
// Флаг — да/нет; кому: всем (можно процентом), только разработчикам или списку Telegram ID; в каких каналах и на каких платформах.
import crypto from 'node:crypto';

export const FLAG_CHANNELS = ['nightly', 'dev', 'stable'];
export const FLAG_PLATFORMS = ['desktop', 'android', 'ios'];
const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Флаги, которые приложения уже понимают, — подсказка в Автоматоре */
export const KNOWN_FLAGS = [
  { key: 'ui2', title: 'Новый интерфейс', description: 'ПК: новый вид главной, исполнителя, альбома и настроек, плавающий плеер и новый вход. Свой переключатель в «Разработчике» важнее флага.' }
];

const platformGroup = (p) => (['win32', 'darwin', 'linux', 'desktop'].includes(p) ? 'desktop' : p === 'android' ? 'android' : p === 'ios' ? 'ios' : '');
const list = (v, allowed) => (Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x).trim()).filter((x) => allowed.includes(x));
const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Попадает ли пользователь в процент: стабильно для пары флаг + пользователь */
export function bucket(key, who) {
  const h = crypto.createHash('sha256').update(`${key}:${who}`).digest();
  return h.readUInt32BE(0) % 100;
}

/** Включён ли флаг для этого клиента */
export function flagOn(row, { channel, platform, user }) {
  if (!row.enabled) return false;
  const channels = csv(row.channels);
  if (channels.length && !channels.includes(channel)) return false;
  const platforms = csv(row.platforms);
  if (platforms.length && !platforms.includes(platformGroup(platform))) return false;
  if (row.audience === 'devs') return !!(user && user.dev);
  if (row.audience === 'list') return !!(user && csv(row.user_ids).includes(String(user.tgId)));
  const pct = Number(row.percent ?? 100);
  if (pct >= 100) return true;
  if (!user || pct <= 0) return false;
  return bucket(row.key, user.id) < pct;
}

function rowOut(r) {
  return {
    key: r.key,
    title: r.title,
    description: r.description,
    enabled: !!r.enabled,
    audience: r.audience,
    percent: Number(r.percent),
    userIds: csv(r.user_ids),
    channels: csv(r.channels),
    platforms: csv(r.platforms),
    updatedAt: new Date(r.updated_at).getTime()
  };
}

export function flagsAdminRoutes({ q, HttpError, readJson, clip, guard }) {
  return [
    ['GET', /^\/admin\/flags$/, guard('flags.read', async () => {
      const { rows } = await q('SELECT * FROM feature_flags ORDER BY key');
      return { items: rows.map(rowOut), known: KNOWN_FLAGS, channels: FLAG_CHANNELS, platforms: FLAG_PLATFORMS };
    }), true],

    ['PUT', /^\/admin\/flags\/([a-z0-9_]+)$/, guard('flags.write', async ({ m, req, s, a }) => {
      const key = m[1];
      if (!KEY_RE.test(key)) throw new HttpError(400, 'Ключ флага: латиница, цифры и _, от 2 до 40 символов, с буквы');
      const b = await readJson(req);
      const audience = ['all', 'devs', 'list'].includes(b.audience) ? b.audience : 'devs';
      const userIds = (Array.isArray(b.userIds) ? b.userIds : String(b.userIds || '').split(/[\s,]+/)).map((x) => String(x).trim()).filter((x) => /^\d{3,15}$/.test(x)).slice(0, 500);
      if (audience === 'list' && !userIds.length) throw new HttpError(400, 'Список пуст: впиши Telegram ID через запятую');
      const v = {
        title: clip(String(b.title || key).trim(), 80),
        description: clip(String(b.description || '').trim(), 400),
        enabled: !!b.enabled,
        audience,
        percent: Math.max(0, Math.min(100, Math.round(Number(b.percent ?? 100)) || 0)),
        userIds: userIds.join(','),
        channels: list(b.channels, FLAG_CHANNELS).join(','),
        platforms: list(b.platforms, FLAG_PLATFORMS).join(',')
      };
      const { rows } = await q(
        `INSERT INTO feature_flags (key, title, description, enabled, audience, percent, user_ids, channels, platforms, by_user)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (key) DO UPDATE SET title = $2, description = $3, enabled = $4, audience = $5, percent = $6, user_ids = $7, channels = $8, platforms = $9, by_user = $10, updated_at = now()
         RETURNING *`,
        [key, v.title, v.description, v.enabled, v.audience, v.percent, v.userIds, v.channels, v.platforms, s.uid]
      );
      await a.audit('flag.set', { type: 'flag', id: key, params: { enabled: v.enabled, audience: v.audience, percent: v.percent, channels: v.channels, platforms: v.platforms, users: userIds.length } });
      return rowOut(rows[0]);
    }, { write: true }), true],

    ['DELETE', /^\/admin\/flags\/([a-z0-9_]+)$/, guard('flags.write', async ({ m, a }) => {
      const { rowCount } = await q('DELETE FROM feature_flags WHERE key = $1', [m[1]]);
      if (!rowCount) throw new HttpError(404, 'Нет такого флага');
      await a.audit('flag.delete', { type: 'flag', id: m[1] });
      return { ok: true };
    }, { write: true }), true]
  ];
}

/** GET /flags?channel=&platform= — флаги для этого клиента. Вход не обязателен: гостю — только флаги «всем 100%» */
export function flagsPublicRoutes({ q, optionalAuth }) {
  return [
    ['GET', /^\/flags$/, async ({ req, url }) => {
      const channel = FLAG_CHANNELS.includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : 'stable';
      const platform = String(url.searchParams.get('platform') || '').slice(0, 20);
      const s = await optionalAuth(req);
      const { rows } = await q('SELECT * FROM feature_flags WHERE enabled = true');
      const flags = {};
      for (const r of rows) if (flagOn(r, { channel, platform, user: s && s.user })) flags[r.key] = true;
      return { flags };
    }]
  ];
}
