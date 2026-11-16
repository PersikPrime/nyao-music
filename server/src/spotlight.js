// Nyao Spotlight на сервере: какая модель сейчас в Red и сводные цифры теневого режима.
// Приложение присылает только счётчики сессии (сколько треков модель знала, сколько было в её топе, скипы) — по согласию,
// без названий треков и истории. Сами файлы модели лежат в релизах GitHub (spotlight-vN) и сверяются по sha256 в приложении.
const VERSION_RE = /^spotlight-v\d{1,4}$/;
const CHANNELS = ['nightly', 'dev', 'stable'];
const int = (v, max = 1e7) => Math.max(0, Math.min(max, Math.round(Number(v)) || 0));

export function spotlightPublicRoutes({ q, HttpError, readJson, limit }) {
  return [
    // активная модель канала; нет записи — приложение остаётся на своей встроенной версии
    ['GET', /^\/spotlight\/model$/, async ({ url }) => {
      const channel = CHANNELS.includes(url.searchParams.get('channel')) ? url.searchParams.get('channel') : 'nightly';
      const { rows } = await q('SELECT version FROM spotlight_models WHERE active_channels LIKE $1 ORDER BY created_at DESC LIMIT 1', [`%${channel}%`]);
      return { version: rows.length ? rows[0].version : null };
    }],
    // сводка теневой сессии: одна строка на запуск приложения, перезаписывается по мере роста
    ['POST', /^\/spotlight\/report$/, async ({ req, s, ip }) => {
      if (limit) limit(ip);
      const b = await readJson(req);
      const sid = String(b.session || '');
      if (!/^[A-Za-z0-9-]{8,64}$/.test(sid)) throw new HttpError(400, 'Нет номера сессии');
      const model = VERSION_RE.test(String(b.model || '')) ? String(b.model) : null;
      if (!model) throw new HttpError(400, 'Неизвестная модель');
      const v = {
        judged: int(b.judged), unknown: int(b.unknown),
        inTop: int(b.inTop && b.inTop.n), inTopSkipped: int(b.inTop && b.inTop.skipped),
        outTop: int(b.outTop && b.outTop.n), outTopSkipped: int(b.outTop && b.outTop.skipped),
        medianRank: b.medianRank == null ? null : int(b.medianRank, 100000), build: int(b.build, 1e6)
      };
      await q(
        `INSERT INTO spotlight_reports (session, user_id, model, build, judged, unknown, in_top, in_top_skipped, out_top, out_top_skipped, median_rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (session) DO UPDATE SET model = $3, build = $4, judged = $5, unknown = $6, in_top = $7, in_top_skipped = $8, out_top = $9, out_top_skipped = $10, median_rank = $11, updated_at = now()
           WHERE spotlight_reports.user_id = $2`,
        [sid, s.uid, model, v.build, v.judged, v.unknown, v.inTop, v.inTopSkipped, v.outTop, v.outTopSkipped, v.medianRank]
      );
      return { ok: true };
    }, true]
  ];
}

export function spotlightAdminRoutes({ q, HttpError, readJson, clip, guard }) {
  return [
    ['GET', /^\/admin\/spotlight$/, guard('spotlight.read', async ({ url }) => {
      const span = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      const since = new Date(Date.now() - span * 86400000);
      const { rows: modelRows } = await q('SELECT * FROM spotlight_models ORDER BY created_at DESC');
      // складываем в JS: строк немного (одна на запуск приложения), а запрос остаётся простым для любой базы
      const { rows: reps } = await q('SELECT * FROM spotlight_reports WHERE updated_at >= $1 ORDER BY updated_at DESC LIMIT 50000', [since]);
      const KEYS = ['judged', 'unknown', 'in_top', 'in_top_skipped', 'out_top', 'out_top_skipped'];
      const blank = () => ({ sessions: 0, users: new Set(), ranks: [], last_at: 0, ...Object.fromEntries(KEYS.map((k) => [k, 0])) });
      const models = new Map();
      const days = new Map();
      for (const r of reps) {
        const at = new Date(r.updated_at);
        const day = at.toISOString().slice(0, 10);
        for (const [map, key] of [[models, r.model], [days, `${day}|${r.model}`]]) {
          if (!map.has(key)) map.set(key, blank());
          const g = map.get(key);
          g.sessions++;
          g.users.add(String(r.user_id));
          for (const k of KEYS) g[k] += Number(r[k]) || 0;
          if (r.median_rank != null) g.ranks.push(Number(r.median_rank));
          g.last_at = Math.max(g.last_at, at.getTime());
        }
      }
      const out = (g) => ({ sessions: g.sessions, users: g.users.size, ...Object.fromEntries(KEYS.map((k) => [k, g[k]])), median_rank: g.ranks.length ? Math.round(g.ranks.reduce((x, y) => x + y, 0) / g.ranks.length) : null, last_at: g.last_at || null });
      const byModel = [...models].sort(([x], [y]) => x.localeCompare(y)).map(([model, g]) => ({ model, ...out(g) }));
      const byDay = [...days].sort(([x], [y]) => y.localeCompare(x)).map(([k, g]) => ({ day: k.split('|')[0], model: k.split('|')[1], ...out(g) }));
      return {
        days: span,
        models: modelRows.map((r) => ({ version: r.version, notes: r.notes, hit10: r.hit10 == null ? null : Number(r.hit10), channels: String(r.active_channels || '').split(',').filter(Boolean), createdAt: new Date(r.created_at).getTime() })),
        byModel,
        byDay
      };
    }), true],

    ['PUT', /^\/admin\/spotlight\/models\/(spotlight-v\d{1,4})$/, guard('spotlight.write', async ({ m, req, s, a }) => {
      const b = await readJson(req);
      const channels = (Array.isArray(b.channels) ? b.channels : []).filter((c) => CHANNELS.includes(c));
      const hit10 = b.hit10 === '' || b.hit10 == null ? null : Math.max(0, Math.min(100, Number(b.hit10)));
      // канал может слушать только одну модель: у остальных он снимается
      const { rows: others } = await q('SELECT version, active_channels FROM spotlight_models WHERE version <> $1', [m[1]]);
      for (const o of others) {
        const had = String(o.active_channels || '').split(',').filter(Boolean);
        const left = had.filter((c) => !channels.includes(c));
        if (left.length !== had.length) await q('UPDATE spotlight_models SET active_channels = $2 WHERE version = $1', [o.version, left.join(',')]);
      }
      const { rows } = await q(
        `INSERT INTO spotlight_models (version, notes, hit10, active_channels, by_user) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (version) DO UPDATE SET notes = $2, hit10 = $3, active_channels = $4, by_user = $5
         RETURNING *`,
        [m[1], clip(String(b.notes || '').trim(), 400), Number.isFinite(hit10) ? hit10 : null, channels.join(','), s.uid]
      );
      await a.audit('spotlight.model', { type: 'spotlight', id: m[1], params: { channels, hit10 } });
      return { version: rows[0].version, channels };
    }, { write: true }), true],

    ['DELETE', /^\/admin\/spotlight\/models\/(spotlight-v\d{1,4})$/, guard('spotlight.write', async ({ m, a }) => {
      const { rowCount } = await q('DELETE FROM spotlight_models WHERE version = $1', [m[1]]);
      if (!rowCount) throw new HttpError(404, 'Нет такой модели');
      await a.audit('spotlight.model.delete', { type: 'spotlight', id: m[1] });
      return { ok: true };
    }, { write: true }), true]
  ];
}
