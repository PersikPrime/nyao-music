import { app, BrowserWindow, ipcMain, protocol, net, shell, session, nativeImage, Tray, Menu, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { settings, secrets } from './store.js';
import { YandexProvider } from './providers/yandex.js';
import { YTMusicProvider } from './providers/ytmusic.js';
import { SoundCloudProvider } from './providers/soundcloud.js';
import { VKProvider } from './providers/vk.js';
import { checkUpdate, downloadAsset } from './updates.js';
import { WaveMixer } from './wave.js';
import { StreamService } from './stream.js';
import { findLyricsChain } from './lyrics.js';
import { Catalog } from './catalog.js';
import { DiscordRPC, DISCORD_APP_ID } from './discord.js';
import { NyaoCloud, API_BASE } from './cloud.js';
import { LastFm } from './lastfm.js';
import { Radio } from './radio.js';
import { LiveEvents } from './live.js';
import { transferPlaylist, TARGETS } from './transfer.js';
import { findMatch } from './match.js';
import { mergeArtists } from '../renderer/search.js';
import os from 'node:os';
import { loginYandex, loginYTMusic, logoutYandex, logoutYTMusic, loginSoundCloud, logoutSoundCloud, scSessionFetch, solveScCaptcha, loginVK, logoutVK, vkSessionFetch } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(__dirname, '..', 'renderer');

// Версия «0.2 (14)»: номер сборки лежит в version.json в корне проекта
function readVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8'));
    return { name: v.name, build: v.build, channel: v.channel || null, label: `${v.name} (${v.build})${v.channel ? ' ' + v.channel : ''}` };
  } catch {
    return { name: app.getVersion(), build: 0, label: app.getVersion() };
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'nyao', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);

const fetchFn = (url, opts) => net.fetch(url, opts);

// Статус с сервера Nyao: техработы (заглушка на весь экран) и сбои отдельных сервисов (плашка, их треки пропускаем)
let svcStatus = { maintenance: { active: false }, outages: [] };
async function pollStatus() {
  try {
    const res = await net.fetch(`${API_BASE}/status`, { headers: { 'X-Nyao-Build': String(readVersion().build || 0) } });
    if (!res.ok) return svcStatus;
    const s = await res.json();
    svcStatus = { maintenance: s.maintenance || { active: false }, outages: Array.isArray(s.outages) ? s.outages : [] };
    if (win && !win.isDestroyed()) win.webContents.send('status', svcStatus);
  } catch {
    // сервер недоступен — работаем как обычно
  }
  return svcStatus;
}
const up = (id) => !svcStatus.outages.includes(id);
setInterval(pollStatus, 2 * 60_000).unref?.();
let ya, yt, sc, vk, wave, streams, catalog, win, cloud, lastfm, radio, live;

/** Ключи Last.fm кладёт сборка (из секретов GitHub) в lastfm-keys.json рядом; без него Last.fm выключен */
function lastfmKeys() {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'lastfm-keys.json'), 'utf8'));
  } catch {
    return {};
  }
}
const rpc = new DiscordRPC({ log: (m) => console.log(m) });
function configureRpc() {
  rpc.configure({ enabled: settings.get().discordRpc, clientId: DISCORD_APP_ID });
}

// Что из настроек едет на другие устройства (остальное — своё у каждого компьютера)
const WAVE_KEYS = ['ytmShare', 'waveDiversity', 'waveMood'];
// вид приложения и «Мне нравится» по сервисам — тоже общие для всех устройств
const PREF_KEYS = ['layout', 'splitLiked', 'waveTab'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Сверка миксов и настроек волны с сервером Nyao */
async function syncCloud() {
  if (!cloud || !cloud.loggedIn) return;
  try {
    await cloud.flush();
    const changed = await cloud.syncState({
      mixes: {
        get: () => readMixes(),
        set: (data) => Array.isArray(data) && writeMixes(data, false),
        // миксы с двух устройств: объединяем по id, треки внутри — без дублей
        merge: (local, remote) => {
          const byId = new Map((Array.isArray(remote) ? remote : []).map((m) => [m.id, m]));
          for (const m of local) {
            const r = byId.get(m.id);
            if (!r) byId.set(m.id, m);
            else r.tracks = [...r.tracks, ...m.tracks.filter((t) => !r.tracks.some((x) => x.id === t.id))];
          }
          return [...byId.values()];
        }
      },
      wave: {
        get: () => pick(settings.get(), WAVE_KEYS),
        set: (data) => data && settings.set(pick(data, WAVE_KEYS))
      },
      prefs: {
        get: () => pick(settings.get(), PREF_KEYS),
        // пустой вид с другого устройства не затирает выбор на этом
        set: (data) => data && settings.set(Object.fromEntries(Object.entries(pick(data, PREF_KEYS)).filter(([, v]) => v !== null && v !== undefined)))
      }
    });
    if (changed.length) send('cloud:changed', changed);
  } catch (e) {
    console.warn('[cloud]', e.message);
  }
}

function initProviders() {
  ya = new YandexProvider({ token: secrets.get('yandexToken'), fetch: fetchFn });
  // YouTube — через fetch из Node (как в npm run yt-test): сеть Electron может подменять заголовки,
  // по которым googlevideo проверяет ссылку
  const nodeFetch = globalThis.fetch.bind(globalThis);
  yt = new YTMusicProvider({ cookie: secrets.get('ytmCookie'), cacheDir: path.join(app.getPath('userData'), 'yt-cache'), fetch: nodeFetch });
  sc = new SoundCloudProvider({ token: secrets.get('scToken'), fetch: nodeFetch, writeFetch: scSessionFetch });
  // VK Музыка (dev): всё через сессию окна входа VK; сырые ответы при сбоях — в vk-debug.log
  const vkLog = path.join(app.getPath('userData'), 'vk-debug.log');
  vk = new VKProvider({
    fetch: vkSessionFetch,
    // id и домен (vk.com / vk.ru) запоминаем при входе — это не токен, сама сессия живёт в cookie окна входа
    getUserId: async () => Number(secrets.get('vkUid')) || null,
    getBase: () => secrets.get('vkOrigin') || 'https://vk.com',
    debug: (msg) => {
      try {
        fs.appendFileSync(vkLog, `[${new Date().toISOString()}] ${msg}\n\n`);
      } catch {
        // лог не критичен
      }
    }
  });
  cloud = new NyaoCloud({
    dir: app.getPath('userData'),
    getToken: () => secrets.get('nyaoToken'),
    setToken: (t) => secrets.set('nyaoToken', t),
    openUrl: (url) => shell.openExternal(url),
    build: readVersion().build,
    onOutdated: (minBuild) => send('app:outdated', minBuild),
    device: `${os.hostname().replace(/\.local$/, '')} · ${process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'}`,
    log: (m) => console.log(m)
  });
  // команды с других устройств, «сейчас играет» на них и «Слушать вместе» — в окно
  live = new LiveEvents({ cloud, onEvent: (e) => send('live:event', e), log: (m) => console.log(m) });
  live.start();
  const waveMemFile = path.join(app.getPath('userData'), 'wave-memory.json');
  const lk = lastfmKeys();
  lastfm = new LastFm({
    key: lk.key || '',
    secret: lk.secret || '',
    fetch: fetchFn,
    getSession: () => {
      const s = secrets.get('lastfmSession');
      return s ? JSON.parse(s) : null;
    },
    setSession: (s) => secrets.set('lastfmSession', s ? JSON.stringify(s) : null),
    queueFile: path.join(app.getPath('userData'), 'lastfm-queue.json'),
    openUrl: (url) => shell.openExternal(url),
    log: (m) => console.log(m)
  });
  setInterval(() => lastfm.flush().catch(() => {}), 10 * 60_000).unref?.();

  radio = new Radio({ ya, yt, sc, vk, isDown: (id) => svcStatus.outages.includes(id) });

  wave = new WaveMixer({
    ya, yt, sc, vk,
    isDown: (id) => svcStatus.outages.includes(id),
    getSettings: () => settings.get(),
    getRecent: () => cloud.recentIds(),
    memory: {
      get: () => {
        try {
          return JSON.parse(fs.readFileSync(waveMemFile, 'utf8'));
        } catch {
          return [];
        }
      },
      set: (v) => fs.writeFileSync(waveMemFile, JSON.stringify(v))
    }
  });
  streams = new StreamService({ ya, yt, sc, vk, fetchBySource: { ya: fetchFn, yt: nodeFetch, sc: nodeFetch, vk: vkSessionFetch } });
  catalog = new Catalog({ ya, yt });
}

// ---------- Отложенные лайки SoundCloud ----------
// Если защита SoundCloud не пропустила лайк, он ставится в Nyao сразу и ждёт в очереди: повторяем позже.
const pendingFile = () => path.join(app.getPath('userData'), 'sc-pending-likes.json');
function readPending() {
  try {
    return JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
  } catch {
    return [];
  }
}
function writePending(list) {
  fs.writeFileSync(pendingFile(), JSON.stringify(list, null, 2));
}
function queueScLike(track, on) {
  const list = readPending().filter((x) => x.srcId !== track.srcId);
  list.push({ srcId: track.srcId, title: track.title, on, at: Date.now() });
  writePending(list);
}
let flushing = false;
/** Пытается дослать отложенные лайки. Капчу здесь не показываем — только в ответ на действие пользователя */
async function flushScLikes() {
  if (flushing || !sc || !sc.loggedIn) return;
  const list = readPending();
  if (!list.length) return;
  flushing = true;
  const left = [];
  for (let i = 0; i < list.length; i++) {
    try {
      await sc.like({ srcId: list[i].srcId }, list[i].on);
    } catch (e) {
      if (e.captcha) {
        left.push(...list.slice(i)); // защита всё ещё злится — остальное даже не пробуем
        break;
      }
      left.push(list[i]);
    }
  }
  // за время отправки могли добавиться новые лайки — не теряем их
  const added = readPending().filter((x) => !list.some((y) => y.srcId === x.srcId && y.at === x.at));
  writePending([...left.filter((x) => !added.some((y) => y.srcId === x.srcId)), ...added]);
  const done = list.length - left.length;
  flushing = false;
  if (done && win && !win.isDestroyed()) win.webContents.send('sc:pending', { sent: done, left: left.length });
}

// ---------- Мои миксы: локальные плейлисты из треков обоих сервисов ----------
const mixesFile = () => path.join(app.getPath('userData'), 'mixes.json');
function readMixes() {
  try {
    return JSON.parse(fs.readFileSync(mixesFile(), 'utf8'));
  } catch {
    return [];
  }
}
function writeMixes(list, push = true) {
  fs.writeFileSync(mixesFile(), JSON.stringify(list, null, 2));
  // изменения миксов уезжают на другие устройства
  if (push && cloud) cloud.pushState('mixes', list).catch((e) => console.warn('[cloud] mixes', e.message));
}
function mixSummary(m) {
  return { id: m.id, source: 'mix', title: m.title, count: m.tracks.length, cover: (m.tracks.find((t) => t.cover) || {}).cover || null, ya: m.tracks.filter((t) => t.source === 'ya').length, yt: m.tracks.filter((t) => t.source === 'yt').length, sc: m.tracks.filter((t) => t.source === 'sc').length };
}

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    console.warn('[nyao]', e.message);
    return fallback;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      console.error(`[${channel}]`, e);
      return { ok: false, error: e.message || String(e) };
    }
  });
}

/**
 * Лайк SoundCloud: обычный запрос через сессию браузера → если вылезла капча, показываем её и повторяем →
 * если всё равно не вышло, ставим лайк в очередь (в Nyao он уже стоит).
 */
async function likeSoundCloud(track, on) {
  try {
    await sc.like(track, on);
    flushScLikes();
    return on;
  } catch (e) {
    if (!e.captcha) {
      queueScLike(track, on);
      return { on, pending: true, reason: e.message };
    }
    const solved = await solveScCaptcha(win, e.captcha);
    if (solved) {
      try {
        await sc.like(track, on);
        flushScLikes();
        return on;
      } catch {
        // упадём в очередь ниже
      }
    }
    queueScLike(track, on);
    return { on, pending: true, reason: solved ? 'SoundCloud всё ещё не пускает' : 'проверку не прошли' };
  }
}

function registerIpc() {
  handle('win:minimize', () => win.minimize());
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.close());
  handle('status:get', (force) => (force ? pollStatus() : svcStatus));
  handle('win:fullscreen', (on) => {
    win.setFullScreen(!!on);
    return win.isFullScreen();
  });
  // средний цвет обложки — для фона полноэкранного режима (картинку разбираем здесь, без CORS)
  const coverColors = new Map();
  handle('cover:color', async (url) => {
    if (!url) return null;
    if (coverColors.has(url)) return coverColors.get(url);
    const res = await net.fetch(url);
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) return null;
    const bmp = img.resize({ width: 24, height: 24, quality: 'good' }).toBitmap(); // BGRA
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < bmp.length; i += 4) {
      const B = bmp[i], G = bmp[i + 1], R = bmp[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      // почти чёрное и почти белое меньше влияет на цвет — фон получается «цветом обложки», а не серым
      const w = mx < 24 || mn > 232 ? 0.15 : 1 + (mx - mn) / 128;
      r += R * w; g += G * w; b += B * w; n += w;
    }
    const color = n ? [r / n, g / n, b / n].map(Math.round) : null;
    coverColors.set(url, color);
    if (coverColors.size > 200) coverColors.delete(coverColors.keys().next().value);
    return color;
  });
  handle('open:external', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  handle('app:version', () => readVersion());
  handle('update:check', () => checkUpdate(readVersion(), globalThis.fetch.bind(globalThis)));
  handle('update:download', async (asset) => {
    if (!asset || !/^https:\/\/(github\.com|api\.nmusic\.bixtl\.cc)\//.test(asset.url)) throw new Error('Нет файла для этой системы');
    const file = await downloadAsset(asset, app.getPath('downloads'), (p) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:progress', p);
    }, globalThis.fetch.bind(globalThis));
    // .exe запускает установщик, .dmg открывается в Finder — дальше как обычная установка
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    // На Windows установщик перезаписывает файлы приложения — само приложение должно закрыться,
    // иначе Nyao Music.exe останется занятым и может записаться не до конца
    if (process.platform === 'win32') setTimeout(() => app.quit(), 1500);
    return file;
  });
  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    const next = settings.set(patch);
    if ('discordRpc' in patch) configureRpc();
    if ('globalKeys' in patch) applyShortcuts();
    if (WAVE_KEYS.some((k) => k in patch) && cloud) cloud.pushState('wave', pick(next, WAVE_KEYS)).catch(() => {});
    if (PREF_KEYS.some((k) => k in patch) && cloud) cloud.pushState('prefs', pick(next, PREF_KEYS)).catch(() => {});
    return next;
  });
  handle('rpc:update', (info) => rpc.update(info));
  handle('rpc:status', () => rpc.status);
  handle('sc:pending', () => readPending());
  handle('vk:openLog', () => shell.openPath(path.join(app.getPath('userData'), 'vk-debug.log')));

  // ---------- Аккаунт Nyao ----------
  handle('cloud:status', () => cloud.status());
  handle('cloud:login', async () => {
    const user = await cloud.login();
    syncCloud();
    return user;
  });
  handle('cloud:cancel', () => cloud.cancelLogin());
  handle('cloud:logout', () => cloud.logout());
  handle('cloud:me', () => cloud.me());
  handle('cloud:removeDevice', (id) => cloud.removeDevice(id));
  handle('cloud:play', (play) => {
    lastfm.scrobble({ track: play && play.track, listened: (play && play.listened) || 0 });
    return cloud.recordPlay(play);
  });
  handle('cloud:now', (info) => {
    if (info) {
      nowInfo = { title: (info.track && info.track.title) || '', artist: (info.track && info.track.artist) || '', playing: !!info.playing };
      updateTray();
    }
    if (info && info.playing && info.track) lastfm.nowPlaying(info.track).catch(() => {});
    return cloud.setNow(info || {}).catch(() => {});
  });
  handle('track:details', async (track) => {
    if (!track) return {};
    if (track.source === 'ya' && ya.loggedIn) return ya.trackDetails(track.srcId);
    if (track.source === 'sc') return sc.trackDetails(track.srcId);
    return {};
  });
  handle('radio:start', (track) => radio.start(track));
  handle('radio:more', (ids) => radio.more(ids));
  handle('lastfm:status', () => lastfm.status());
  handle('lastfm:connect', () => lastfm.connect());
  handle('lastfm:cancel', () => lastfm.cancel());
  handle('lastfm:disconnect', () => lastfm.disconnect());
  // ---------- Nyao Connect, «Слушать вместе», итоги ----------
  const needCloud = () => {
    if (!cloud.loggedIn) throw new Error('Нужен вход в аккаунт Nyao (настройки → Аккаунт Nyao)');
  };
  handle('connect:devices', async () => {
    needCloud();
    return (await cloud.request('GET', '/connect/devices')).devices || [];
  });
  handle('connect:cmd', async (deviceId, cmd, args) => {
    needCloud();
    return cloud.request('POST', `/connect/${encodeURIComponent(deviceId)}/cmd`, { cmd, args: args || {} });
  });
  handle('room:current', async () => (cloud.loggedIn ? (await cloud.request('GET', '/rooms/current')).room : null));
  handle('room:create', async () => {
    needCloud();
    return (await cloud.request('POST', '/rooms')).room;
  });
  handle('room:join', async (code) => {
    needCloud();
    const c = String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (c.length !== 6) throw new Error('Код комнаты — 6 букв и цифр');
    return (await cloud.request('POST', `/rooms/${c}/join`)).room;
  });
  handle('room:leave', (code) => cloud.request('POST', `/rooms/${encodeURIComponent(code)}/leave`).catch(() => null));
  handle('room:state', (code, st) => cloud.request('PUT', `/rooms/${encodeURIComponent(code)}/state`, st));
  handle('room:react', (code, emoji) => cloud.request('POST', `/rooms/${encodeURIComponent(code)}/react`, { emoji }));
  handle('stats', async (period, year) => {
    needCloud();
    const qs = new URLSearchParams({ period: period || 'month', tz: String(-new Date().getTimezoneOffset()), ...(year ? { year: String(year) } : {}) });
    return cloud.request('GET', `/stats?${qs}`);
  });
  // трек из другого сервиса → тот, что можно включить здесь (для «Слушать вместе»)
  const providers = () => ({ ya, yt, sc, vk });
  const usable = (s) => up(s) && (s === 'yt' || s === 'sc' || (s === 'ya' && ya.loggedIn) || (s === 'vk' && vk.loggedIn));
  handle('match:playable', async (track) => {
    if (!track) return null;
    if (usable(track.source)) return track;
    const order = ['ya', 'vk', 'yt', 'sc'].filter(usable);
    for (const s of order) {
      const m = await findMatch(track, (q) => providers()[s].search(q));
      if (m) return m.track;
    }
    return null;
  });
  handle('transfer:targets', () => Object.entries(TARGETS).map(([id, name]) => ({ id, name, ok: id === 'mix' || (id === 'ya' ? ya.loggedIn && up('ya') : yt.loggedIn && up('yt')) })));
  handle('transfer:start', async ({ tracks, title, target }) => {
    const r = await transferPlaylist({
      tracks,
      title: String(title || 'Перенесённый плейлист').slice(0, 80),
      target,
      search: (s, q) => providers()[s].search(q),
      create: async (to, name, list) => {
        if (to === 'mix') {
          const all = readMixes();
          const mix = { id: `mix:${crypto.randomUUID()}`, title: name, tracks: list };
          all.unshift(mix);
          writeMixes(all);
          return mix.id;
        }
        if (to === 'ya') return ya.createPlaylist(name, list);
        return yt.createPlaylist(name, list.map((t) => t.srcId));
      },
      onProgress: (p) => send('transfer:progress', p)
    });
    return r;
  });
  handle('cloud:others', () => cloud.others());
  handle('cloud:history', () => cloud.history().slice(0, 200));
  handle('cloud:top', (opts) => cloud.top(opts || {}));
  handle('cloud:sync', () => syncCloud());
  handle('sc:flush', () => flushScLikes());

  handle('auth:status', async () => {
    await vk.refresh();
    const [yaAcc, ytAcc, scAcc, vkAcc] = await Promise.all([
      ya.loggedIn ? safe(ya.getAccount(), { name: 'Яндекс', error: true }) : null,
      yt.loggedIn ? safe(yt.getAccount(), { name: 'YouTube Music' }) : null,
      sc.loggedIn ? safe(sc.getAccount(), { name: 'SoundCloud', error: true }) : null,
      vk.loggedIn ? safe(vk.getAccount(), { name: 'VK', error: true }) : null
    ]);
    return { ya: yaAcc, yt: ytAcc, sc: scAcc, vk: vkAcc };
  });
  handle('auth:login', async (service) => {
    if (service === 'ya') {
      const token = await loginYandex(win);
      secrets.set('yandexToken', token);
      ya.setToken(token);
      return ya.getAccount();
    }
    if (service === 'vk') {
      const r = await loginVK(win);
      secrets.set('vkUid', r.uid);
      secrets.set('vkOrigin', r.origin);
      await vk.refresh();
      return vk.getAccount();
    }
    if (service === 'sc') {
      const token = await loginSoundCloud(win);
      secrets.set('scToken', token);
      sc.setToken(token);
      return sc.getAccount();
    }
    const cookie = await loginYTMusic(win);
    secrets.set('ytmCookie', cookie);
    yt.setCookie(cookie);
    return yt.getAccount();
  });
  handle('auth:setManual', async (service, value) => {
    const v = String(value || '').trim();
    if (!v) throw new Error('Пустое значение');
    if (service === 'ya') {
      secrets.set('yandexToken', v);
      ya.setToken(v);
      return ya.getAccount();
    }
    if (service === 'sc') {
      secrets.set('scToken', v);
      sc.setToken(v);
      return sc.getAccount();
    }
    secrets.set('ytmCookie', v);
    yt.setCookie(v);
    return yt.getAccount();
  });
  handle('auth:logout', async (service) => {
    if (service === 'ya') {
      secrets.set('yandexToken', null);
      ya.setToken(null);
      await logoutYandex();
    } else if (service === 'vk') {
      secrets.set('vkUid', null);
      secrets.set('vkOrigin', null);
      vk.setLoggedOut();
      await logoutVK();
    } else if (service === 'sc') {
      secrets.set('scToken', null);
      sc.setToken(null);
      await logoutSoundCloud();
    } else {
      secrets.set('ytmCookie', null);
      yt.setCookie(null);
      await logoutYTMusic();
    }
    return true;
  });

  handle('home', async () => {
    const [yaLists, ytHome] = await Promise.all([
      ya.loggedIn ? safe(ya.playlists(), []) : [],
      yt.loggedIn ? safe(yt.home(), []) : []
    ]);
    return { yaPlaylists: yaLists.slice(0, 8), ytHome: ytHome.slice(0, 4), mixes: readMixes().map(mixSummary) };
  });

  // Новые релизы любимых исполнителей — отдельно от главной: собираются дольше. Кэш на 6 часов
  let releasesCache = null;
  handle('home:releases', async (force) => {
    if (!ya.loggedIn) return [];
    if (!force && releasesCache && Date.now() - releasesCache.at < 6 * 3600 * 1000) return releasesCache.list;
    const list = await safe(ya.newReleases(), null);
    if (list) releasesCache = { at: Date.now(), list };
    return list || (releasesCache && releasesCache.list) || [];
  });

  handle('library:playlists', async () => {
    const [yaLists, ytLists, scLists, vkLists] = await Promise.all([
      ya.loggedIn ? safe(ya.playlists(), []) : [],
      yt.loggedIn ? safe(yt.playlists(), []) : [],
      sc.loggedIn ? safe(sc.playlists(), []) : [],
      vk.loggedIn ? safe(vk.playlists(), []) : []
    ]);
    return [...readMixes().map(mixSummary), ...yaLists, ...ytLists, ...scLists, ...vkLists];
  });

  handle('library:liked', async () => {
    const [a, b, c, d] = await Promise.all([
      ya.loggedIn ? safe(ya.likedTracks(), []) : [],
      yt.loggedIn ? safe(yt.likedTracks(), []) : [],
      sc.loggedIn ? safe(sc.likedTracks(), []) : [],
      vk.loggedIn ? safe(vk.likedTracks(), []) : []
    ]);
    // Чередуем, чтобы общий список не был «сначала весь Яндекс, потом весь YT»
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length, c.length, d.length); i++) {
      for (const l of [a, b, c, d]) if (l[i]) out.push(l[i]);
    }
    return { tracks: out, ya: a.length, yt: b.length, sc: c.length, vk: d.length };
  });

  handle('library:tracks', async (playlistId) => {
    if (playlistId.startsWith('mix:')) return (readMixes().find((m) => m.id === playlistId) || { tracks: [] }).tracks;
    if (playlistId.startsWith('ya:')) return ya.playlistTracks(playlistId);
    if (playlistId.startsWith('yt:')) return yt.playlistTracks(playlistId);
    if (playlistId.startsWith('sc:')) return sc.playlistTracks(playlistId);
    if (playlistId.startsWith('vk:')) return vk.playlistTracks(playlistId);
    throw new Error('Неизвестный плейлист');
  });

  handle('mix:create', (title) => {
    const list = readMixes();
    const mix = { id: `mix:${crypto.randomUUID()}`, title: String(title || 'Новый микс').slice(0, 80), tracks: [] };
    list.unshift(mix);
    writeMixes(list);
    return mixSummary(mix);
  });
  handle('mix:add', (mixId, track) => {
    const list = readMixes();
    const mix = list.find((m) => m.id === mixId);
    if (!mix) throw new Error('Микс не найден');
    if (!mix.tracks.some((t) => t.id === track.id)) mix.tracks.push(track);
    writeMixes(list);
    return mixSummary(mix);
  });
  handle('mix:addMany', (mixId, tracks) => {
    const list = readMixes();
    const mix = list.find((m) => m.id === mixId);
    if (!mix) throw new Error('Микс не найден');
    for (const t of tracks || []) if (t && t.id && !mix.tracks.some((x) => x.id === t.id)) mix.tracks.push(t);
    writeMixes(list);
    return mixSummary(mix);
  });
  handle('mix:remove', (mixId, trackId) => {
    const list = readMixes();
    const mix = list.find((m) => m.id === mixId);
    if (mix) mix.tracks = mix.tracks.filter((t) => t.id !== trackId);
    writeMixes(list);
    return true;
  });
  handle('mix:delete', (mixId) => {
    writeMixes(readMixes().filter((m) => m.id !== mixId));
    return true;
  });

  handle('search', async (q) => {
    // Поиск YouTube Music работает и без входа — аккаунт нужен только для лайков и библиотеки
    // SoundCloud тоже ищет без входа
    const yaOn = ya.loggedIn && up('ya');
    const [a, b, c, d, arYa, arYt, alYa, alYt] = await Promise.all([
      yaOn ? safe(ya.search(q), []) : [], up('yt') ? safe(yt.search(q), []) : [], up('sc') ? safe(sc.search(q), []) : [], vk.loggedIn && up('vk') ? safe(vk.search(q), []) : [],
      // исполнители и альбомы: Яндекс и YouTube Music
      yaOn ? safe(ya.searchArtist(q), []) : [], up('yt') ? safe(yt.searchArtist(q), []) : [],
      yaOn ? safe(ya.searchAlbum(q), []) : [], up('yt') ? safe(yt.searchAlbum(q), []) : []
    ]);
    const albums = [];
    for (let i = 0; i < Math.max(alYa.length, alYt.length) && albums.length < 12; i++) for (const l of [alYa, alYt]) if (l[i] && albums.length < 12) albums.push(l[i]);
    return { ya: a, yt: b, sc: c, vk: d, artists: mergeArtists([arYa, arYt], q), albums };
  });

  handle('wave:start', () => wave.start());
  handle('wave:more', (queueIds) => wave.more(queueIds || []));
  handle('wave:feedback', (type, track, played) => wave.feedback(type, track, played));

  handle('catalog:artist', (ref) => catalog.artist(ref));
  handle('catalog:album', (ref) => catalog.album(ref));
  handle('catalog:artistTracks', (refs) => catalog.artistTracks(refs));
  handle('stream:prepare', (trackId) => streams.prepare(trackId));
  handle('stream:loudness', (trackId) => streams.loudness(trackId));
  handle('stream:error', (trackId) => streams.lastError(trackId));
  handle('lyrics', (track) => findLyricsChain(track, {
    fetch: fetchFn,
    log: (m) => {
      console.log(m);
      try {
        fs.appendFileSync(path.join(app.getPath('userData'), 'lyrics-debug.log'), `${new Date().toISOString()} ${m}\n`);
      } catch {
        // не страшно
      }
    },
    ya: ya.loggedIn && up('ya') ? ya : null,
    yt: up('yt') ? yt : null,
    matchYa: async (t) => {
      const m = await findMatch(t, (q) => ya.search(q), { minScore: 0.75 });
      return m && m.track;
    }
  }));
  handle('like', async (track, on) => {
    if (track.source === 'ya') await ya.like(track, on);
    else if (track.source === 'yt') await yt.like(track, on);
    else if (track.source === 'sc') return likeSoundCloud(track, on);
    else if (track.source === 'vk') await vk.like(track, on);
    return on;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    // На macOS оставляем родные «светофоры», на Windows — свои кнопки окна
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 26, y: 26 } }
      : { frame: false }),
    backgroundColor: '#000000',
    title: 'Nyao Music',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  win.on('leave-full-screen', () => win.webContents.send('win:fullscreen', false));
  // «сворачивать в трей»: крестик прячет окно, музыка играет дальше
  win.on('close', (e) => {
    if (!quitting && settings.get().closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  setupTray();
  applyShortcuts();
  win.webContents.once('did-finish-load', () => pollStatus());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Дизайн выбирается по системе: macOS — Liquid Glass, остальные — тёмная Windows-тема.
  // NYAO_THEME=mac|win переопределяет выбор (удобно, чтобы посмотреть чужую тему).
  const theme = process.env.NYAO_THEME || (process.platform === 'darwin' ? 'mac' : 'win');
  win.loadFile(path.join(RENDERER, 'index.html'), { query: { theme } });
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  // При запуске через npm start показываем нашу иконку в доке (в собранном .app она и так своя)
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon-mac.png'));
    } catch {
      // иконка не критична
    }
  }
  initProviders();
  protocol.handle('nyao', async (request) => {
    const res = await streams.handle(request);
    // эквалайзер (Web Audio) читает звук только с разрешением CORS
    try {
      res.headers.set('access-control-allow-origin', '*');
    } catch {
      // заголовки ответа неизменяемые — отдаём как есть
    }
    return res;
  });
  registerIpc();
  configureRpc();
  createWindow();
  // отложенные лайки SoundCloud: через минуту после запуска и потом раз в 10 минут
  setTimeout(flushScLikes, 60_000);
  setInterval(flushScLikes, 10 * 60_000);
  // аккаунт Nyao: сверка при запуске и раз в 5 минут
  setTimeout(syncCloud, 5_000);
  setInterval(syncCloud, 5 * 60_000);
  // Картинки обложек грузятся напрямую с CDN сервисов — убираем Referer, чтобы не было 403
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.googleusercontent.com/*', 'https://avatars.yandex.net/*', 'https://*.ggpht.com/*'] }, (details, cb) => {
    delete details.requestHeaders.Referer;
    cb({ requestHeaders: details.requestHeaders });
  });
});

// ---------- Трей и глобальные сочетания клавиш ----------
let tray = null;
let nowInfo = { title: '', artist: '', playing: false };
let quitting = false;
const control = (cmd) => {
  if (win && !win.isDestroyed()) win.webContents.send('control', cmd);
};
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function trayMenu() {
  const label = nowInfo.title ? `${nowInfo.title} — ${nowInfo.artist}`.slice(0, 60) : 'Ничего не играет';
  return Menu.buildFromTemplate([
    { label, enabled: false },
    { type: 'separator' },
    { label: nowInfo.playing ? 'Пауза' : 'Играть', click: () => control('toggle') },
    { label: 'Следующий', click: () => control('next') },
    { label: 'Предыдущий', click: () => control('prev') },
    { label: 'Мне нравится', click: () => control('like') },
    { type: 'separator' },
    { label: 'Открыть Nyao Music', click: showWindow },
    { label: 'Выйти', click: () => { quitting = true; app.quit(); } }
  ]);
}
function updateTray() {
  if (!tray) return;
  tray.setToolTip(nowInfo.title ? `Nyao Music — ${nowInfo.title}` : 'Nyao Music');
  tray.setContextMenu(trayMenu());
}
function setupTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.on('click', () => (process.platform === 'darwin' ? tray.popUpContextMenu() : showWindow()));
  updateTray();
}
const SHORTCUTS = { 'CommandOrControl+Alt+Space': 'toggle', 'CommandOrControl+Alt+Right': 'next', 'CommandOrControl+Alt+Left': 'prev', 'CommandOrControl+Alt+L': 'like' };
function applyShortcuts() {
  globalShortcut.unregisterAll();
  if (!settings.get().globalKeys) return;
  for (const [acc, cmd] of Object.entries(SHORTCUTS)) {
    try {
      globalShortcut.register(acc, () => control(cmd));
    } catch {
      // сочетание занято другой программой — пропускаем
    }
  }
}
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  rpc.disconnect();
  // дослать историю перед выходом (не дольше 2 секунд)
  Promise.race([cloud ? cloud.flush().catch(() => {}) : null, new Promise((r) => setTimeout(r, 2000))]).finally(() => app.quit());
});

// Диагностика: какой сайт отдал сертификат, которому Chromium не доверяет, и кем он выпущен.
// Сертификат не принимаем — только пишем в терминал.
app.on('certificate-error', (event, _wc, url, error, cert) => {
  console.warn(`[cert] ${error} ${url} | выпущен: ${cert.issuerName} | для: ${cert.subjectName}`);
});
