// Тексты песен (lyrics.withnyao.app, API — api.corrode5-15.withnyao.app).
// Пишут пользователи (вход — аккаунт Nyao через Telegram), проверяет специалист, после проверки текст публикуется.
// Публичная часть API совместима с LRCLIB (/api/get, /api/search) — подходит существующим клиентам.
// Жалоба правообладателя скрывает трек сразу, решение — за админом.

const MAX_TEXT = 20_000;
const MAX_LINES = 500;
const LRC_LINE = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;
const LRC_META = /^\[(ar|ti|al|au|by|length|offset|re|ve|#):.*\]$/i;
const ROLES = new Set(['specialist', 'admin']);

/** Название и исполнитель для поиска: без регистра, скобок с feat/remaster и знаков */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*(feat|ft\.|prod|remaster|version|версия|edit)[^)\]}]*[)\]}]/g, ' ')
    .replace(/\s(feat|ft)\.?\s.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const ms = (m, s, f = '') => (Number(m) * 60 + Number(s)) * 1000 + (f ? Math.round(Number(f.padEnd(3, '0'))) : 0);

/** Разбор LRC: строки по времени. Ошибка — с номером строки, чтобы автор понял, где поправить */
export function parseLrc(text) {
  const lines = [];
  const src = String(text || '').replace(/\r/g, '').split('\n');
  for (let i = 0; i < src.length; i++) {
    const raw = src[i].trim();
    if (!raw || LRC_META.test(raw)) continue;
    const m = LRC_LINE.exec(raw);
    if (!m) throw new Error(`Строка ${i + 1}: нет метки времени [мм:сс.xx]`);
    if (Number(m[2]) > 59) throw new Error(`Строка ${i + 1}: секунд больше 59`);
    lines.push({ at: ms(m[1], m[2], m[3]), text: m[4].trim() });
  }
  return lines;
}

const fmtTime = (t) => {
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
};

/**
 * Автопроверка перед очередью специалиста. → { plain, synced, instrumental } в чистом виде,
 * или ошибка с понятной причиной (черновик сразу возвращается автору)
 */
export function checkLyrics({ plain = '', synced = '', instrumental = false, duration = 0 }) {
  if (instrumental) return { plain: '', synced: '', instrumental: true };
  plain = String(plain || '').replace(/\r/g, '');
  synced = String(synced || '').replace(/\r/g, '');
  if (plain.length + synced.length > MAX_TEXT * 2 || plain.length > MAX_TEXT || synced.length > MAX_TEXT) throw new Error('Текст слишком длинный');
  if (/(https?:\/\/|www\.)/i.test(plain + synced)) throw new Error('Ссылки в тексте не нужны');
  let out = '';
  if (synced.trim()) {
    const lines = parseLrc(synced);
    if (!lines.length) throw new Error('В синхронизации нет строк');
    if (lines.length > MAX_LINES) throw new Error('Слишком много строк');
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].at < lines[i - 1].at) throw new Error(`Строка «${lines[i].text || '…'}» стоит раньше предыдущей — проверь время`);
    }
    const last = lines[lines.length - 1].at;
    if (duration > 0 && last > (duration + 3) * 1000) throw new Error('Последняя строка позже конца трека — проверь длительность или время');
    if (!lines.some((l) => l.text)) throw new Error('В синхронизации нет текста');
    synced = lines.map((l) => `${fmtTime(l.at)} ${l.text}`.trimEnd()).join('\n');
    // обычный текст — из синхронизации, чтобы они не расходились
    out = lines.map((l) => l.text).join('\n');
  } else {
    synced = '';
    out = plain;
  }
  out = out.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!out) throw new Error('Пустой текст — или отметь трек как инструментал');
  if (out.split('\n').length > MAX_LINES) throw new Error('Слишком много строк');
  return { plain: out, synced, instrumental: false };
}

/** Трек и опубликованная версия → ответ в формате LRCLIB */
function lrclibShape(r) {
  return {
    id: Number(r.id),
    name: r.title,
    trackName: r.title,
    artistName: r.artist,
    albumName: r.album || '',
    duration: Number(r.duration) || 0,
    instrumental: !!r.instrumental,
    plainLyrics: r.instrumental ? null : r.plain || null,
    syncedLyrics: r.instrumental ? null : r.synced || null
  };
}

const notFound = () => {
  const e = new Error('Текста для этого трека пока нет');
  e.lrclib = true;
  return e;
};

export function lyricsRoutes({ q, HttpError, readJson, clip, limiter, admins = [] }) {
  const writeLimit = limiter(20);
  const reportLimit = limiter(5);
  const readLimit = limiter(300);

  const PUBLISHED = `SELECT t.id, t.title, t.artist, t.album, t.duration, v.plain, v.synced, v.instrumental
      FROM lyrics_tracks t JOIN lyrics_versions v ON v.id = t.published_version
     WHERE NOT t.hidden`;

  /** Роль: из таблицы; админы из LYRICS_ADMINS (Telegram ID); если список пуст — первый аккаунт сервера */
  async function roleOf(s) {
    if (!s) return null;
    const { rows } = await q('SELECT role FROM lyrics_roles WHERE user_id = $1', [s.uid]);
    if (rows.length) return rows[0].role;
    if (admins.length) return admins.includes(String(s.user.tgId)) ? 'admin' : null;
    const first = await q('SELECT min(id) AS id FROM users');
    return first.rows.length && Number(first.rows[0].id) === s.uid ? 'admin' : null;
  }

  async function need(s, ...roles) {
    const r = await roleOf(s);
    if (!roles.includes(r)) throw new HttpError(403, roles.includes('specialist') ? 'Проверять тексты могут только специалисты' : 'Только для админов');
    return r;
  }

  /** Трек по названию, исполнителю и длительности (±2 с, как в LRCLIB) */
  async function findTrack(title, artist, duration, onlyPublished) {
    const { rows } = await q(
      `SELECT t.id, t.duration, t.published_version, t.hidden FROM lyrics_tracks t WHERE t.title_norm = $1 AND t.artist_norm = $2 ORDER BY t.id`,
      [norm(title), norm(artist)]
    );
    const fits = rows.filter((r) => !duration || !r.duration || Math.abs(Number(r.duration) - duration) <= 2);
    const pick = onlyPublished ? fits.filter((r) => r.published_version && !r.hidden) : fits;
    return pick[0] || null;
  }

  async function published(id) {
    const { rows } = await q(`${PUBLISHED} AND t.id = $1`, [id]);
    return rows[0] || null;
  }

  const user = (r, prefix = '') => (r[`${prefix}name`] || r[`${prefix}username`] ? { name: r[`${prefix}name`] || '', username: r[`${prefix}username`] || null } : null);

  const api = [
    // ---------- Публичное чтение (совместимо с LRCLIB) ----------
    ['GET', /^\/api\/get$/, async ({ url, ip }) => {
      readLimit(ip);
      const title = clip(url.searchParams.get('track_name'), 256);
      const artist = clip(url.searchParams.get('artist_name'), 256);
      if (!title || !artist) throw new HttpError(400, 'Нужны track_name и artist_name');
      const t = await findTrack(title, artist, Math.round(Number(url.searchParams.get('duration')) || 0), true);
      const r = t && (await published(t.id));
      if (!r) throw notFound();
      return lrclibShape(r);
    }],
    ['GET', /^\/api\/get\/(\d{1,18})$/, async ({ m, ip }) => {
      readLimit(ip);
      const r = await published(m[1]);
      if (!r) throw notFound();
      return lrclibShape(r);
    }],
    ['GET', /^\/api\/search$/, async ({ url, ip }) => {
      readLimit(ip);
      const words = norm(url.searchParams.get('q') || '').split(' ').filter(Boolean).slice(0, 8);
      const title = norm(url.searchParams.get('track_name') || '');
      const artist = norm(url.searchParams.get('artist_name') || '');
      if (!words.length && !title && !artist) throw new HttpError(400, 'Нужен q или track_name');
      const cond = [];
      const params = [];
      for (const w of words) {
        params.push(`%${w}%`);
        cond.push(`(t.title_norm || ' ' || t.artist_norm) LIKE $${params.length}`);
      }
      if (title) {
        params.push(`%${title}%`);
        cond.push(`t.title_norm LIKE $${params.length}`);
      }
      if (artist) {
        params.push(`%${artist}%`);
        cond.push(`t.artist_norm LIKE $${params.length}`);
      }
      const { rows } = await q(`${PUBLISHED} AND ${cond.join(' AND ')} ORDER BY t.artist_norm, t.title_norm LIMIT 20`, params);
      return rows.map(lrclibShape);
    }],

    // ---------- Для сайта ----------
    ['GET', /^\/api\/stats$/, async () => {
      const { rows } = await q('SELECT count(*) AS n FROM lyrics_tracks WHERE published_version IS NOT NULL AND NOT hidden');
      return { tracks: Number(rows[0].n) };
    }],
    ['GET', /^\/api\/track\/(\d{1,18})$/, async ({ m }) => {
      const { rows } = await q(
        `SELECT t.id, t.title, t.artist, t.album, t.duration, t.hidden, v.plain, v.synced, v.instrumental, v.reviewed_at,
                a.name AS a_name, a.username AS a_username
           FROM lyrics_tracks t
           LEFT JOIN lyrics_versions v ON v.id = t.published_version
           LEFT JOIN users a ON a.id = v.author_id
          WHERE t.id = $1`,
        [m[1]]
      );
      const r = rows[0];
      if (!r) throw new HttpError(404, 'Нет такого трека');
      if (r.hidden) return { id: Number(r.id), title: r.title, artist: r.artist, hidden: true };
      return {
        id: Number(r.id),
        title: r.title,
        artist: r.artist,
        album: r.album,
        duration: Number(r.duration) || 0,
        published: r.reviewed_at
          ? { plain: r.plain, synced: r.synced, instrumental: !!r.instrumental, reviewedAt: r.reviewed_at, author: user(r, 'a_') }
          : null
      };
    }],

    // ---------- Свои тексты ----------
    ['GET', /^\/api\/me$/, async ({ s }) => {
      const { rows } = await q(
        `SELECT v.id, v.status, v.note, v.created_at, v.reviewed_at, t.id AS track_id, t.title, t.artist
           FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id
          WHERE v.author_id = $1 ORDER BY v.created_at DESC LIMIT 100`,
        [s.uid]
      );
      return {
        user: s.user,
        role: await roleOf(s),
        submissions: rows.map((r) => ({ id: Number(r.id), status: r.status, note: r.note, createdAt: r.created_at, reviewedAt: r.reviewed_at, track: { id: Number(r.track_id), title: r.title, artist: r.artist } }))
      };
    }, true],
    ['GET', /^\/api\/version\/(\d{1,18})$/, async ({ m, s }) => {
      // свой черновик (возвращённый на доработку) — чтобы поправить и отправить заново
      const { rows } = await q(
        `SELECT v.*, t.title, t.artist, t.album, t.duration FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id WHERE v.id = $1`,
        [m[1]]
      );
      const v = rows[0];
      if (!v) throw new HttpError(404, 'Нет такой версии');
      if (Number(v.author_id) !== s.uid && !['specialist', 'admin'].includes(await roleOf(s))) throw new HttpError(403, 'Это чужой черновик');
      return { id: Number(v.id), status: v.status, note: v.note, plain: v.plain, synced: v.synced, instrumental: v.instrumental, track: { id: Number(v.track_id), title: v.title, artist: v.artist, album: v.album, duration: Number(v.duration) || 0 } };
    }, true],
    ['POST', /^\/api\/submit$/, async ({ req, s, ip }) => {
      writeLimit(ip);
      const b = await readJson(req);
      let trackId = Number(b.trackId) || 0;
      let duration = 0;
      const check = (d) => {
        try {
          return checkLyrics({ plain: b.plain, synced: b.synced, instrumental: !!b.instrumental, duration: d });
        } catch (e) {
          throw new HttpError(422, e.message);
        }
      };
      let clean;
      if (trackId) {
        const { rows } = await q('SELECT id, duration, hidden FROM lyrics_tracks WHERE id = $1', [trackId]);
        if (!rows.length) throw new HttpError(404, 'Нет такого трека');
        if (rows[0].hidden) throw new HttpError(451, 'Трек снят по жалобе правообладателя');
        duration = Number(rows[0].duration) || 0;
      } else {
        const t = b.track || {};
        const title = clip(String(t.title || '').trim(), 200);
        const artist = clip(String(t.artist || '').trim(), 200);
        duration = Math.max(0, Math.min(36000, Math.round(Number(t.duration) || 0)));
        if (!title || !artist) throw new HttpError(400, 'Укажи название и исполнителя');
        if (!duration) throw new HttpError(400, 'Укажи длительность трека — по ней Nyao отличает версии');
        if (!norm(title) || !norm(artist)) throw new HttpError(400, 'Название или исполнитель без букв и цифр');
        const album = clip(String(t.album || '').trim(), 200);
        const found = await findTrack(title, artist, duration, false);
        if (found) {
          if (found.hidden) throw new HttpError(451, 'Трек снят по жалобе правообладателя');
          trackId = Number(found.id);
          duration = Number(found.duration) || duration;
          clean = check(duration);
          if (album) await q(`UPDATE lyrics_tracks SET album = $1 WHERE id = $2 AND album = ''`, [album, trackId]);
        } else {
          // трек заводим только для текста, который прошёл автопроверку
          clean = check(duration);
          const { rows } = await q(
            `INSERT INTO lyrics_tracks (title, artist, album, duration, title_norm, artist_norm) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [title, artist, album, duration, norm(title), norm(artist)]
          );
          trackId = Number(rows[0].id);
        }
      }
      if (!clean) clean = check(duration);
      const cur = await published(trackId);
      if (cur && cur.plain === clean.plain && cur.synced === clean.synced && !!cur.instrumental === clean.instrumental) throw new HttpError(409, 'Это совпадает с опубликованной версией — менять нечего');
      // один черновик на трек от автора: новая отправка заменяет прежнюю, ещё не проверенную
      const prev = await q(`SELECT id FROM lyrics_versions WHERE track_id = $1 AND author_id = $2 AND status IN ('pending', 'returned') ORDER BY id DESC LIMIT 1`, [trackId, s.uid]);
      if (prev.rows.length) {
        await q(`UPDATE lyrics_versions SET plain = $1, synced = $2, instrumental = $3, status = 'pending', note = '', created_at = now() WHERE id = $4`, [clean.plain, clean.synced, clean.instrumental, prev.rows[0].id]);
        return { ok: true, id: Number(prev.rows[0].id), trackId, status: 'pending' };
      }
      const { rows } = await q(
        `INSERT INTO lyrics_versions (track_id, author_id, plain, synced, instrumental) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [trackId, s.uid, clean.plain, clean.synced, clean.instrumental]
      );
      return { ok: true, id: Number(rows[0].id), trackId, status: 'pending' };
    }, true],

    // ---------- Проверка (специалисты) ----------
    ['GET', /^\/api\/review$/, async ({ s }) => {
      await need(s, 'specialist', 'admin');
      const { rows } = await q(
        `SELECT v.id, v.created_at, v.instrumental, v.synced <> '' AS has_sync, t.id AS track_id, t.title, t.artist, t.duration,
                t.published_version IS NOT NULL AS is_edit, a.name AS a_name, a.username AS a_username
           FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id LEFT JOIN users a ON a.id = v.author_id
          WHERE v.status = 'pending' AND NOT t.hidden ORDER BY v.created_at LIMIT 100`
      );
      return {
        items: rows.map((r) => ({ id: Number(r.id), createdAt: r.created_at, instrumental: r.instrumental, synced: r.has_sync, edit: r.is_edit, author: user(r, 'a_'), track: { id: Number(r.track_id), title: r.title, artist: r.artist, duration: Number(r.duration) || 0 } }))
      };
    }, true],
    ['GET', /^\/api\/review\/(\d{1,18})$/, async ({ m, s }) => {
      await need(s, 'specialist', 'admin');
      const { rows } = await q(
        `SELECT v.*, t.title, t.artist, t.album, t.duration, a.name AS a_name, a.username AS a_username
           FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id LEFT JOIN users a ON a.id = v.author_id WHERE v.id = $1`,
        [m[1]]
      );
      const v = rows[0];
      if (!v) throw new HttpError(404, 'Нет такой версии');
      const cur = await published(v.track_id);
      return {
        id: Number(v.id),
        status: v.status,
        plain: v.plain,
        synced: v.synced,
        instrumental: v.instrumental,
        own: Number(v.author_id) === s.uid,
        author: user(v, 'a_'),
        track: { id: Number(v.track_id), title: v.title, artist: v.artist, album: v.album, duration: Number(v.duration) || 0 },
        current: cur ? { plain: cur.plain, synced: cur.synced, instrumental: !!cur.instrumental } : null
      };
    }, true],
    ['POST', /^\/api\/review\/(\d{1,18})$/, async ({ m, s, req }) => {
      const role = await need(s, 'specialist', 'admin');
      const b = await readJson(req);
      const action = String(b.action || '');
      if (!['accept', 'return', 'reject'].includes(action)) throw new HttpError(400, 'action: accept, return или reject');
      const { rows } = await q(`SELECT v.*, t.duration, t.hidden FROM lyrics_versions v JOIN lyrics_tracks t ON t.id = v.track_id WHERE v.id = $1`, [m[1]]);
      const v = rows[0];
      if (!v) throw new HttpError(404, 'Нет такой версии');
      if (v.status !== 'pending') throw new HttpError(409, 'Эту версию уже проверили');
      if (v.hidden) throw new HttpError(451, 'Трек снят по жалобе правообладателя');
      // свою версию специалист не принимает — нужен второй взгляд (админ может, пока команда маленькая)
      if (Number(v.author_id) === s.uid && role !== 'admin') throw new HttpError(403, 'Свою версию проверяет другой специалист');
      const note = clip(String(b.note || '').trim(), 1000);
      if (action !== 'accept') {
        if (action === 'return' && !note) throw new HttpError(400, 'Напиши автору, что поправить');
        await q(`UPDATE lyrics_versions SET status = $1, note = $2, reviewer_id = $3, reviewed_at = now() WHERE id = $4`, [action === 'return' ? 'returned' : 'rejected', note, s.uid, v.id]);
        return { ok: true, status: action === 'return' ? 'returned' : 'rejected' };
      }
      // специалист может поправить мелочи прямо при проверке
      let clean = { plain: v.plain, synced: v.synced, instrumental: v.instrumental };
      if (b.plain !== undefined || b.synced !== undefined || b.instrumental !== undefined) {
        try {
          clean = checkLyrics({ plain: b.plain ?? v.plain, synced: b.synced ?? v.synced, instrumental: b.instrumental ?? v.instrumental, duration: Number(v.duration) || 0 });
        } catch (e) {
          throw new HttpError(422, e.message);
        }
      }
      await q(`UPDATE lyrics_versions SET status = 'published', plain = $1, synced = $2, instrumental = $3, note = $4, reviewer_id = $5, reviewed_at = now() WHERE id = $6`, [clean.plain, clean.synced, clean.instrumental, note, s.uid, v.id]);
      await q('UPDATE lyrics_tracks SET published_version = $1 WHERE id = $2', [v.id, v.track_id]);
      return { ok: true, status: 'published' };
    }, true],

    // ---------- Жалобы ----------
    ['POST', /^\/api\/report$/, async ({ req, ip }) => {
      reportLimit(ip);
      const b = await readJson(req);
      const trackId = Number(b.trackId) || 0;
      const kind = b.kind === 'copyright' ? 'copyright' : 'wrong';
      const details = clip(String(b.details || '').trim(), 4000);
      const contact = clip(String(b.contact || '').trim(), 200);
      const name = clip(String(b.name || '').trim(), 200);
      const { rows } = await q('SELECT id FROM lyrics_tracks WHERE id = $1', [trackId]);
      if (!rows.length) throw new HttpError(404, 'Нет такого трека');
      if (kind === 'copyright' && (!name || !contact)) throw new HttpError(400, 'Для жалобы правообладателя нужны имя (или компания) и контакт');
      if (!details) throw new HttpError(400, 'Опиши, в чём дело');
      await q('INSERT INTO lyrics_reports (track_id, kind, name, contact, details) VALUES ($1, $2, $3, $4, $5)', [trackId, kind, name, contact, details]);
      // правообладатель: скрываем сразу, разбирается админ
      if (kind === 'copyright') await q('UPDATE lyrics_tracks SET hidden = true WHERE id = $1', [trackId]);
      return { ok: true, hidden: kind === 'copyright' };
    }],

    // ---------- Админка ----------
    ['GET', /^\/api\/admin\/reports$/, async ({ s, url }) => {
      await need(s, 'admin');
      const all = url.searchParams.get('all') === '1';
      const { rows } = await q(
        `SELECT r.*, t.title, t.artist, t.hidden FROM lyrics_reports r JOIN lyrics_tracks t ON t.id = r.track_id
          ${all ? '' : "WHERE r.status = 'open'"} ORDER BY r.created_at DESC LIMIT 200`
      );
      return {
        items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, name: r.name, contact: r.contact, details: r.details, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, track: { id: Number(r.track_id), title: r.title, artist: r.artist, hidden: r.hidden } }))
      };
    }, true],
    ['POST', /^\/api\/admin\/reports\/(\d{1,18})$/, async ({ m, s, req }) => {
      await need(s, 'admin');
      const b = await readJson(req);
      const action = String(b.action || '');
      if (!['hide', 'restore', 'close'].includes(action)) throw new HttpError(400, 'action: hide, restore или close');
      const { rows } = await q('SELECT track_id FROM lyrics_reports WHERE id = $1', [m[1]]);
      if (!rows.length) throw new HttpError(404, 'Нет такой жалобы');
      if (action === 'hide') await q('UPDATE lyrics_tracks SET hidden = true WHERE id = $1', [rows[0].track_id]);
      if (action === 'restore') await q('UPDATE lyrics_tracks SET hidden = false WHERE id = $1', [rows[0].track_id]);
      await q(`UPDATE lyrics_reports SET status = $1, resolved_by = $2, resolved_at = now() WHERE id = $3`, [action === 'close' ? 'closed' : action === 'hide' ? 'hidden' : 'restored', s.uid, m[1]]);
      return { ok: true };
    }, true],
    ['GET', /^\/api\/admin\/roles$/, async ({ s }) => {
      await need(s, 'admin');
      const { rows } = await q(`SELECT r.user_id, r.role, u.tg_id, u.name, u.username FROM lyrics_roles r JOIN users u ON u.id = r.user_id ORDER BY r.created_at`);
      return { items: rows.map((r) => ({ userId: String(r.user_id), tgId: String(r.tg_id), name: r.name, username: r.username, role: r.role })) };
    }, true],
    ['POST', /^\/api\/admin\/roles$/, async ({ s, req }) => {
      await need(s, 'admin');
      const b = await readJson(req);
      const who = String(b.user || '').trim().replace(/^@/, '');
      const role = b.role === null || b.role === '' ? null : String(b.role);
      if (!who) throw new HttpError(400, 'Кого назначить: @username или Telegram ID');
      if (role && !ROLES.has(role)) throw new HttpError(400, 'Роль: specialist или admin');
      const { rows } = await q(`SELECT id FROM users WHERE tg_id = $1 OR lower(username) = lower($1) LIMIT 1`, [who]);
      if (!rows.length) throw new HttpError(404, 'Такой человек ещё не входил в аккаунт Nyao');
      const uid = Number(rows[0].id);
      if (uid === s.uid && role !== 'admin') throw new HttpError(400, 'Себя разжаловать нельзя');
      await q('DELETE FROM lyrics_roles WHERE user_id = $1', [uid]);
      if (role) await q('INSERT INTO lyrics_roles (user_id, role) VALUES ($1, $2)', [uid, role]);
      return { ok: true };
    }, true]
  ];
  return api;
}

/** Ошибка «нет текста» в формате LRCLIB — клиенты LRCLIB ждут именно его */
export function lrclibError(e) {
  return e && e.lrclib ? { status: 404, body: { code: 404, name: 'TrackNotFound', message: e.message } } : null;
}
