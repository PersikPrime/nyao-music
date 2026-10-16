// Подписи для блока «Новые релизы любимых исполнителей»

/** «Вышло недавно» — для подписи на карточке релиза */
export function releaseAgo(iso, now = Date.now()) {
  const d = Math.floor((now - Date.parse(iso)) / 86400000);
  if (!Number.isFinite(d)) return '';
  if (d <= 0) return 'Сегодня';
  if (d === 1) return 'Вчера';
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  if (d < 30) {
    const w = Math.floor(d / 7);
    return `${w} ${plural(w, 'неделю', 'недели', 'недель')} назад`;
  }
  const m = Math.floor(d / 30);
  return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`;
}
export function plural(n, one, few, many) {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
