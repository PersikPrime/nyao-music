// Логика Nyao Connect, «Слушать вместе» и «Итогов» без привязки к экрану — чтобы её можно было проверить отдельно.

export const REACTIONS = ['🔥', '❤️', '😂', '😮', '👏', '🎶'];
export const JOIN_BASE = 'https://api.nmusic.bixtl.cc/join/';

/** Где сейчас трек на другом устройстве: позиция + сколько прошло с последнего сообщения */
export function livePosition(d, now = Date.now()) {
  if (!d || !d.track) return 0;
  const p = (Number(d.position) || 0) + (d.playing && d.updatedAt ? (now - d.updatedAt) / 1000 : 0);
  return d.track.duration ? Math.min(p, d.track.duration) : p;
}

/** Код комнаты из того, что ввели: «abc-123», ссылка-приглашение… → «ABC123» или null */
export function parseRoomCode(input) {
  const s = String(input || '').trim();
  const m = s.match(/join\/([A-Za-z0-9]{6})\b/);
  const code = (m ? m[1] : s.replace(/[^A-Za-z0-9]/g, '')).toUpperCase();
  return /^[A-Z0-9]{6}$/.test(code) ? code : null;
}

/**
 * Что сделать гостю, чтобы играть в такт с хостом.
 * local: { hostTrackId — какой трек хоста сейчас играет у гостя, position, playing }
 * remote: состояние комнаты { track, position, playing }
 * → { load: true/false, seek: секунды|null, play: true/false/null }
 */
export function roomSyncPlan(local, remote, { tolerance = 4 } = {}) {
  if (!remote || !remote.track) return { load: false, seek: null, play: local && local.playing ? false : null };
  if (!local || local.hostTrackId !== remote.track.id) return { load: true, seek: remote.position > 2 ? remote.position : null, play: remote.playing };
  const drift = Math.abs((local.position || 0) - (remote.position || 0));
  return {
    load: false,
    seek: drift > tolerance ? remote.position : null,
    play: remote.playing === !!local.playing ? null : remote.playing
  };
}

/** Очередь для отправки на другое устройство: текущий трек и дальше (не больше 300) */
export function queueForTransfer(queue, index, max = 300) {
  if (!Array.isArray(queue) || index < 0 || index >= queue.length) return { tracks: [], index: 0 };
  const from = Math.max(0, index - 20);
  const tracks = queue.slice(from, from + max);
  return { tracks, index: index - from };
}

// ---------- Итоги ----------

export const PERIODS = [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год'], ['all', 'Всё время']];

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/** 1234 → «1 234» */
export function num(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Минуты → «20 ч 34 мин» / «45 минут» */
export function minutesText(m) {
  const n = Math.round(Number(m) || 0);
  if (n < 60) return `${n} ${plural(n, 'минута', 'минуты', 'минут')}`;
  const h = Math.floor(n / 60);
  return `${num(h)} ч ${n % 60} мин`;
}

export function hourText(h) {
  if (h == null) return '—';
  if (h < 5) return 'ночью';
  if (h < 12) return 'утром';
  if (h < 18) return 'днём';
  return 'вечером';
}

/** Подпись периода: «Октябрь 2026», «2026», «за 7 дней», «за всё время» */
export function periodTitle(period, from) {
  const d = from ? new Date(from) : new Date();
  if (period === 'week') return 'Последние 7 дней';
  if (period === 'all') return 'За всё время';
  if (period === 'year') return String(new Date(d.getTime() + 86_400_000).getFullYear());
  const month = new Date(d.getTime() + 86_400_000).toLocaleString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  return month.charAt(0).toUpperCase() + month.slice(1);
}

/** Короткие «факты» для карточек итогов */
export function statFacts(s) {
  if (!s || !s.plays) return [];
  const out = [];
  out.push({ big: num(s.tracksUnique), label: plural(s.tracksUnique, 'трек', 'трека', 'треков') });
  out.push({ big: num(s.artistsUnique), label: plural(s.artistsUnique, 'исполнитель', 'исполнителя', 'исполнителей') });
  if (s.longestStreak > 1) out.push({ big: num(s.longestStreak), label: `${plural(s.longestStreak, 'день', 'дня', 'дней')} подряд с музыкой` });
  if (s.topHour != null) out.push({ big: `${String(s.topHour).padStart(2, '0')}:00`, label: `чаще всего слушаешь ${hourText(s.topHour)}` });
  if (s.busiestDay) out.push({ big: minutesText(s.busiestDay.minutes), label: `в самый музыкальный день — ${new Date(s.busiestDay.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` });
  if (s.plays) out.push({ big: `${Math.round((s.skips / (s.plays + s.skips)) * 100)}%`, label: 'треков пропущено' });
  return out;
}
