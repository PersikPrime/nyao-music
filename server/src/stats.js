// «Итоги»: сводка по истории прослушиваний за месяц, год или всё время.

/** Основной исполнитель: «A, B feat. C» → «A» */
export function mainArtist(a) {
  const s = String(a || '').split(/,\s+|\s+(?:feat|ft)\.?\s+|\s+x\s+/i)[0].trim();
  return s || String(a || '').trim();
}

/** Границы периода в UTC с учётом часового пояса клиента (tz — смещение в минутах, как getTimezoneOffset с обратным знаком) */
export function periodRange(period, { now = Date.now(), tz = 0, year = null } = {}) {
  const local = new Date(now + tz * 60_000);
  const y = year || local.getUTCFullYear();
  const toUtc = (ms) => ms - tz * 60_000;
  if (period === 'all') return { from: 0, to: now };
  if (period === 'year') {
    const from = toUtc(Date.UTC(y, 0, 1));
    const to = year && year < local.getUTCFullYear() ? toUtc(Date.UTC(y + 1, 0, 1)) : now;
    return { from, to };
  }
  if (period === 'week') return { from: now - 7 * 86_400_000, to: now };
  // месяц — текущий календарный
  return { from: toUtc(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)), to: now };
}

/**
 * rows: [{ track_id, source, title, artist, cover, duration, listened, skipped, played_at }]
 * Минуты считаем по реально прослушанному (не больше длины трека).
 */
export function summarize(rows, { tz = 0 } = {}) {
  const tracks = new Map();
  const artists = new Map();
  const sources = {};
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0); // 0 — понедельник
  const days = new Map();
  let seconds = 0;
  let plays = 0;
  let skips = 0;
  let first = null;
  for (const r of rows) {
    const at = new Date(r.played_at).getTime();
    if (!Number.isFinite(at)) continue;
    const listened = Math.max(0, Math.min(Number(r.listened) || 0, Number(r.duration) > 0 ? Number(r.duration) : Infinity));
    if (r.skipped) skips++;
    if (r.skipped && listened < 30) continue;
    plays++;
    seconds += listened;
    if (!first || at < first.at) first = { at, title: r.title, artist: r.artist, cover: r.cover || null, trackId: r.track_id };
    const t = tracks.get(r.track_id) || { trackId: r.track_id, source: r.source, title: r.title, artist: r.artist, cover: r.cover || null, duration: r.duration || 0, plays: 0, seconds: 0 };
    t.plays++;
    t.seconds += listened;
    if (!t.cover && r.cover) t.cover = r.cover;
    tracks.set(r.track_id, t);
    const name = mainArtist(r.artist);
    if (name) {
      const key = name.toLowerCase();
      const a = artists.get(key) || { name, plays: 0, seconds: 0, cover: null, tracks: new Set() };
      a.plays++;
      a.seconds += listened;
      a.tracks.add(r.track_id);
      if (!a.cover && r.cover) a.cover = r.cover;
      artists.set(key, a);
    }
    const src = r.source || '?';
    sources[src] = (sources[src] || 0) + listened;
    const local = new Date(at + tz * 60_000);
    hours[local.getUTCHours()] += listened;
    weekdays[(local.getUTCDay() + 6) % 7] += listened;
    const day = local.toISOString().slice(0, 10);
    days.set(day, (days.get(day) || 0) + listened);
  }
  // самая длинная серия дней подряд с музыкой
  const sortedDays = [...days.keys()].sort();
  let streak = 0;
  let run = 0;
  let prev = null;
  for (const d of sortedDays) {
    const ms = Date.parse(d + 'T00:00:00Z');
    run = prev != null && ms - prev === 86_400_000 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = ms;
  }
  let busiest = null;
  for (const [date, s] of days) if (!busiest || s > busiest.seconds) busiest = { date, seconds: s };
  const min = (s) => Math.round(s / 60);
  const topHour = seconds ? hours.indexOf(Math.max(...hours)) : null;
  return {
    minutes: min(seconds),
    plays,
    skips,
    tracksUnique: tracks.size,
    artistsUnique: artists.size,
    activeDays: days.size,
    longestStreak: streak,
    topHour,
    hours: hours.map(min),
    weekdays: weekdays.map(min),
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, min(v)]).sort((a, b) => b[1] - a[1])),
    topTracks: [...tracks.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 10).map((t) => ({ ...t, minutes: min(t.seconds), seconds: undefined })),
    topArtists: [...artists.values()].sort((a, b) => b.seconds - a.seconds || b.plays - a.plays).slice(0, 10).map((a) => ({ name: a.name, plays: a.plays, minutes: min(a.seconds), cover: a.cover, tracks: a.tracks.size })),
    busiestDay: busiest ? { date: busiest.date, minutes: min(busiest.seconds) } : null,
    first: first ? { ...first, at: new Date(first.at).toISOString() } : null
  };
}
