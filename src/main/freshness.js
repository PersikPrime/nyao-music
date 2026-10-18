// «Свежесть» волны: вчерашние лайки весят больше прошлогодних.
// Списки лайков у сервисов идут от новых к старым, поэтому вес — по позиции в списке.

/**
 * Случайные n элементов списка (новые — в начале), чем выше fresh (0…100), тем сильнее тянет к началу.
 * fresh 0 — почти равномерно по всему списку, 100 — почти только последние ~5.
 */
export function recencyPick(list, n, fresh = 60, rnd = Math.random) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!items.length || n <= 0) return [];
  const f = Math.max(0, Math.min(100, Number(fresh) || 0)) / 100;
  // τ — «длина памяти»: при свежести 100 ~5 позиций, при 0 — весь список
  const tau = Math.max(5, items.length * Math.pow(1 - f, 2) + 5 * f);
  // ключ Эфраимидиса — Спиракиса: random^(1/вес), больший ключ — раньше в выборке
  return items
    .map((x, i) => ({ x, k: Math.pow(rnd(), 1 / Math.exp(-i / tau)) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, n)
    .map((e) => e.x);
}

/** Доля «подмеса» в волне, % : любимые исполнители и похожее на свежие лайки */
export function boostShare(fresh, favorites) {
  const f = Math.max(0, Math.min(100, Number(fresh) || 0));
  return Math.min(45, (favorites > 0 ? 18 : 0) + f * 0.27);
}

/** Любимые исполнители: объединение двух списков по ref (новые сверху), удалённые на одном — по removed */
export function mergeArtists(a = [], b = []) {
  const out = new Map();
  for (const x of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!x || !x.ref) continue;
    const cur = out.get(x.ref);
    if (!cur || (x.at || 0) > (cur.at || 0)) out.set(x.ref, x);
  }
  return [...out.values()].sort((x, y) => (y.at || 0) - (x.at || 0));
}
