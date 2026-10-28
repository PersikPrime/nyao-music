import { idList } from './admin.js';

// Admin API: push-уведомления — проверка на одно устройство, рассылка по аудитории (не чаще раза в час), история.

const BROADCAST_GAP = 60 * 60_000;

export function pushAdminRoutes({ q, HttpError, readJson, clip, guard, push, log = () => {} }) {
  const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

  function needPush() {
    if (!push) throw new HttpError(503, 'Push на сервере выключен (нет FCM_SERVICE_ACCOUNT)');
  }

  /** Токены по аудитории: { type: 'all' | 'platform' | 'build_lt' | 'users', platform?, build?, userIds? } */
  async function audienceTokens(aud) {
    const type = String((aud && aud.type) || 'all');
    const base = 'SELECT p.session_id, p.user_id, p.token, p.platform, s.build FROM push_tokens p JOIN sessions s ON s.id = p.session_id';
    if (type === 'all') return (await q(`${base}`)).rows;
    if (type === 'platform') return (await q(`${base} WHERE s.platform = $1 OR p.platform = $1`, [clip(String(aud.platform || ''), 16)])).rows;
    if (type === 'build_lt') return (await q(`${base} WHERE s.build IS NOT NULL AND s.build < $1`, [num(aud.build)])).rows;
    if (type === 'users') {
      const ids = (Array.isArray(aud.userIds) ? aud.userIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 5000);
      if (!ids.length) return [];
      return (await q(`${base} WHERE p.user_id ${idList(ids)}`)).rows;
    }
    throw new HttpError(400, 'audience.type: all, platform, build_lt или users');
  }

  const message = (b) => {
    const title = clip(String(b.title || '').trim(), 100);
    const body = clip(String(b.body || '').trim(), 500);
    const link = clip(String(b.link || '').trim(), 300);
    if (!title && !body) throw new HttpError(400, 'Нужен заголовок или текст');
    if (link && !/^(nyao:\/\/|https:\/\/)/.test(link)) throw new HttpError(400, 'Ссылка — nyao://… или https://…');
    return { title, body, link };
  };

  async function sendAll(tokens, msg, data) {
    let delivered = 0;
    let failed = 0;
    const gone = [];
    // по несколько параллельно, чтобы рассылка на тысячи устройств не висела минутами
    const queue = [...tokens];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        try {
          await push.send(t.token, { title: msg.title, body: msg.body, data });
          delivered++;
        } catch (e) {
          failed++;
          if (e && e.gone) gone.push(t.session_id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, tokens.length) }, worker));
    for (const sid of gone) await q('DELETE FROM push_tokens WHERE session_id = $1', [sid]).catch(() => {});
    return { delivered, failed, removed: gone.length };
  }

  return [
    ['POST', /^\/admin\/push\/test$/, guard('push.test', async ({ req, a }) => {
      needPush();
      const b = await readJson(req);
      const uid = Number(b.userId);
      if (!uid) throw new HttpError(400, 'userId');
      const params = [uid];
      let where = 'p.user_id = $1';
      if (b.deviceId) {
        params.push(Number(b.deviceId));
        where += ' AND p.session_id = $2';
      }
      const { rows } = await q(`SELECT p.session_id, p.token FROM push_tokens p WHERE ${where}`, params);
      if (!rows.length) throw new HttpError(404, 'У пользователя нет устройств с push');
      const msg = message(b);
      const r = await sendAll(rows, msg, { kind: 'admin', link: msg.link || undefined });
      await a.audit('push.test', { type: 'user', id: uid, params: { deviceId: b.deviceId || null, title: msg.title, ...r } });
      return { ok: true, ...r, devices: rows.length };
    }, { write: true }), true],

    ['POST', /^\/admin\/push\/count$/, guard('push.read', async ({ req }) => {
      const b = await readJson(req);
      const tokens = await audienceTokens(b.audience);
      return { devices: tokens.length, users: new Set(tokens.map((t) => String(t.user_id))).size };
    }), true],

    ['POST', /^\/admin\/push\/broadcast$/, guard('push.broadcast', async ({ req, s, a }) => {
      needPush();
      const b = await readJson(req);
      const msg = message(b);
      const last = await q('SELECT at FROM push_broadcasts ORDER BY at DESC LIMIT 1');
      if (last.rows.length && Date.now() - new Date(last.rows[0].at).getTime() < BROADCAST_GAP) {
        const wait = Math.ceil((BROADCAST_GAP - (Date.now() - new Date(last.rows[0].at).getTime())) / 60_000);
        throw new HttpError(429, `Массовая рассылка — не чаще раза в час. Подожди ещё ${wait} мин`);
      }
      const tokens = await audienceTokens(b.audience);
      if (!tokens.length) throw new HttpError(404, 'В этой аудитории нет устройств с push');
      const ins = await q(
        'INSERT INTO push_broadcasts (by_user, audience, title, body, link, total) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [s.uid, JSON.stringify(b.audience || { type: 'all' }), msg.title, msg.body, msg.link, tokens.length]
      );
      const r = await sendAll(tokens, msg, { kind: 'broadcast', link: msg.link || undefined });
      await q('UPDATE push_broadcasts SET delivered = $1, failed = $2 WHERE id = $3', [r.delivered, r.failed, ins.rows[0].id]);
      await a.audit('push.broadcast', { type: 'broadcast', id: ins.rows[0].id, params: { audience: b.audience, title: msg.title, total: tokens.length, ...r } });
      log(`[push] рассылка №${ins.rows[0].id}: ${r.delivered}/${tokens.length}`);
      return { ok: true, id: String(ins.rows[0].id), total: tokens.length, ...r };
    }, { write: true }), true],

    ['GET', /^\/admin\/push\/history$/, guard('push.read', async () => {
      const { rows } = await q('SELECT b.*, u.name, u.username FROM push_broadcasts b LEFT JOIN users u ON u.id = b.by_user ORDER BY b.at DESC LIMIT 200');
      const last = rows[0] ? new Date(rows[0].at).getTime() : 0;
      return {
        nextAllowedAt: last ? new Date(last + BROADCAST_GAP).toISOString() : null,
        items: rows.map((r) => ({ id: String(r.id), at: r.at, by: r.by_user == null ? null : { id: String(r.by_user), name: r.name, username: r.username }, audience: typeof r.audience === 'string' ? JSON.parse(r.audience) : r.audience, title: r.title, body: r.body, link: r.link, total: Number(r.total), delivered: Number(r.delivered), failed: Number(r.failed) }))
      };
    }), true]
  ];
}
