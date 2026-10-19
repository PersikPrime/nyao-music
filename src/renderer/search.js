// Поиск: склейка результатов сервисов и «умное» ранжирование — без привязки к экрану, чтобы проверить отдельно.

/** Имя для сравнения: без регистра, ё→е, без знаков */
export function normName(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function artistsOf(t) {
  return String(t.artist || '').split(/,|&|\s+(?:feat|ft)\.?\s+/i).map(normName).filter(Boolean);
}

/**
 * res — ответ поиска { ya, yt, sc, vk, artists?, albums? }, filter — 'all' | сервис, q — запрос.
 * → { tracks, best, artists, albums }. Если запрос — имя исполнителя (best), его собственные треки идут первыми.
 */
export function arrangeSearch(res, filter = 'all', q = '') {
  if (!res) return { tracks: [], best: null, artists: [], albums: [] };
  const lists = [res.sp || [], res.ya || [], res.yt || [], res.sc || [], res.vk || []];
  let tracks = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) tracks.push(l[i]);
  if (filter !== 'all') tracks = tracks.filter((t) => t.source === filter);
  const nq = normName(q);
  let artists = res.artists || [];
  let albums = res.albums || [];
  if (filter !== 'all') {
    artists = artists.filter((a) => a.source === filter);
    albums = albums.filter((a) => a.source === filter);
  }
  const best = nq ? artists.find((a) => normName(a.name) === nq) || null : null;
  if (best) {
    const name = normName(best.name);
    const own = tracks.filter((t) => artistsOf(t).includes(name));
    tracks = [...own, ...tracks.filter((t) => !own.includes(t))];
  }
  return { tracks, best, artists, albums };
}

/** Исполнители из нескольких сервисов: без повторов по имени, точные совпадения с запросом первыми */
export function mergeArtists(lists, q = '', limit = 10) {
  const nq = normName(q);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) {
    for (const l of lists) {
      const a = l[i];
      if (!a || !a.name) continue;
      const k = normName(a.name);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
  }
  out.sort((a, b) => (normName(b.name) === nq) - (normName(a.name) === nq));
  return out.slice(0, limit);
}
