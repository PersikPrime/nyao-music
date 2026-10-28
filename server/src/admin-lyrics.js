// Admin API: Nyao LyricLabs — очередь модерации, массовые действия, треки и откаты, жалобы, роли, выгрузка.
import { toTtml, normIsrc } from './lyrics.js';
import { zipFiles } from './zip.js';
import { idList } from './admin.js';

const LYRICS_ROLES = new Set(['specialist', 'admin']);
const SAFE_NAME = (s) => String(s || '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'track';

export function lyricsAdminRoutes({ q, HttpError, readJson, clip, guard }) {
  const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const user = (r, p) => (r[`${p}name`] == null && r[`${p}username`] == null ? null : { name: r[`${p}name`], username: r[`${p}username`] });
  const parseStructure = (s) => {
    try {
      const v = typeof s === 'string' ? JSON.parse(s || '[]') : s;
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const versionRow = (v) => ({
    id: String(v.id),
    trackId: String(v.track_id),
    status: v.status,
    plain: v.plain,
    synced: v.synced,
    words: v.words || '',
    instrumental: !!v.instrumental,
    structure: parseStructure(v.structure),
    note: v.note || '',
    createdAt: v.created_at,
    reviewedAt: v.reviewed_at,
    author: user(v, 'a_'),
    authorId: v.author_id == null ? null : String(v.author_id),
    reviewer: user(v, 'r_'),
    assigneeId: v.assignee_id == null ? null : String(v.assignee_id)
  });

  async function review(s, id, action, note) {
    const { rows } = await q(`SELECT v.*, t.hidden FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id WHERE v.id = $1`, [id]);
    const v = rows[0];
    if (!v) throw new HttpError(404, `Нет версии №${id}`);
    if (v.status !== 'pending') throw new HttpError(409, `Версию №${id} уже проверили`);
    if (v.hidden) throw new HttpError(451, 'Трек снят по жалобе правообладателя');
    if (action === 'accept') {
      await q(`UPDATE lyrics_versions SET status = 'published', note = $1, reviewer_id = $2, reviewed_at = now() WHERE id = $3`, [note, s.uid, v.id]);
      await q('UPDATE lyrics_tracks SET published_version = $1 WHERE id = $2', [v.id, v.track_id]);
      return 'published';
    }
    const st = action === 'return' ? 'returned' : 'rejected';
    if (action === 'return' && !note) throw new HttpError(400, 'Напиши автору, что поправить');
    await q(`UPDATE lyrics_versions SET status = $1, note = $2, reviewer_id = $3, reviewed_at = now() WHERE id = $4`, [st, note, s.uid, v.id]);
    return st;
  }

  const SEL = `SELECT v.*, t.title, t.artist, t.album, t.duration, t.isrc, t.cover, t.published_version, a.name AS a_name, a.username AS a_username, r.name AS r_name, r.username AS r_username
                 FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id LEFT JOIN users a ON a.id = v.author_id LEFT JOIN users r ON r.id = v.reviewer_id`;

  return [
    ['GET', /^\/admin\/lyrics\/queue$/, guard('lyrics.read', async ({ url }) => {
      const p = url.searchParams;
      const st = ['pending', 'published', 'returned', 'rejected'].includes(p.get('status')) ? p.get('status') : 'pending';
      const lim = Math.min(500, Math.max(1, num(p.get('limit'), 200)));
      const where = ['v.status = $1'];
      const params = [st];
      if (p.get('assignee')) {
        params.push(Number(p.get('assignee')));
        where.push(`v.assignee_id = $${params.length}`);
      }
      const { rows } = await q(`${SEL} WHERE ${where.join(' AND ')} ORDER BY v.created_at ${st === 'pending' ? 'ASC' : 'DESC'} LIMIT ${lim}`, params);
      return {
        items: rows.map((v) => ({
          ...versionRow(v),
          plain: undefined,
          synced: undefined,
          words: undefined,
          kind: v.words ? 'words' : v.synced ? 'synced' : 'plain',
          edit: v.published_version != null,
          track: { id: String(v.track_id), title: v.title, artist: v.artist, album: v.album, duration: Number(v.duration) || 0, isrc: v.isrc || null }
        }))
      };
    }), true],

    ['GET', /^\/admin\/lyrics\/versions\/(\d+)$/, guard('lyrics.read', async ({ m }) => {
      const { rows } = await q(`${SEL} WHERE v.id = $1`, [m[1]]);
      const v = rows[0];
      if (!v) throw new HttpError(404, 'Нет такой версии');
      let current = null;
      if (v.published_version && Number(v.published_version) !== Number(v.id)) {
        const c = await q('SELECT * FROM lyrics_versions WHERE id = $1', [v.published_version]);
        if (c.rows[0]) current = versionRow(c.rows[0]);
      }
      return { version: versionRow(v), track: { id: String(v.track_id), title: v.title, artist: v.artist, album: v.album, duration: Number(v.duration) || 0, isrc: v.isrc || null, cover: v.cover || null }, current };
    }), true],

    ['POST', /^\/admin\/lyrics\/versions\/(\d+)\/review$/, guard('lyrics.review', async ({ m, req, s, a }) => {
      const b = await readJson(req);
      const action = String(b.action || '');
      if (!['accept', 'return', 'reject'].includes(action)) throw new HttpError(400, 'action: accept, return или reject');
      const note = clip(String(b.note || '').trim(), 1000);
      const status = await review(s, Number(m[1]), action, note);
      await a.audit(`lyrics.review.${action}`, { type: 'lyrics_version', id: m[1], params: { note } });
      return { ok: true, status };
    }, { write: true }), true],

    ['POST', /^\/admin\/lyrics\/bulk$/, guard('lyrics.review', async ({ req, s, a }) => {
      const b = await readJson(req);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 200);
      if (!ids.length) throw new HttpError(400, 'Нет версий');
      const action = String(b.action || '');
      const note = clip(String(b.note || '').trim(), 1000);
      const results = [];
      if (action === 'assign') {
        const assignee = b.assignee == null ? null : Number(b.assignee);
        if (assignee) {
          const u = await q('SELECT id FROM users WHERE id = $1', [assignee]);
          if (!u.rows.length) throw new HttpError(404, 'Нет такого проверяющего');
        }
        for (const id of ids) {
          const r = await q(`UPDATE lyrics_versions SET assignee_id = $1 WHERE id = $2 AND status = 'pending'`, [assignee, id]);
          results.push({ id: String(id), ok: !!r.rowCount });
        }
        await a.audit('lyrics.assign', { type: 'lyrics_version', id: ids.join(','), params: { assignee } });
        return { items: results };
      }
      if (!['accept', 'return', 'reject'].includes(action)) throw new HttpError(400, 'action: accept, return, reject или assign');
      for (const id of ids) {
        try {
          results.push({ id: String(id), ok: true, status: await review(s, id, action, note) });
        } catch (e) {
          results.push({ id: String(id), ok: false, error: e.message });
        }
      }
      await a.audit(`lyrics.bulk.${action}`, { type: 'lyrics_version', id: ids.join(','), params: { note, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length } });
      return { items: results };
    }, { write: true }), true],

    ['GET', /^\/admin\/lyrics\/tracks$/, guard('lyrics.read', async ({ url }) => {
      const qs = String(url.searchParams.get('q') || '').trim();
      const lim = Math.min(500, Math.max(1, num(url.searchParams.get('limit'), 100)));
      const params = [];
      let where = '';
      if (qs) {
        const isrc = normIsrc(qs);
        if (isrc) {
          params.push(isrc);
          where = 'WHERE t.isrc = $1';
        } else if (/^\d+$/.test(qs)) {
          params.push(Number(qs), String(qs));
          where = 'WHERE t.id = $1 OR t.ya_id = $2';
        } else {
          params.push(`%${qs.toLowerCase().replace(/ё/g, 'е')}%`);
          where = 'WHERE lower(t.title) LIKE $1 OR lower(t.artist) LIKE $1 OR t.title_norm LIKE $1 OR t.artist_norm LIKE $1';
        }
      }
      const { rows } = await q(`SELECT t.* FROM lyrics_tracks t ${where} ORDER BY t.id DESC LIMIT ${lim}`, params);
      const ids = rows.map((r) => Number(r.id));
      const counts = ids.length ? await q(`SELECT track_id, status, count(*) AS n FROM lyrics_versions WHERE track_id ${idList(ids)} GROUP BY track_id, status`) : { rows: [] };
      const vers = new Map();
      const pend = new Map();
      for (const c of counts.rows) {
        vers.set(String(c.track_id), (vers.get(String(c.track_id)) || 0) + Number(c.n));
        if (c.status === 'pending') pend.set(String(c.track_id), Number(c.n));
      }
      return { items: rows.map((r) => trackRow({ ...r, versions: vers.get(String(r.id)) || 0, pending: pend.get(String(r.id)) || 0 })) };
    }), true],

    ['GET', /^\/admin\/lyrics\/tracks\/(\d+)$/, guard('lyrics.read', async ({ m }) => {
      const { rows } = await q('SELECT * FROM lyrics_tracks WHERE id = $1', [m[1]]);
      if (!rows.length) throw new HttpError(404, 'Нет такого трека');
      const vs = await q(`${SEL} WHERE v.track_id = $1 ORDER BY v.created_at DESC`, [m[1]]);
      const reports = await q('SELECT * FROM lyrics_reports WHERE track_id = $1 ORDER BY created_at DESC', [m[1]]);
      return { track: trackRow(rows[0]), versions: vs.rows.map(versionRow), reports: reports.rows.map(reportRow) };
    }), true],

    ['POST', /^\/admin\/lyrics\/tracks\/(\d+)\/rollback$/, guard('lyrics.edit', async ({ m, req, a }) => {
      const b = await readJson(req);
      const vid = Number(b.versionId);
      const { rows } = await q('SELECT id, track_id, status FROM lyrics_versions WHERE id = $1', [vid]);
      if (!rows.length || Number(rows[0].track_id) !== Number(m[1])) throw new HttpError(404, 'У этого трека нет такой версии');
      await q(`UPDATE lyrics_versions SET status = 'published' WHERE id = $1`, [vid]);
      await q('UPDATE lyrics_tracks SET published_version = $1 WHERE id = $2', [vid, m[1]]);
      await a.audit('lyrics.rollback', { type: 'lyrics_track', id: m[1], params: { versionId: vid } });
      return { ok: true };
    }, { write: true }), true],

    ['POST', /^\/admin\/lyrics\/tracks\/(\d+)\/hidden$/, guard('lyrics.edit', async ({ m, req, a }) => {
      const b = await readJson(req);
      const hidden = !!b.hidden;
      const r = await q('UPDATE lyrics_tracks SET hidden = $1 WHERE id = $2', [hidden, m[1]]);
      if (!r.rowCount) throw new HttpError(404, 'Нет такого трека');
      await a.audit('lyrics.hidden', { type: 'lyrics_track', id: m[1], params: { hidden } });
      return { ok: true };
    }, { write: true }), true],

    ['GET', /^\/admin\/lyrics\/reports$/, guard('lyrics.read', async ({ url }) => {
      const all = url.searchParams.get('all') === '1';
      const { rows } = await q(`SELECT r.*, t.title, t.artist, t.hidden FROM lyrics_reports r JOIN lyrics_tracks t ON t.id = r.track_id ${all ? '' : "WHERE r.status = 'open'"} ORDER BY r.created_at DESC LIMIT 500`);
      return { items: rows.map((r) => ({ ...reportRow(r), track: { id: String(r.track_id), title: r.title, artist: r.artist, hidden: !!r.hidden } })) };
    }), true],

    ['POST', /^\/admin\/lyrics\/reports\/(\d+)$/, guard('lyrics.reports', async ({ m, req, s, a }) => {
      const b = await readJson(req);
      const action = String(b.action || '');
      if (!['hide', 'restore', 'close'].includes(action)) throw new HttpError(400, 'action: hide, restore или close');
      const { rows } = await q('SELECT track_id FROM lyrics_reports WHERE id = $1', [m[1]]);
      if (!rows.length) throw new HttpError(404, 'Нет такой жалобы');
      if (action === 'hide') await q('UPDATE lyrics_tracks SET hidden = true WHERE id = $1', [rows[0].track_id]);
      if (action === 'restore') await q('UPDATE lyrics_tracks SET hidden = false WHERE id = $1', [rows[0].track_id]);
      await q(`UPDATE lyrics_reports SET status = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`, [action === 'close' ? 'closed' : action === 'hide' ? 'hidden' : 'restored', s.uid, m[1]]);
      await a.audit(`lyrics.report.${action}`, { type: 'lyrics_report', id: m[1], params: { trackId: String(rows[0].track_id) } });
      return { ok: true };
    }, { write: true }), true],

    ['GET', /^\/admin\/lyrics\/roles$/, guard('lyrics.read', async () => {
      const { rows } = await q(`SELECT r.user_id, r.role, r.created_at, u.tg_id, u.name, u.username FROM lyrics_roles r JOIN users u ON u.id = r.user_id ORDER BY r.created_at`);
      return { items: rows.map((r) => ({ userId: String(r.user_id), tgId: String(r.tg_id), name: r.name, username: r.username, role: r.role, since: r.created_at })) };
    }), true],

    ['POST', /^\/admin\/lyrics\/roles$/, guard('lyrics.roles', async ({ req, a }) => {
      const b = await readJson(req);
      const who = String(b.user || '').trim().replace(/^@/, '');
      const role = b.role === null || b.role === '' ? null : String(b.role);
      if (!who) throw new HttpError(400, 'Кого назначить: @username, Telegram ID или id');
      if (role && !LYRICS_ROLES.has(role)) throw new HttpError(400, 'Роль: specialist или admin');
      const { rows } = await q(`SELECT id FROM users WHERE tg_id = $1 OR lower(coalesce(username, '')) = lower($1) OR CAST(id AS TEXT) = $1 LIMIT 1`, [who]);
      if (!rows.length) throw new HttpError(404, 'Такой человек ещё не входил в аккаунт Nyao');
      const uid = Number(rows[0].id);
      await q('DELETE FROM lyrics_roles WHERE user_id = $1', [uid]);
      if (role) await q('INSERT INTO lyrics_roles (user_id, role) VALUES ($1, $2)', [uid, role]);
      await a.audit('lyrics.roles', { type: 'user', id: uid, params: { role } });
      return { ok: true, userId: String(uid), role };
    }, { write: true }), true],

    // выгрузка для Musixmatch Pro: архив LRC + TTML, имена файлов — по ISRC (без ISRC — по id)
    ['POST', /^\/admin\/lyrics\/export$/, guard('lyrics.export', async ({ req, a }) => {
      const b = await readJson(req);
      const ids = (Array.isArray(b.trackIds) ? b.trackIds : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 500);
      if (!ids.length) throw new HttpError(400, 'Выбери треки');
      const { rows } = await q(
        `SELECT t.id, t.title, t.artist, t.album, t.duration, t.isrc, v.plain, v.synced, v.words, v.structure, v.instrumental
           FROM lyrics_tracks t JOIN lyrics_versions v ON v.id = t.published_version WHERE t.id ${idList(ids)}`
      );
      const files = [];
      const skipped = [];
      for (const t of rows) {
        const base = t.isrc ? SAFE_NAME(t.isrc) : `id${t.id}`;
        const header = `[ar:${t.artist}]\n[ti:${t.title}]\n${t.album ? `[al:${t.album}]\n` : ''}[length:${fmtLen(t.duration)}]\n[re:Nyao LyricLabs]\n\n`;
        if (t.synced) files.push({ name: `${base}.lrc`, data: header + t.synced });
        if (t.words) files.push({ name: `${base}.elrc`, data: header + t.words });
        if (!t.synced && !t.words && t.plain) files.push({ name: `${base}.txt`, data: t.plain });
        const ttml = toTtml({ title: t.title, artist: t.artist, duration: Number(t.duration) || 0, plain: t.plain, synced: t.synced, structure: parseStructure(t.structure), words: t.words });
        if (ttml) files.push({ name: `${base}.ttml`, data: ttml });
        if (!t.synced && !t.words && !t.plain) skipped.push(String(t.id));
      }
      for (const id of ids) if (!rows.some((r) => Number(r.id) === id)) skipped.push(String(id));
      if (!files.length) throw new HttpError(404, 'У выбранных треков нет опубликованных текстов');
      files.push({ name: 'README.txt', data: `Nyao LyricLabs → Musixmatch Pro\nТреков: ${rows.length}, файлов: ${files.length}${skipped.length ? `\nБез текста или не найдены: ${skipped.join(', ')}` : ''}\n` });
      await a.audit('lyrics.export', { type: 'lyrics_track', id: ids.join(','), params: { tracks: rows.length, files: files.length, skipped } });
      return { __raw: { type: 'application/zip', body: zipFiles(files), filename: `lyriclabs-export-${new Date().toISOString().slice(0, 10)}.zip` } };
    }, { write: true }), true]
  ];

  function trackRow(t) {
    return { id: String(t.id), title: t.title, artist: t.artist, album: t.album, duration: Number(t.duration) || 0, isrc: t.isrc || null, yaId: t.ya_id || null, cover: t.cover || null, hidden: !!t.hidden, publishedVersion: t.published_version == null ? null : String(t.published_version), versions: t.versions == null ? undefined : Number(t.versions), pending: t.pending == null ? undefined : Number(t.pending), createdAt: t.created_at };
  }
  function reportRow(r) {
    return { id: String(r.id), trackId: String(r.track_id), kind: r.kind, name: r.name, contact: r.contact, details: r.details, status: r.status, autoHidden: !!r.auto_hidden, createdAt: r.created_at, resolvedAt: r.resolved_at };
  }
}

function fmtLen(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
