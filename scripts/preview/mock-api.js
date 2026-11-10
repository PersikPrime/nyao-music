// Подставное window.nyao для предпросмотра окна в обычном браузере (scripts/preview/run.mjs).
// Только для разработки: никакой сети и входов, данные выдуманы. Отдаёт медиатеку, текст песни, цвет обложки.
(() => {
  const COLORS = [['#3E2350', '#C6B8FF'], ['#1B3A5C', '#8FB4FF'], ['#7A3A10', '#FFB86B'], ['#1F4A3C', '#7CE0C3'], ['#4A1030', '#FF8FB1'], ['#4A3A12', '#F2D675'], ['#2B2F5E', '#C6CBFF']];
  const cover = (i) => `/__cover/${i % COLORS.length}.svg`;
  const T = [['Holocene', 'Bon Iver', 336], ['Midnight City', 'M83', 243], ['Ferto', 'Akylas', 185], ['Teardrop', 'Massive Attack', 329], ['Nightcall', 'Kavinsky', 258], ['Intro', 'The xx', 127], ['Breathe', 'Télépopmusik', 279], ['Очень длинное название трека, которое не помещается в одну строку', 'Исполнитель с длинным именем', 200]];
  const SRC = ['ya', 'yt', 'vk', 'ya', 'ya', 'vk', 'sc', 'yt'];
  const tracks = T.map((t, i) => ({ id: `${SRC[i]}:${i + 1}`, source: SRC[i], srcId: String(i + 1), title: t[0], artist: t[1], album: i === 0 ? 'Bon Iver, Bon Iver' : '', duration: t[2], cover: cover(i) }));
  const lists = [['Ночная дорога', 'ya', 42], ['Для работы', 'yt', 27], ['Зал', 'ya', 55], ['Лето', 'vk', 64], ['Спокойное', 'mix', 31], ['Дорога домой', 'sc', 18]].map((p, i) => ({ id: `${p[1]}:pl${i}`, title: p[0], source: p[1], count: p[2], cover: cover(i + 1) }));
  const lines = ['Первая строка песни', 'Вторая строка чуть длиннее первой', 'Строка, которая звучит сейчас', 'Следующая строка', 'И ещё одна строка', 'Припев начинается здесь', 'Припев продолжается', 'Последняя строка куплета', 'Финал'].map((text, i) => ({ time: i * 4, text }));
  const settings = { volume: 0.5, accent: 'nyao', splitLiked: true, addons: {}, ...(window.__settings || {}) };
  const table = {
    'settings.get': () => settings,
    'settings.set': (p) => Object.assign(settings, p),
    'auth.status': () => ({ ya: { name: 'takko' }, yt: { name: 'Takko' }, sc: null, vk: { name: 'Takko' }, sp: null }),
    'auth.quick': () => ({ ya: { name: 'takko' }, yt: { name: 'Takko' }, sc: null, vk: { name: 'Takko' }, sp: null }),
    'library.playlists': () => lists,
    'library.tracks': () => tracks,
    'library.liked': () => ({ ya: 3, yt: 2, vk: 2, sc: 1, sp: 0, tracks }),
    home: () => ({ yaPlaylists: lists.slice(0, 3), ytHome: [], mixes: [] }),
    lyrics: () => (window.__noLyrics ? null : { synced: true, source: 'LRCLIB', provider: 'lrclib', lines }),
    coverColor: (url) => { const m = /(\d+)\.svg/.exec(url || ''); const h = COLORS[m ? Number(m[1]) : 0][0]; return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)); },
    version: () => '0.10', 'cloud.history': () => [], 'cloud.historyAll': () => [], 'cloud.status': () => ({ loggedIn: false }),
    'artists.list': () => [], 'status.get': () => ({ maintenance: { active: false }, outages: [], blocked: [] }),
    'lastfm.status': () => ({ configured: true, connected: true, name: 'takko', queued: 0 }),
    'control.info': () => ({ running: false }), 'addons.list': () => ({ dev: true, items: window.__addons || [
      { id: 'nyao.lastfm', name: 'Last.fm', version: '1.0', author: 'Nyao', description: 'Отмечает в твоём профиле всё, что играет, — со всех сервисов сразу.', icon: 'scrobble', color: '#FF8FB1', source: 'builtin', native: 'lastfm', enabled: true, status: 'running', needs: [], permissions: [{ key: 'track', net: false, title: 'Что играет', hint: 'трек, исполнитель, обложка, позиция' }, { key: 'net:ws.audioscrobbler.com', net: true, title: 'ws.audioscrobbler.com', hint: 'сюда дополнение может отправлять данные' }], settings: [{ key: 'nowPlaying', type: 'toggle', label: 'Показывать «Сейчас играет»' }], values: { nowPlaying: true }, menu: [] },
      { id: 'nyao.overlay', name: 'Оверлей для OBS', version: '1.0', author: 'Nyao', description: 'Плашка «Сейчас играет» для стрима: добавь адрес в OBS как источник «Браузер».', icon: 'overlay', color: '#7CE0C3', source: 'builtin', native: '', enabled: true, status: 'running', needs: [], pageUrl: 'http://127.0.0.1:47840/a/nyao.overlay/', permissions: [{ key: 'track', net: false, title: 'Что играет', hint: 'трек, исполнитель, обложка, позиция' }, { key: 'page', net: false, title: 'Локальный адрес', hint: '127.0.0.1 — с других устройств не видно' }], settings: [{ key: 'style', type: 'select', label: 'Вид плашки', options: [{ value: 'card', label: 'Карточка' }, { value: 'line', label: 'Строка' }, { value: 'cookie', label: 'Только обложка' }] }, { key: 'progress', type: 'toggle', label: 'Полоса прогресса' }], values: { style: 'card', progress: true }, menu: [] },
      { id: 'takko.quotes', name: 'Цитата из трека', version: '0.3', author: 'takko', description: 'Копирует строку, которая звучит сейчас.', icon: 'lyrics', color: '#C6B8FF', source: 'dev', native: '', enabled: false, status: 'off', needs: [], permissions: [{ key: 'lyrics', net: false, title: 'Текст песни', hint: 'строки с таймингом' }, { key: 'ui.trackMenu', net: false, title: 'Пункт в меню трека', hint: 'своя строка в меню «⋯»' }], settings: [], values: {}, menu: [] },
      { id: '!dev/broken', name: 'broken', source: 'dev', error: 'неизвестное право «tokens»', status: 'error', enabled: false, permissions: [], settings: [], values: {}, menu: [] },
    ] }),
    'win.fullscreen': () => true, releases: () => [], 'connect.devices': () => [], 'room.current': () => null, 'deepLinks.take': () => null,
  };
  const fn = (path) => new Proxy(function () {}, {
    get: (_, k) => (k === 'then' ? undefined : k === 'platform' ? 'win32' : k === Symbol.toPrimitive ? () => '' : fn(path ? `${path}.${String(k)}` : String(k))),
    apply: (_, __, args) => {
      if (/(^|\.)on[A-Z]/.test(path)) { (window.__on = window.__on || {})[path] = args[0]; return () => {}; }
      const h = table[path];
      try { return Promise.resolve(h ? h(...args) : null); } catch (e) { return Promise.reject(e); }
    },
  });
  window.nyao = fn('');
  // nyao://stream/… в браузере не существует — играем тишину с сервера предпросмотра
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { get() { return d.get.call(this); }, set(v) { d.set.call(this, String(v).startsWith('nyao://') ? '/__silence.wav' : v); } });
})();
