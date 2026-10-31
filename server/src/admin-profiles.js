// Nyao Automator: модерация профилей — баннеры и ссылки на соцсети.
// Они появляются на профиле сразу, а сюда приходят очередью; «Убрать» снимает их с профиля.
import { bannerStore } from './profile-extras.js';

export function profileAdminRoutes({ q, HttpError, readJson, clip, guard, publicUrl = '', dataDir = '/data' }) {
  const banners = bannerStore(dataDir);
  const asObj = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
  const item = (r) => ({
    id: String(r.id),
    kind: r.kind,
    status: r.status,
    createdAt: new Date(r.created_at).getTime(),
    reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).getTime() : null,
    reason: r.reason || '',
    user: { id: String(r.user_id), nick: r.nick || null, name: r.name || '', picture: r.picture || null },
    // баннер: адрес картинки и висит ли он ещё на профиле; ссылки: что добавили
    banner: r.kind === 'banner' ? { url: `${publicUrl}/media/banners/${r.value}`, current: r.banner === r.value } : null,
    links: r.kind === 'links' ? asObj(r.value) || [] : null
  });

  return [
    ['GET', /^\/admin\/profiles\/moderation$/, guard('profiles.read', async ({ url }) => {
      const status = ['new', 'ok', 'removed', 'all'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'new';
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const { rows } = await q(
        `SELECT m.*, p.nick, p.banner, u.name, u.picture FROM profile_moderation m
           JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.user_id = m.user_id
          ${status === 'all' ? '' : 'WHERE m.status = $2'}
          ORDER BY m.created_at ${status === 'new' ? 'ASC' : 'DESC'} LIMIT $1`,
        status === 'all' ? [limit] : [limit, status]
      );
      const count = (await q(`SELECT count(*)::int AS n FROM profile_moderation WHERE status = 'new'`)).rows[0].n;
      return { items: rows.map(item), waiting: Number(count) || 0 };
    }), true],

    ['POST', /^\/admin\/profiles\/moderation\/(\d+)$/, guard('profiles.moderate', async ({ m, req, s, a }) => {
      const id = Number(m[1]);
      const b = await readJson(req);
      if (!['ok', 'remove'].includes(b.action)) throw new HttpError(400, 'Действие: ok или remove');
      const reason = clip(String(b.reason || '').trim(), 300);
      const { rows } = await q('SELECT * FROM profile_moderation WHERE id = $1', [id]);
      if (!rows.length) throw new HttpError(404, 'Нет такой записи');
      const r = rows[0];
      const uid = Number(r.user_id);
      if (b.action === 'remove') {
        if (r.kind === 'banner') {
          // снимаем, только если на профиле всё ещё этот баннер
          const cur = await q('UPDATE profiles SET banner = NULL, updated_at = now() WHERE user_id = $1 AND banner = $2', [uid, r.value]);
          if (cur.rowCount) banners.remove(r.value);
        } else if (r.kind === 'links') {
          const bad = new Set((asObj(r.value) || []).map((x) => x.url));
          const p = await q('SELECT links FROM profiles WHERE user_id = $1', [uid]);
          const keep = (asObj(p.rows[0] && p.rows[0].links) || []).filter((x) => !bad.has(x.url));
          await q('UPDATE profiles SET links = $2, updated_at = now() WHERE user_id = $1', [uid, JSON.stringify(keep)]);
        }
      }
      await q('UPDATE profile_moderation SET status = $2, reviewed_at = now(), reviewed_by = $3, reason = $4 WHERE id = $1', [id, b.action === 'ok' ? 'ok' : 'removed', s.uid, reason]);
      await a.audit(`profiles.${b.action}`, { type: 'user', id: uid, params: { kind: r.kind, item: id, reason } });
      return { ok: true };
    }, { write: true }), true]
  ];
}
