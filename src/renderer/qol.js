// Мелочи, которые делают плеер удобнее (0.10):
//  • таймер сна — через N минут или после этого трека, громкость плавно затихает за последние 30 секунд;
//  • место в длинных треках (подкасты, миксы, сеты длиннее 15 минут) запоминается и продолжается с него;
//  • ночной предел громкости — с 23:00 до 7:00 не громче выбранного;
//  • громкость при запуске — как была или заданная.
// Чистые функции вынесены отдельно — их проверяют тесты.

export const LONG_TRACK = 15 * 60; // сек: с какой длины помним место
export const SLEEP_FADE = 30; // сек: затихание перед паузой
const POS_KEY = 'nyao.positions';

/** Ночь ли сейчас: с from до to часов (через полночь) */
export function isNight(date = new Date(), from = 23, to = 7) {
  const h = date.getHours();
  return from > to ? h >= from || h < to : h >= from && h < to;
}

/** Громкость, которую реально ставим: ночью не выше предела */
export function cappedVolume(v, { nightCap = 0, now = new Date() } = {}) {
  const x = Math.max(0, Math.min(1, Number(v) || 0));
  return nightCap > 0 && isNight(now) ? Math.min(x, nightCap) : x;
}

/** Громкость при запуске: 'last' — как была, число 0..1 — заданная */
export function startupVolume(settings) {
  const v = settings && settings.startVolume;
  if (v === undefined || v === null || v === 'last') return Number((settings && settings.volume) ?? 0.8);
  return Math.max(0, Math.min(1, Number(v)));
}

/** С какого места продолжить длинный трек: только если ушли дальше минуты и не дослушали до последней минуты */
export function resumePoint(saved, duration) {
  if (!saved || !Number.isFinite(duration) || duration < LONG_TRACK) return 0;
  return saved > 60 && saved < duration - 60 ? saved : 0;
}

/** Множитель громкости при затихании перед сном: 1 → 0 за последние SLEEP_FADE секунд */
export function sleepGain(leftSec) {
  if (leftSec >= SLEEP_FADE) return 1;
  return Math.max(0, leftSec / SLEEP_FADE);
}

function readPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') || {}; } catch { return {}; }
}
function writePositions(map) {
  try {
    const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
    localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* хранилище недоступно — просто не запоминаем */ }
}

/**
 * @param {object} o
 * @param {any} o.player         плеер окна (audio, current, pause(), events 'time' | 'track')
 * @param {() => object} o.settings
 * @param {(v: number) => void} o.applyVolume  поставить громкость (уже с учётом предела)
 * @param {(t: string) => void} o.toast
 */
export function createQol({ player, settings, applyVolume, toast }) {
  const sleep = { until: 0, afterTrack: false, trackId: null, timer: 0 };
  let userVolume = 1;
  let savedAt = 0;
  let resumedId = null;

  // ---------- громкость ----------
  function setVolume(v) {
    userVolume = Math.max(0, Math.min(1, Number(v) || 0));
    apply();
  }
  function apply() {
    const s = settings() || {};
    let v = cappedVolume(userVolume, { nightCap: s.nightCap ? Number(s.nightCapLevel) || 0.4 : 0 });
    if (sleep.until) v *= sleepGain((sleep.until - Date.now()) / 1000);
    applyVolume(v);
  }
  /** Ночной предел срабатывает и на уже открытом окне — раз в минуту сверяемся с часами */
  setInterval(apply, 60_000);

  // ---------- таймер сна ----------
  function stopSleep(silent = false) {
    clearInterval(sleep.timer);
    const was = sleep.until || sleep.afterTrack;
    Object.assign(sleep, { until: 0, afterTrack: false, trackId: null, timer: 0 });
    apply();
    if (was && !silent) toast('Таймер сна выключен');
  }
  function startSleep(minutes) {
    stopSleep(true);
    if (minutes === 'track') {
      sleep.afterTrack = true;
      sleep.trackId = player.current && player.current.id;
      toast('Пауза после этого трека');
      return;
    }
    sleep.until = Date.now() + minutes * 60_000;
    sleep.timer = setInterval(() => {
      if (Date.now() >= sleep.until) {
        player.pause();
        stopSleep(true);
        toast('Спокойной ночи — пауза по таймеру сна');
      } else apply();
    }, 1000);
    toast(`Пауза через ${minutes} мин`);
  }
  function sleepLabel() {
    if (sleep.afterTrack) return 'после этого трека';
    if (!sleep.until) return '';
    const left = Math.max(0, Math.ceil((sleep.until - Date.now()) / 60_000));
    return `через ${left} мин`;
  }
  /** «После этого трека»: трек сменился — значит, доиграл. Ставим паузу на новом */
  player.addEventListener('track', () => {
    if (sleep.afterTrack && player.current && player.current.id !== sleep.trackId) {
      player.pause();
      stopSleep(true);
      toast('Спокойной ночи — трек доиграл');
    }
    resumeLong();
  });

  // ---------- место в длинных треках ----------
  function resumeLong() {
    const s = settings() || {};
    const t = player.current;
    if (s.rememberLong === false || !t || t.source === 'live' || resumedId === t.id) return;
    const a = player.audio;
    const go = () => {
      resumedId = t.id;
      const p = resumePoint(readPositions()[t.id]?.pos, a.duration);
      if (p > 0) {
        player.seek(p);
        toast(`Продолжаем с ${Math.floor(p / 60)}:${String(Math.floor(p % 60)).padStart(2, '0')}`);
      }
    };
    if (Number.isFinite(a.duration) && a.duration > 0) go();
    else a.addEventListener('loadedmetadata', go, { once: true });
  }
  player.addEventListener('time', () => {
    const t = player.current;
    const a = player.audio;
    if (!t || t.source === 'live' || !Number.isFinite(a.duration) || a.duration < LONG_TRACK) return;
    if (Date.now() - savedAt < 10_000) return;
    savedAt = Date.now();
    const map = readPositions();
    // дослушал почти до конца — забываем место, в следующий раз с начала
    if (a.currentTime > a.duration - 60) delete map[t.id];
    else map[t.id] = { pos: Math.round(a.currentTime), at: Date.now() };
    writePositions(map);
  });

  return { setVolume, apply, startSleep, stopSleep, sleepLabel, get sleeping() { return !!(sleep.until || sleep.afterTrack); } };
}
