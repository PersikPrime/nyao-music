// Admin API: лейбл WithNyao Blue — учёт ISRC (без повторов даже при двух админах сразу), релизы и треки.
// Формат ISRC: CC-XXX-YY-NNNNN (страна, код регистранта от IFPI, год, порядковый номер). Префикс CC-XXX
// задаётся в настройках; пока его нет — коды не выдаются.

const STATUSES = new Set(['preparing', 'sent', 'released']);
const PREFIX_RE = /^[A-Z]{2}-?[A-Z0-9]{3}$/;

export function labelRoutes({ q, HttpError, readJson, clip, guard, getSetting, setSetting }) {
  const num = (v, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

  async function settings() {
    const s = (await getSetting('label')) || {};
    return { prefix: s.prefix || '', name: s.name || 'WithNyao Blue' };
  }

  /** Следующий свободный номер в этом году и сам код */
  async function nextCode(prefix, year) {
    const { rows } = await q('SELECT max(seq) AS n FROM label_isrc WHERE year = $1', [year]);
    const seq = (Number(rows[0] && rows[0].n) || 0) + 1;
    if (seq > 99999) throw new HttpError(409, 'В этом году кончились номера ISRC');
    const yy = String(year % 100).padStart(2, '0');
    return { seq, code: `${prefix.replace('-', '')}${yy}${String(seq).padStart(5, '0')}` };
  }

  const releaseRow = (r) => ({ id: String(r.id), title: r.title, artists: r.artists, upc: r.upc, genre: r.genre, releaseDate: r.release_date, pLine: r.p_line, cLine: r.c_line, cover: r.cover, status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at, tracks: r.tracks == null ? undefined : Number(r.tracks) });
  const trackRow = (t) => ({ id: String(t.id), releaseId: String(t.release_id), position: Number(t.position), title: t.title, artists: t.artists, isrc: t.isrc || null, duration: Number(t.duration) || 0 });

  async function releaseOr404(id) {
    const { rows } = await q('SELECT * FROM label_releases WHERE id = $1', [id]);
    if (!rows.length) throw new HttpError(404, 'Нет такого релиза');
    return rows[0];
  }

  const fields = (b, cur = {}) => ({
    title: b.title !== undefined ? clip(String(b.title).trim(), 200) : cur.title,
    artists: b.artists !== undefined ? clip(String(b.artists).trim(), 300) : cur.artists ?? '',
    upc: b.upc !== undefined ? clip(String(b.upc).replace(/\s+/g, ''), 20) : cur.upc ?? '',
    genre: b.genre !== undefined ? clip(String(b.genre).trim(), 60) : cur.genre ?? '',
    release_date: b.releaseDate !== undefined ? clip(String(b.releaseDate).trim(), 20) : cur.release_date ?? '',
    p_line: b.pLine !== undefined ? clip(String(b.pLine).trim(), 200) : cur.p_line ?? '',
    c_line: b.cLine !== undefined ? clip(String(b.cLine).trim(), 200) : cur.c_line ?? '',
    cover: b.cover !== undefined ? clip(String(b.cover).trim(), 500) : cur.cover ?? '',
    status: b.status !== undefined ? String(b.status) : cur.status ?? 'preparing',
    notes: b.notes !== undefined ? clip(String(b.notes), 4000) : cur.notes ?? ''
  });

  return [
    ['GET', /^\/admin\/label\/settings$/, guard('label.read', async () => {
      const s = await settings();
      const year = new Date().getUTCFullYear();
      const next = s.prefix ? await nextCode(s.prefix, year) : null;
      const total = await q('SELECT count(*) AS n FROM label_isrc');
      return { ...s, year, next: next ? next.code : null, issued: Number(total.rows[0].n) };
    }), true],

    ['PUT', /^\/admin\/label\/settings$/, guard('label.write', async ({ req, a }) => {
      const b = await readJson(req);
      const cur = await settings();
      const prefix = b.prefix !== undefined ? String(b.prefix).trim().toUpperCase() : cur.prefix;
      if (prefix && !PREFIX_RE.test(prefix)) throw new HttpError(400, 'Префикс ISRC — страна и код регистранта, например RU-A1B');
      const next = { prefix: prefix ? `${prefix.slice(0, 2)}-${prefix.replace('-', '').slice(2)}` : '', name: b.name !== undefined ? clip(String(b.name).trim(), 80) || 'WithNyao Blue' : cur.name };
      await setSetting('label', next);
      await a.audit('label.settings', { type: 'label', id: 'settings', params: next });
      return next;
    }, { write: true }), true],

    ['GET', /^\/admin\/label\/isrc$/, guard('label.read', async ({ url }) => {
      const lim = Math.min(2000, Math.max(1, num(url.searchParams.get('limit'), 500)));
      const { rows } = await q(`SELECT i.*, u.name AS by_name FROM label_isrc i LEFT JOIN users u ON u.id = i.by_user ORDER BY i.year DESC, i.seq DESC LIMIT ${lim}`);
      return { items: rows.map((r) => ({ code: r.code, year: Number(r.year), seq: Number(r.seq), trackTitle: r.track_title, trackId: r.track_id == null ? null : String(r.track_id), by: r.by_name || null, createdAt: r.created_at })) };
    }), true],

    // новый код: уникальный индекс по коду + повтор при гонке — два админа никогда не получат один ISRC
    ['POST', /^\/admin\/label\/isrc\/next$/, guard('label.write', async ({ req, s, a }) => {
      const b = await readJson(req);
      const st = await settings();
      if (!st.prefix) throw new HttpError(409, 'Сначала укажи префикс ISRC от IFPI в настройках лейбла');
      const title = clip(String(b.trackTitle || '').trim(), 200);
      const trackId = b.trackId ? Number(b.trackId) : null;
      const year = Math.min(2099, Math.max(2000, num(b.year, new Date().getUTCFullYear())));
      if (trackId) {
        const t = await q('SELECT id, isrc FROM label_tracks WHERE id = $1', [trackId]);
        if (!t.rows.length) throw new HttpError(404, 'Нет такого трека');
        if (t.rows[0].isrc) throw new HttpError(409, `У трека уже есть ISRC ${t.rows[0].isrc}`);
      }
      let issued = null;
      for (let attempt = 0; attempt < 8 && !issued; attempt++) {
        const { seq, code } = await nextCode(st.prefix, year);
        try {
          await q('INSERT INTO label_isrc (code, year, seq, track_title, track_id, by_user) VALUES ($1, $2, $3, $4, $5, $6)', [code, year, seq, title, trackId, s.uid]);
          issued = { code, seq, year };
        } catch (e) {
          // сосед успел первым — берём следующий номер
          if (!/unique|duplicate|уник/i.test(String(e.message))) throw e;
        }
      }
      if (!issued) throw new HttpError(409, 'Не удалось выдать код — попробуй ещё раз');
      if (trackId) await q('UPDATE label_tracks SET isrc = $1 WHERE id = $2', [issued.code, trackId]);
      await a.audit('label.isrc', { type: 'isrc', id: issued.code, params: { trackTitle: title, trackId } });
      return issued;
    }, { write: true }), true],

    ['GET', /^\/admin\/label\/releases$/, guard('label.read', async () => {
      const { rows } = await q('SELECT * FROM label_releases ORDER BY id DESC LIMIT 1000');
      const counts = await q('SELECT release_id, count(*) AS n FROM label_tracks GROUP BY release_id');
      const byRel = new Map(counts.rows.map((c) => [String(c.release_id), Number(c.n)]));
      return { items: rows.map((r) => releaseRow({ ...r, tracks: byRel.get(String(r.id)) || 0 })) };
    }), true],

    ['POST', /^\/admin\/label\/releases$/, guard('label.write', async ({ req, a }) => {
      const b = await readJson(req);
      const f = fields(b);
      if (!f.title) throw new HttpError(400, 'Нужно название релиза');
      if (!STATUSES.has(f.status)) throw new HttpError(400, 'status: preparing, sent или released');
      const { rows } = await q(
        'INSERT INTO label_releases (title, artists, upc, genre, release_date, p_line, c_line, cover, status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
        [f.title, f.artists, f.upc, f.genre, f.release_date, f.p_line, f.c_line, f.cover, f.status, f.notes]
      );
      await a.audit('label.release.create', { type: 'label_release', id: rows[0].id, params: { title: f.title } });
      return { item: releaseRow(rows[0]) };
    }, { write: true }), true],

    ['GET', /^\/admin\/label\/releases\/(\d+)$/, guard('label.read', async ({ m }) => {
      const r = await releaseOr404(m[1]);
      const t = await q('SELECT * FROM label_tracks WHERE release_id = $1 ORDER BY position, id', [m[1]]);
      return { item: releaseRow(r), tracks: t.rows.map(trackRow) };
    }), true],

    ['PUT', /^\/admin\/label\/releases\/(\d+)$/, guard('label.write', async ({ m, req, a }) => {
      const cur = await releaseOr404(m[1]);
      const b = await readJson(req);
      const f = fields(b, cur);
      if (!f.title) throw new HttpError(400, 'Нужно название релиза');
      if (!STATUSES.has(f.status)) throw new HttpError(400, 'status: preparing, sent или released');
      const { rows } = await q(
        'UPDATE label_releases SET title = $1, artists = $2, upc = $3, genre = $4, release_date = $5, p_line = $6, c_line = $7, cover = $8, status = $9, notes = $10, updated_at = now() WHERE id = $11 RETURNING *',
        [f.title, f.artists, f.upc, f.genre, f.release_date, f.p_line, f.c_line, f.cover, f.status, f.notes, m[1]]
      );
      await a.audit('label.release.update', { type: 'label_release', id: m[1], params: b });
      return { item: releaseRow(rows[0]) };
    }, { write: true }), true],

    ['DELETE', /^\/admin\/label\/releases\/(\d+)$/, guard('label.write', async ({ m, a }) => {
      await releaseOr404(m[1]);
      await q('DELETE FROM label_releases WHERE id = $1', [m[1]]);
      await a.audit('label.release.delete', { type: 'label_release', id: m[1] });
      return { ok: true };
    }, { write: true }), true],

    ['POST', /^\/admin\/label\/releases\/(\d+)\/tracks$/, guard('label.write', async ({ m, req, a }) => {
      await releaseOr404(m[1]);
      const b = await readJson(req);
      const title = clip(String(b.title || '').trim(), 200);
      if (!title) throw new HttpError(400, 'Нужно название трека');
      const pos = await q('SELECT max(position) AS n FROM label_tracks WHERE release_id = $1', [m[1]]);
      const isrc = b.isrc ? String(b.isrc).replace(/[\s-]/g, '').toUpperCase() : null;
      if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) throw new HttpError(400, 'ISRC — 12 знаков, например RUA1B2600001');
      const { rows } = await q(
        'INSERT INTO label_tracks (release_id, position, title, artists, isrc, duration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [m[1], b.position ? num(b.position, 1) : (Number(pos.rows[0] && pos.rows[0].n) || 0) + 1, title, clip(String(b.artists || '').trim(), 300), isrc, Math.max(0, Math.round(num(b.duration)))]
      );
      await q('UPDATE label_releases SET updated_at = now() WHERE id = $1', [m[1]]);
      await a.audit('label.track.create', { type: 'label_release', id: m[1], params: { title, isrc } });
      return { item: trackRow(rows[0]) };
    }, { write: true }), true],

    ['PUT', /^\/admin\/label\/tracks\/(\d+)$/, guard('label.write', async ({ m, req, a }) => {
      const { rows: cur } = await q('SELECT * FROM label_tracks WHERE id = $1', [m[1]]);
      if (!cur.length) throw new HttpError(404, 'Нет такого трека');
      const t = cur[0];
      const b = await readJson(req);
      const title = b.title !== undefined ? clip(String(b.title).trim(), 200) : t.title;
      if (!title) throw new HttpError(400, 'Нужно название трека');
      let isrc = t.isrc;
      if (b.isrc !== undefined) {
        isrc = b.isrc ? String(b.isrc).replace(/[\s-]/g, '').toUpperCase() : null;
        if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) throw new HttpError(400, 'ISRC — 12 знаков, например RUA1B2600001');
      }
      const { rows } = await q(
        'UPDATE label_tracks SET title = $1, artists = $2, isrc = $3, duration = $4, position = $5 WHERE id = $6 RETURNING *',
        [title, b.artists !== undefined ? clip(String(b.artists).trim(), 300) : t.artists, isrc, b.duration !== undefined ? Math.max(0, Math.round(num(b.duration))) : t.duration, b.position !== undefined ? num(b.position, t.position) : t.position, m[1]]
      );
      await q('UPDATE label_releases SET updated_at = now() WHERE id = $1', [t.release_id]);
      await a.audit('label.track.update', { type: 'label_release', id: t.release_id, params: { trackId: m[1], ...b } });
      return { item: trackRow(rows[0]) };
    }, { write: true }), true],

    ['DELETE', /^\/admin\/label\/tracks\/(\d+)$/, guard('label.write', async ({ m, a }) => {
      const { rows } = await q('DELETE FROM label_tracks WHERE id = $1 RETURNING release_id', [m[1]]);
      if (!rows.length) throw new HttpError(404, 'Нет такого трека');
      await a.audit('label.track.delete', { type: 'label_release', id: rows[0].release_id, params: { trackId: m[1] } });
      return { ok: true };
    }, { write: true }), true]
  ];
}
