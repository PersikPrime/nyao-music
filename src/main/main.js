import { app, BrowserWindow, ipcMain, protocol, net, shell, session, nativeImage, Tray, Menu, globalShortcut, clipboard, dialog, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PendingLikes } from './pending-likes.js';
import { parseDeepLink } from './deeplink.js';
import { safeDiagnostic } from './diagnostics.js';
import { fileURLToPath } from 'node:url';
import { settings, secrets } from './store.js';
import { YandexProvider } from './providers/yandex.js';
import { YTMusicProvider } from './providers/ytmusic.js';
import { shapeOf } from './providers/ytraw.js';
import { SoundCloudProvider } from './providers/soundcloud.js';
import { VKProvider } from './providers/vk.js';
import { SpotifyProvider, SP_REDIRECT } from './providers/spotify.js';
import { SpotifyEngine, silenceResponse } from './spotify/spotify-engine.js';
import { versionLabel } from './version.js';
import { LibrespotEngine } from './spotify/librespot-engine.js';
import { SpotifyExperiment } from './spotify/experiment.js';
import { checkUpdate, downloadAsset, fetchHot } from './updates.js';
import { WaveMixer } from './wave.js';
import { StreamService } from './stream.js';
import { findLyricsChain, LYRICS_PROVIDERS } from './lyrics.js';
import { Catalog } from './catalog.js';
import { DiscordRPC, DISCORD_APP_ID } from './discord.js';
import { NyaoCloud, API_BASE } from './cloud.js';
import { LastFm } from './lastfm.js';
import { Radio } from './radio.js';
import { LiveEvents } from './live.js';
import { Popups, popupFor } from './popup.js';
import { mergeArtists as mergeFavArtists } from './freshness.js';
import { transferPlaylist, TARGETS } from './transfer.js';
import { findMatch } from './match.js';
import { mergeArtists } from '../renderer/search.js';
import os from 'node:os';
import { loginYandex, loginYTMusic, logoutYandex, logoutYTMusic, loginSoundCloud, logoutSoundCloud, scSessionFetch, solveScCaptcha, loginVK, logoutVK, vkSessionFetch, refreshVkSession } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(__dirname, '..', 'renderer');

// Версия «0.2 (14)»: номер сборки лежит в version.json в корне проекта
function readVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8'));
    const hot = globalThis.__nyaoHot;
    return {
      name: v.name,
      build: v.build,
      channel: v.channel || null,
      label: versionLabel(v),
      displayVersion: v.displayVersion || null,
      // запущено горячее обновление: какая версия стоит установщиком
      installed: hot && hot.running != null ? `${hot.bundled.name} (${hot.bundled.build})` : null
    };
  } catch {
    return { name: app.getVersion(), build: 0, label: app.getVersion() };
  }
}

// откуда разрешено качать обновления: GitHub (и его файловый сервер) и зеркало на сервере Nyao
const UPDATE_URL = /^https:\/\/(github\.com|objects\.githubusercontent\.com|api\.music\.withnyao\.app|api\.nmusic\.bixtl\.cc)\//;

// Горячее обновление запущено: считаем его рабочим, когда интерфейс поднялся и ~8 с прожил без сбоя.
// Не поднялся за минуту — помечаем версию плохой и перезапускаемся на коде из установки.
function watchHotStart(w) {
  const hot = globalThis.__nyaoHot;
  if (!hot || hot.running == null) return;
  const started = Date.now();
  const tick = async () => {
    if (w.isDestroyed()) return;
    let ready = false;
    try {
      ready = await w.webContents.executeJavaScript('window.__nyaoReady === true', true);
    } catch {
      // страница ещё грузится
    }
    if (ready) {
      setTimeout(() => {
        if (!w.isDestroyed() && !w.webContents.isCrashed()) {
          hot.store.confirm();
          console.log(`[hot] версия ${hot.running} работает`);
        }
      }, 8000);
      return;
    }
    if (Date.now() - started > 60_000) {
      console.error(`[hot] версия ${hot.running} не поднялась за минуту — возвращаюсь к установленной`);
      hot.store.fail(hot.running);
      quitting = true;
      app.relaunch();
      app.quit();
      return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

// ---------- Ссылки nyao:// (приглашения, комнаты, профили, треки) открывают это приложение ----------
let pendingLink = null;
function deepLink(raw) {
  const link = parseDeepLink(raw);
  if (!link) return;
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    showWindow();
    win.webContents.send('deeplink', link);
  } else pendingLink = link;
}
// одна копия приложения: ссылка, открытая вторым запуском, уходит в уже открытое окно
if (!process.env.NYAO_MULTI && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  showWindow();
  const url = (argv || []).find((a) => String(a).startsWith('nyao://'));
  if (url) deepLink(url);
});
// macOS присылает ссылки событием, в том числе до готовности приложения
app.on('open-url', (e, url) => {
  e.preventDefault();
  deepLink(url);
});
{
  const first = process.argv.find((a) => String(a).startsWith('nyao://'));
  if (first) pendingLink = parseDeepLink(first);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'nyao', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);

const fetchFn = (url, opts) => net.fetch(url, opts);

// Статус с сервера Nyao: техработы (заглушка на весь экран) и сбои отдельных сервисов (плашка, их треки пропускаем)
let svcStatus = { maintenance: { active: false }, outages: [] };
async function pollStatus() {
  try {
    const res = await net.fetch(`${cloud ? cloud.base : API_BASE}/status`, { headers: { 'X-Nyao-Build': String(readVersion().build || 0) } });
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
let ya, yt, sc, vk, sp, spEngine, wave, streams, catalog, win, cloud, lastfm, radio, live;
let spExperiment, nativePermission = false;
const LIBRESPOT_REDIRECT = 'http://127.0.0.1:43820/spotify-callback';
const nativeAllowed = () => nativePermission && readVersion().channel === 'nightly' && cloud?.loggedIn && cloud.user?.dev === true;
async function requireNativeDeveloper() {
  if (readVersion().channel !== 'nightly' || !cloud?.loggedIn) { nativePermission = false; throw new Error('Librespot доступен разработчикам в nightly'); }
  const me = await cloud.me();
  if (!me?.user?.dev) { nativePermission = false; throw new Error('Нужен аккаунт разработчика Nyao'); }
  nativePermission = true;
}


/**
 * Widevine (Electron от castlabs): компонент CDM скачивается и проверяется при первом запуске.
 * В обычном Electron его нет — тогда Spotify-плеер на ПК недоступен, остальное работает как раньше.
 */
let widevineState = null;
function widevineReady() {
  if (!widevineState) {
    widevineState = (async () => {
      try {
        const { components } = await import('electron');
        if (!components || typeof components.whenReady !== 'function') return { ok: false, reason: 'в этой сборке Electron нет Widevine' };
        await Promise.race([components.whenReady(), new Promise((_, rej) => setTimeout(() => rej(new Error('Widevine не загрузился за 60 секунд')), 60_000))]);
        return { ok: true, status: components.status() };
      } catch (e) {
        return { ok: false, reason: e.message || String(e) };
      }
    })();
  }
  return widevineState;
}

/** Spotify не должен держать поиск и библиотеку дольше 6 секунд */
function spSafe(promise, fallback) {
  return Promise.race([safe(promise, fallback), new Promise((r) => setTimeout(() => r(fallback), 6000))]);
}
const spOn = () => sp && sp.loggedIn && !sp.regionBlocked;
/** Копия трека Spotify из другого сервиса (настраивается при запуске, см. protocol.handle) */
let spSubstitute = async () => null;

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
const WAVE_KEYS = ['ytmShare', 'waveDiversity', 'waveMood', 'waveFresh'];
// вид приложения и «Мне нравится» по сервисам — тоже общие для всех устройств
const PREF_KEYS = ['layout', 'splitLiked', 'waveTab', 'accent', 'lyricsOrder', 'lyricsWordsFirst'];
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/** Сверка миксов и настроек волны с сервером Nyao */
/**
 * «Недавно прослушанное» Spotify (что слушал в самом Spotify, не в Nyao) → в итоги Nyao.
 * Раз в 30 минут; сначала отправляем свои прослушивания, чтобы сервер не посчитал их дважды
 */
let spRecentAt = 0;
async function importSpotifyRecent() {
  if (!spOn() || Date.now() - spRecentAt < 30 * 60_000) return;
  spRecentAt = Date.now();
  const after = Math.max(Number(settings.get().spRecentAfter) || 0, Date.now() - 14 * 86_400_000);
  let items;
  try {
    items = await sp.recentlyPlayed(after);
  } catch (e) {
    // вход до этой версии — без разрешения на историю; заработает после повторного входа в Spotify
    if (e.code === 401 || e.code === 403) return;
    throw e;
  }
  if (!items.length) return;
  await cloud.importPlays(items.map((x) => ({ track: x.track, at: x.playedAt })));
  settings.set({ spRecentAfter: Math.max(...items.map((x) => x.playedAt)) });
}

async function syncCloud() {
  if (!cloud || !cloud.loggedIn) return;
  try {
    await cloud.flush();
    await importSpotifyRecent().catch((e) => console.warn(`[spotify] недавно прослушанное: ${e.message}`));
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
      artists: {
        get: () => readFav(),
        set: (data) => Array.isArray(data) && writeFav(data, false),
        merge: (local, remote) => mergeFavArtists(local, remote)
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

// Отчёт о сбоях YouTube: стек ошибки и «форма» ответа (только имена полей) — без cookies и данных аккаунта
function ytLog(op, err, meta = {}) {
  try {
    const file = path.join(app.getPath('userData'), 'yt-debug.log');
    try {
      if (fs.statSync(file).size > 2_000_000) fs.renameSync(file, file + '.old');
    } catch {}
    const { response, ...rest } = meta || {};
    const lines = [`${new Date().toISOString()} [${op}] v${readVersion().name}.${readVersion().build} ${JSON.stringify(rest)}`];
    if (err) lines.push('  ' + String((err && err.stack) || err).split('\n').slice(0, 10).join('\n  '));
    if (response) lines.push('  shape: ' + JSON.stringify(shapeOf(response)).slice(0, 60_000));
    fs.appendFileSync(file, safeDiagnostic(lines.join('\n')) + '\n');
    if (err) console.warn('[yt]', op, err && err.message);
  } catch {}
}

function initProviders() {
  ya = new YandexProvider({ token: secrets.get('yandexToken'), fetch: fetchFn });
  // YouTube — через fetch из Node (как в npm run yt-test): сеть Electron может подменять заголовки,
  // по которым googlevideo проверяет ссылку
  const nodeFetch = globalThis.fetch.bind(globalThis);
  yt = new YTMusicProvider({ cookie: secrets.get('ytmCookie'), cacheDir: path.join(app.getPath('userData'), 'yt-cache'), fetch: nodeFetch, log: ytLog });
  sc = new SoundCloudProvider({ token: secrets.get('scToken'), fetch: nodeFetch, writeFetch: scSessionFetch, onAccount: uid => {
    const key = crypto.createHash('sha256').update(sc.token).digest('hex');
    writePending(readPending().map(x => x.account === key ? { ...x, account: 'uid:' + uid } : x));
    secrets.set('scIdentity', { key, uid: String(uid) });
  } });
  // VK Музыка (dev): всё через сессию окна входа VK; сырые ответы при сбоях — в vk-debug.log
  const vkLog = path.join(app.getPath('userData'), 'vk-debug.log');
  vk = new VKProvider({
    fetch: vkSessionFetch,
    // id и домен (vk.com / vk.ru) запоминаем при входе — это не токен, сама сессия живёт в cookie окна входа
    getUserId: async () => Number(secrets.get('vkUid')) || null,
    getBase: () => secrets.get('vkOrigin') || 'https://vk.com',
    refreshSession: (uid, base) => refreshVkSession(uid, base),
    debug: (msg) => {
      try {
        fs.appendFileSync(vkLog, `[${new Date().toISOString()}] ${safeDiagnostic(msg)}\n\n`);
      } catch {
        // лог не критичен
      }
    }
  });
  // Spotify: официальный Web API + Web Playback SDK в скрытом окне (нужен Premium и свой Client ID)
  const standardApi = new SpotifyProvider({ store: secrets, fetchFn, openUrl: url => shell.openExternal(url) });
  const nativeApi = new SpotifyProvider({
    store: { get: key => secrets.get('librespot_' + key), set: (key, value) => secrets.set('librespot_' + key, value) },
    fetchFn, openUrl: url => shell.openExternal(url), redirectUri: LIBRESPOT_REDIRECT,
  });
  const standardEngine = new SpotifyEngine({ sp: standardApi, widevine: widevineReady(), onChange: st => {
    if (!spExperiment?.active) send('spotify:state', { ...st, backend: 'sdk' });
  } });
  const nativeName = 'nyao-librespot' + (process.platform === 'win32' ? '.exe' : '');
  const nativeBinary = app.isPackaged
    ? path.join(process.resourcesPath, 'librespot', nativeName)
    : path.join(globalThis.__nyaoBundledRoot || path.join(__dirname, '..', '..'), 'native-bin', (process.platform === 'darwin' ? 'mac' : 'win') + '-' + process.arch, nativeName);
  const nativeEngine = new LibrespotEngine({ api: nativeApi, binary: ['darwin', 'win32'].includes(process.platform) ? nativeBinary : null,
    allowed: () => !!spExperiment?.visible && safeStorage.isEncryptionAvailable(),
    deviceId: () => { let id = secrets.get('librespotDeviceId'); if (!id) { id = crypto.randomUUID(); secrets.set('librespotDeviceId', id); } return id; },
    onChange: st => {
      if (!spExperiment?.active) return;
      if (st.error && spExperiment.fallbackFromMetadataFailure()) {
        wave?.invalidateLikes();
        send('spotify:state', { backend: 'sdk', switchedToSdk: true,
          message: 'Librespot не получил метаданные. Выбран обычный Spotify — нажми «Играть».' });
        return;
      }
      send('spotify:state', st);
    },
  });
  spExperiment = new SpotifyExperiment({ standardApi, standardEngine, nativeApi, nativeEngine, allowed: nativeAllowed, settings });
  sp = spExperiment.api;
  spEngine = spExperiment.engine;
  nativeEngine.volume = settings.get().volume ?? 0.8;
  setInterval(() => { if (nativeEngine.started && !spExperiment.visible) nativeEngine.release(); }, 2000).unref();
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
  // окошки друзей в углу экрана, когда Nyao свёрнут или не в фокусе
  const ACCENT_HEX = { lavender: '#C6B8FF', coral: '#FFB4A2', mint: '#7CE0C3', sun: '#FFD60A' };
  const popups = new Popups({
    getAccent: () => ACCENT_HEX[(settings.get() || {}).accent] || ACCENT_HEX.lavender,
    onOpen: (payload) => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      send('social:open', payload);
    }
  });
  live = new LiveEvents({
    cloud,
    onEvent: (e) => {
      send('live:event', e);
      if (e.type === 'social' && e.kind !== 'now' && !e.quiet && (settings.get() || {}).friendPopups !== false) {
        const away = !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !win.isFocused();
        const item = away && popupFor(e);
        if (item) popups.show(item);
      }
    },
    log: (m) => console.log(m)
  });
  live.start();
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
    ya, yt, sc, vk, sp,
    isDown: (id) => svcStatus.outages.includes(id),
    getSettings: () => settings.get(),
    getRecent: () => cloud.recentIds(),
    getHistory: () => cloud.history(),
    profile: {
      get: () => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'wave-profile.json'), 'utf8')); } catch { return {}; } },
      set: (value) => { const file = path.join(app.getPath('userData'), 'wave-profile.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); }
    },
    getFavorites: async () => readFav()
  });
  streams = new StreamService({ ya, yt, sc, vk, fetchBySource: { ya: fetchFn, yt: nodeFetch, sc: nodeFetch, vk: vkSessionFetch } });
  catalog = new Catalog({ ya, yt });
}

// ---------- Отложенные лайки SoundCloud ----------
// Если защита SoundCloud не пропустила лайк, он ставится в Nyao сразу и ждёт в очереди: повторяем позже.
const pendingFile = () => path.join(app.getPath('userData'), 'sc-pending-likes.json');
function readPending() {
  try {
    const list = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function writePending(list) {
  fs.writeFileSync(pendingFile() + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(pendingFile() + '.tmp', pendingFile());
}
const scAccountKey = () => {
  if (!sc?.token) return null;
  const key = crypto.createHash('sha256').update(sc.token).digest('hex');
  const identity = secrets.get('scIdentity');
  return identity?.key === key ? 'uid:' + identity.uid : key;
};
const scLikes = new PendingLikes({
  read: readPending, write: writePending, account: scAccountKey,
  send: item => sc.like({ srcId: item.srcId }, item.on)
});
async function flushScLikes() {
  if (!sc?.loggedIn) return { sent: 0, left: 0 };
  const result = await scLikes.flush();
  if (result.sent && win && !win.isDestroyed()) win.webContents.send('sc:pending', { sent: result.sent, left: result.left });
  return { sent: result.sent, left: result.left };
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
// ---------- Любимые исполнители (лайк на странице исполнителя) ----------
const favFile = () => path.join(app.getPath('userData'), 'fav-artists.json');
function readFav() {
  try {
    const l = JSON.parse(fs.readFileSync(favFile(), 'utf8'));
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
}
function writeFav(list, push = true) {
  fs.writeFileSync(favFile(), JSON.stringify(list, null, 2));
  if (push && cloud) cloud.pushState('artists', list).catch((e) => console.warn('[cloud] artists', e.message));
}
/** Один раз подтягиваем «Моих исполнителей» из Яндекса — чтобы не лайкать всех заново */
async function importYaArtists() {
  if (!ya || !ya.loggedIn || settings.get().favImportedYa) return;
  try {
    const list = await ya.likedArtists();
    const cur = readFav();
    const add = list.filter((a) => !cur.some((x) => x.ref === a.ref || (x.refs && x.refs.ya === a.ref))).map((a) => ({ ref: a.ref, refs: { ya: a.ref }, name: a.name, cover: a.cover || null, at: 0 }));
    if (add.length) writeFav(mergeFavArtists(cur, add));
    settings.set({ favImportedYa: true });
  } catch (e) {
    console.warn('[fav] импорт из Яндекса', e.message);
  }
}

function mixSummary(m) {
  return { id: m.id, source: 'mix', title: m.title, count: m.tracks.length, cover: (m.tracks.find((t) => t.cover) || {}).cover || null, ya: m.tracks.filter((t) => t.source === 'ya').length, yt: m.tracks.filter((t) => t.source === 'yt').length, sc: m.tracks.filter((t) => t.source === 'sc').length };
}

async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    console.warn('[nyao]', safeDiagnostic(e.message));
    return fallback;
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      console.error(`[${channel}]`, safeDiagnostic(e.message));
      return { ok: false, error: safeDiagnostic(e.message || String(e)) };
    }
  });
}

/**
 * Лайк SoundCloud: обычный запрос через сессию браузера → если вылезла капча, показываем её и повторяем →
 * если всё равно не вышло, ставим лайк в очередь (в Nyao он уже стоит).
 */
async function likeSoundCloud(track, on) {
  const token = sc.token;
  scLikes.enqueue(track, on);
  let result = await scLikes.flush();
  if (result.error?.captcha && token === sc.token) {
    const solved = await solveScCaptcha(win, result.error.captcha);
    if (solved && token === sc.token) result = await scLikes.flush();
  }
  const pending = scLikes.list().some(x => x.srcId === String(track.srcId));
  return pending ? { on, pending: true, reason: result.error?.captcha ? 'SoundCloud ждёт проверки' : 'SoundCloud пока не принял изменение — повторю позже' } : on;
}

function registerIpc() {
  handle('win:minimize', () => win.minimize());
  handle('deeplink:take', () => {
    const l = pendingLink;
    pendingLink = null;
    return l;
  });
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
  // карточка со строками текста: обложка для canvas (без CORS), копирование и сохранение готовой картинки
  handle('card:cover', async (url) => {
    if (!/^https:\/\//.test(String(url || ''))) return null;
    const res = await net.fetch(url);
    if (!res.ok) return null;
    const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    return (width > 800 ? img.resize({ width: 800, quality: 'best' }) : img).toDataURL();
  });
  const cardImage = (dataUrl) => {
    if (!/^data:image\/png;base64,/.test(String(dataUrl || ''))) throw new Error('не картинка');
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) throw new Error('пустая картинка');
    return img;
  };
  handle('card:copy', (dataUrl) => {
    clipboard.writeImage(cardImage(dataUrl));
    return true;
  });
  handle('card:save', async (dataUrl, name) => {
    const img = cardImage(dataUrl);
    const safe = String(name || 'Nyao.png').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 140);
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safe.endsWith('.png') ? safe : `${safe}.png`), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, img.toPNG());
    return r.filePath;
  });
  handle('open:external', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  handle('app:version', () => readVersion());
  handle('update:check', async () => {
    const hot = globalThis.__nyaoHot;
    // канал обновлений из центра обновлений (как на macOS); не выбран — как у установленной сборки
    const ver = readVersion();
    const pick = settings.get().updateChannel;
    const channel = ['stable', 'dev', 'nightly'].includes(pick) ? pick : ver.channel || 'stable';
    const info = await checkUpdate({ ...ver, channel: channel === 'stable' ? null : channel }, globalThis.fetch.bind(globalThis), { compat: hot && hot.store.enabled ? hot.compat : null });
    info.channel = channel;
    // горячее обновление уже скачано и ждёт перезапуска
    const st = hot && hot.store.enabled ? hot.store.state() : null;
    info.staged = !!(st && st.current != null && st.current !== hot.running && st.current > readVersion().build);
    return info;
  });
  // горячее обновление: скачать маленький пакет кода, проверить подпись и поставить — применится после перезапуска
  handle('update:hot', async (pkg) => {
    const hot = globalThis.__nyaoHot;
    if (!hot || !hot.store.enabled) throw new Error('В этой сборке быстрые обновления выключены');
    if (!pkg || ![pkg.url, pkg.sigUrl].every((u) => UPDATE_URL.test(String(u || '')))) throw new Error('Нет пакета обновления');
    const f = globalThis.fetch.bind(globalThis);
    const { buf, sig } = await fetchHot(pkg, f);
    try {
      return hot.store.install(buf, sig);
    } catch (e) {
      // на зеркале пакет и подпись могли разойтись (файл перезалили) — берём оба с GitHub
      const gh = pkg.githubUrl && pkg.githubSigUrl && /подпись/.test(e.message) && [pkg.githubUrl, pkg.githubSigUrl].every((u) => UPDATE_URL.test(u));
      if (!gh) throw e;
      const again = await fetchHot({ url: pkg.githubUrl, sigUrl: pkg.githubSigUrl }, f);
      return hot.store.install(again.buf, again.sig);
    }
  });
  // ---------- Раздел «Разработчик» (виден аккаунтам из NYAO_DEV_IDS; здесь — только локальные проверки) ----------
  handle('dev:info', () => {
    const hot = globalThis.__nyaoHot;
    return {
      version: readVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch} · ${os.release()}`,
      userData: app.getPath('userData'),
      packaged: app.isPackaged,
      flags: { librespot: !!(nativeAllowed() && settings.get().experimentalLibrespot) },
      native: { available: !!spExperiment?.nativeEngine.available },
      memory: Math.round(process.memoryUsage().rss / 1048576),
      hot: hot ? { enabled: hot.store.enabled, running: hot.running, bundled: hot.bundled, compat: hot.compat, state: hot.store.state() } : null
    };
  });
  handle('dev:hotClearBad', () => {
    const hot = globalThis.__nyaoHot;
    if (!hot) return false;
    hot.store.save({ ...hot.store.state(), bad: [] });
    return true;
  });
  handle('dev:open', (what) => {
    const files = { data: '', yt: 'yt-debug.log', vk: 'vk-debug.log', lyrics: 'lyrics-debug.log' };
    if (!(what in files)) return false;
    const p = path.join(app.getPath('userData'), files[what]);
    if (what !== 'data' && !fs.existsSync(p)) throw new Error('Журнал пока пустой');
    shell.openPath(p);
    return true;
  });
  // задержка до серверов Nyao и GitHub
  handle('dev:ping', async () => {
    const targets = [
      ['API Nyao', `${cloud ? cloud.base : API_BASE}/health`],
      ['Зеркало обновлений', 'https://api.music.withnyao.app/updates/latest'],
      ['Nyao LyricLabs', 'https://api.corrode5-15.withnyao.app/'],
      ['GitHub', 'https://api.github.com/zen']
    ];
    return Promise.all(targets.map(async ([name, url]) => {
      const t0 = Date.now();
      try {
        const res = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
        return { name, ms: Date.now() - t0, status: res.status };
      } catch (e) {
        return { name, ms: Date.now() - t0, error: safeDiagnostic(e.message) };
      }
    }));
  });
  // «без сети»: запросы через Chromium (окно и net.fetch) перестают ходить
  handle('dev:offline', (on) => {
    const opts = on ? { offline: true } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    session.defaultSession.enableNetworkEmulation(opts);
    return !!on;
  });
  handle('dev:crash', (what) => {
    if (what === 'renderer' && win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
    else if (what === 'main') setTimeout(() => process.crash(), 100);
    return true;
  });
  handle('dev:diag', () => {
    const s = { ...settings.get() };
    delete s.eq;
    return JSON.stringify({ version: readVersion(), electron: process.versions.electron, platform: `${process.platform} ${process.arch}`, status: svcStatus, settings: s, at: new Date().toISOString() }, null, 2);
  });
  handle('update:relaunch', () => {
    quitting = true;
    app.relaunch();
    app.quit();
  });
  // «вернуть версию из установщика»: горячее обновление больше не запускаем
  handle('update:resetHot', () => {
    const hot = globalThis.__nyaoHot;
    if (!hot) return false;
    const st = hot.store.state();
    if (hot.running != null) hot.store.save({ ...st, current: null, pending: null, bad: [...new Set([...st.bad, hot.running])] });
    quitting = true;
    app.relaunch();
    app.quit();
    return true;
  });
  handle('update:download', async (asset) => {
    if (!asset || !UPDATE_URL.test(asset.url)) throw new Error('Нет файла для этой системы');
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
  // оформление на macOS: 'glass' — Liquid Glass, 'nyao' — как на Windows; окно перезагружается в новой теме
  handle('theme:set', (v) => {
    if (process.platform !== 'darwin') return { ok: false };
    settings.set({ macTheme: v === 'glass' ? 'glass' : 'nyao' });
    const theme = currentTheme();
    if (win && !win.isDestroyed()) {
      if (typeof win.setWindowButtonPosition === 'function') win.setWindowButtonPosition(trafficLights(theme));
      setTimeout(() => win && !win.isDestroyed() && win.loadFile(path.join(RENDERER, 'index.html'), { query: { theme } }), 60);
    }
    return { ok: true, theme };
  });
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
  handle('sc:pending', () => scLikes.list());
  handle('yt:openLog', () => {
    const file = path.join(app.getPath('userData'), 'yt-debug.log');
    if (!fs.existsSync(file)) fs.writeFileSync(file, 'Сбоев YouTube пока не было.\n');
    return shell.openPath(file);
  });
  handle('vk:openLog', () => shell.openPath(path.join(app.getPath('userData'), 'vk-debug.log')));

  // ---------- Аккаунт Nyao ----------
  handle('cloud:status', () => cloud.status());
  handle('cloud:login', async () => {
    const user = await cloud.login();
    syncCloud();
    return user;
  });
  handle('cloud:cancel', () => cloud.cancelLogin());
  handle('cloud:logout', async () => { spExperiment?.nativeEngine.release(); nativePermission = false; await cloud.logout(); });
  handle('cloud:me', () => cloud.me());
  // мини-соцсеть: профиль, друзья, приглашения, входящие — только эти адреса сервера
  // весь путь целиком: без «..», «//» и чужих адресов вроде /friends/../devices/5
  const SOCIAL_PATH = /^\/(profile|nick\/check|users\/search|users\/(?!\.)[A-Za-z0-9_.]{1,24}|friends|friends\/request|friends\/\d+(\/(accept|invite|react|match|mix))?|invites|invites\/[a-z0-9]{6,16}(\/use)?|share|inbox|inbox\/read|blocks|blocks\/\d+)(\?[A-Za-z0-9_.~%=&@+-]*)?$/;
  handle('social:api', (method, p, body) => {
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method) || typeof p !== 'string' || !SOCIAL_PATH.test(p)) throw new Error('Нельзя');
    return cloud.request(method, p, body);
  });
  handle('cloud:removeDevice', (id) => cloud.removeDevice(id));
  // Nyao Legacy (Android 4.x): токены шифруются открытым ключом устройства (RSA-OAEP-SHA1 + AES-256-GCM),
  // сервер только передаёт пакет и прочитать его не может
  handle('cloud:legacyPair', async (raw) => {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) throw new Error('Код — 6 символов с экрана старого устройства');
    const info = await cloud.request('GET', `/legacy/pair/code/${code}`);
    const data = { v: 1 };
    if (secrets.get('yandexToken')) data.yandexToken = secrets.get('yandexToken');
    if (secrets.get('ytmCookie')) data.ytCookie = secrets.get('ytmCookie');
    if (!data.yandexToken && !data.ytCookie) throw new Error('Сначала войди в Яндекс Музыку или YouTube Music');
    const pub = crypto.createPublicKey({ key: Buffer.from(info.publicKey, 'base64'), format: 'der', type: 'spki' });
    const aes = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const key = crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, aes);
    const c = crypto.createCipheriv('aes-256-gcm', aes, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final(), c.getAuthTag()]);
    await cloud.request('POST', `/legacy/pair/code/${code}`, { payload: [key, iv, enc].map((b) => b.toString('base64')).join('.') });
    return info.device || '';
  });
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
  handle('radio:feedback', (type, track, played) => radio.feedback(type, track, played));
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
  const providers = () => ({ ya, yt, sc, vk, sp });
  const usable = (s) => up(s) && (s === 'yt' || s === 'sc' || (s === 'ya' && ya.loggedIn) || (s === 'vk' && vk.loggedIn) || (s === 'sp' && spOn()));
  handle('match:playable', async (track) => {
    if (!track) return null;
    if (usable(track.source)) {
      if (track.source !== 'sp') return track;
      const account = await spSafe(sp.getAccount(), null);
      if (account?.premium === true) return track;
    }
    const order = ['ya', 'vk', 'yt', 'sc'].filter(usable);
    for (const s of order) {
      const m = await findMatch(track, (q) => providers()[s].search(q), { minScore: 0.85 });
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

  // ---------- Spotify ----------
  let nativeAccount = null;
  async function nativeStatus() {
    if (cloud?.loggedIn && cloud.user?.dev && readVersion().channel === 'nightly') {
      try { await requireNativeDeveloper(); } catch { if (!cloud?.loggedIn || !cloud.user?.dev) nativePermission = false; }
    } else nativePermission = false;
    if (!nativeAllowed()) { spExperiment.nativeEngine.release(); return { permitted: false, flag: false, active: false }; }
    if (spExperiment.active) spExperiment.standardEngine.release();
    const api = spExperiment.nativeApi;
    if (!settings.get().experimentalLibrespot) return { permitted: true, flag: false, active: false, available: spExperiment.nativeEngine.available };
    return { permitted: true, flag: !!settings.get().experimentalLibrespot,
      available: spExperiment.nativeEngine.available, active: spExperiment.active,
      loggedIn: api.loggedIn, clientId: api.clientId, hasClientId: api.hasClientId,
      redirect: LIBRESPOT_REDIRECT, regionBlocked: api.regionBlocked, engine: spExperiment.nativeEngine.status, lastFailure: spExperiment.nativeEngine.lastFailure,
      account: api.loggedIn ? await spSafe(api.getAccount().then(account => (nativeAccount = account)), nativeAccount || { name: 'Spotify (librespot)', error: true }) : null,
    };
  }
  const spStatus = async () => {
    const standard = spExperiment.standardApi;
    const [wv, account, native] = await Promise.all([
      Promise.race([widevineReady(), new Promise(r => setTimeout(() => r({ ok: false, reason: 'ещё загружается' }), 300))]),
      standard.loggedIn ? spSafe(standard.getAccount(), { name: standard.regionBlocked ? 'Spotify (нужен VPN)' : 'Spotify', error: true }) : null,
      nativeStatus(),
    ]);
    return { clientId: standard.clientId, hasClientId: standard.hasClientId,
      loggedIn: standard.loggedIn, regionBlocked: standard.regionBlocked, redirect: SP_REDIRECT,
      widevine: wv, engine: spExperiment.standardEngine.status, account, native };
  };
  handle('spotify:status', () => spStatus());
  handle('spotify:setClientId', id => { spExperiment.standardApi.setClientId(id); return spStatus(); });
  handle('spotify:login', async () => { await spExperiment.standardApi.login(); showWindow(); return spStatus(); });
  handle('spotify:logout', () => { spExperiment.standardEngine.release(); spExperiment.standardApi.logout(); return spStatus(); });
  handle('dev:librespotFlag', async on => {
    await requireNativeDeveloper();
    if (on !== true && on !== false) throw new Error('Неизвестное значение флага');
    if (on) settings.set({ experimentalLibrespot: true }); else spExperiment.disable();
    wave.invalidateLikes();
    return spStatus();
  });
  handle('dev:librespotClientId', async id => {
    await requireNativeDeveloper();
    if (!spExperiment.visible || !/^[0-9a-fA-F]{32}$/.test(String(id))) throw new Error('Нужен Client ID — 32 символа');
    spExperiment.select(false); nativeAccount = null; spExperiment.nativeApi.setClientId(id); wave.invalidateLikes();
    return spStatus();
  });
  handle('dev:librespotLogin', async () => {
    await requireNativeDeveloper();
    if (!spExperiment.visible) throw new Error('Сначала включи флаг librespot');
    if (!spExperiment.nativeEngine.available) throw new Error('Для librespot нужен полный установщик этой версии');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Недоступно защищённое хранилище системы');
    spExperiment.select(false);
    await spExperiment.nativeApi.login();
    const account = await spExperiment.nativeApi.getAccount(); nativeAccount = account;
    if (!account.premium) throw new Error('Для librespot нужен Spotify Premium');
    await spExperiment.nativeEngine.awaitReady();
    // The worker has proved that it can establish its own Spotify session.
    if (spExperiment.nativeEngine.username && spExperiment.nativeEngine.username !== account.uid) {
      spExperiment.nativeEngine.release(); throw new Error('Аккаунт движка не совпал — войди заново');
    }
    spExperiment.select(true);
    wave.invalidateLikes(); showWindow(); return spStatus();
  });
  handle('dev:librespotUse', async on => {
    await requireNativeDeveloper();
    if (!spExperiment.visible) throw new Error('Флаг librespot выключен');
    spExperiment.select(false);
    if (on === true) {
      const account = await spExperiment.nativeApi.getAccount(); nativeAccount = account;
      if (!account.premium) throw new Error('Для librespot нужен Spotify Premium');
      await spExperiment.nativeEngine.awaitReady(); spExperiment.select(true);
    }
    wave.invalidateLikes(); return spStatus();
  });
  handle('dev:librespotLogout', async () => {
    await requireNativeDeveloper(); spExperiment.select(false); spExperiment.nativeApi.logout(); nativeAccount = null;
    wave.invalidateLikes(); return spStatus();
  });
  handle('dev:librespotDebug', async () => { await requireNativeDeveloper(); return spExperiment.nativeEngine.debugText(); });
  handle('spotify:prewarm', async () => {
    if (!spOn()) return false;
    await spEngine.awaitReady(60_000);
    return true;
  });
  handle('spotify:play', (uris, positionMs) => spEngine.playUris(uris, positionMs));
  handle('spotify:pause', () => spEngine.pause());
  handle('spotify:resume', () => spEngine.resume());
  handle('spotify:seek', (ms) => spEngine.seek(ms));
  handle('spotify:next', () => spEngine.nextTrack());
  handle('spotify:volume', (v) => (spEngine.started ? spEngine.setVolume(v) : null));
  handle('spotify:modes', () => spEngine.ensureModes());
  handle('spotify:snapshot', () => ({ status: spEngine.status, snapshot: spEngine.snapshot }));
  handle('spotify:debug', async () => {
    const wv = await Promise.race([widevineReady(), new Promise((r) => setTimeout(() => r({ ok: false, reason: 'ещё загружается' }), 300))]);
    return [
      `Client ID: ${sp.hasClientId ? 'задан' : 'нет'}`,
      `Вход: ${sp.loggedIn ? 'да' : 'нет'}`,
      `Widevine: ${wv.ok ? 'готов' : wv.reason}`,
      `Плеер: ${spEngine.status.state}${spEngine.status.message ? ' — ' + spEngine.status.message : ''}`,
      '',
      '— Плеер —',
      spEngine.debugText() || 'Плеер ещё не запускался.',
      '',
      '— Web API —',
      sp.debugText() || 'Ошибок Web API пока не было.'
    ].join('\n');
  });

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
    const [yaLists, ytLists, scLists, vkLists, spLists] = await Promise.all([
      ya.loggedIn ? safe(ya.playlists(), []) : [],
      yt.loggedIn ? safe(yt.playlists(), []) : [],
      sc.loggedIn ? safe(sc.playlists(), []) : [],
      vk.loggedIn ? safe(vk.playlists(), []) : [],
      spOn() ? spSafe(sp.playlists(), []) : []
    ]);
    return [...readMixes().map(mixSummary), ...yaLists, ...ytLists, ...scLists, ...vkLists, ...spLists];
  });

  handle('library:liked', async () => {
    const [a, b, c, d, e] = await Promise.all([
      ya.loggedIn ? safe(ya.likedTracks(), []) : [],
      yt.loggedIn ? safe(yt.likedTracks(), []) : [],
      sc.loggedIn ? safe(sc.likedTracks(), []) : [],
      vk.loggedIn ? safe(vk.likedTracks(), []) : [],
      spOn() ? spSafe(sp.likedTracks(), []) : []
    ]);
    // Чередуем, чтобы общий список не был «сначала весь Яндекс, потом весь YT»
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length, c.length, d.length, e.length); i++) {
      for (const l of [a, b, c, d, e]) if (l[i]) out.push(l[i]);
    }
    return { tracks: out, ya: a.length, yt: b.length, sc: c.length, vk: d.length, sp: e.length };
  });

  handle('library:tracks', async (playlistId) => {
    if (playlistId.startsWith('mix:')) return (readMixes().find((m) => m.id === playlistId) || { tracks: [] }).tracks;
    if (playlistId.startsWith('ya:')) return ya.playlistTracks(playlistId);
    if (playlistId.startsWith('yt:')) return yt.playlistTracks(playlistId);
    if (playlistId.startsWith('sc:')) return sc.playlistTracks(playlistId);
    if (playlistId.startsWith('vk:')) return vk.playlistTracks(playlistId);
    if (playlistId.startsWith('sp:')) return sp.playlistTracks(playlistId);
    throw new Error('Неизвестный плейлист');
  });

  handle('artists:list', async () => {
    await importYaArtists();
    return readFav();
  });
  handle('artists:like', async (artist, on) => {
    if (!artist || !artist.ref) throw new Error('Нет исполнителя');
    const refs = artist.refs && typeof artist.refs === 'object' ? artist.refs : {};
    const same = (x) => x.ref === artist.ref || (refs.ya && (x.ref === refs.ya || (x.refs && x.refs.ya === refs.ya))) || (refs.yt && (x.ref === refs.yt || (x.refs && x.refs.yt === refs.yt)));
    let list = readFav().filter((x) => !same(x));
    if (on) list = [{ ref: refs.ya || artist.ref, refs: { ya: refs.ya || null, yt: refs.yt || null }, name: String(artist.name || '').slice(0, 200), cover: artist.cover || null, at: Date.now() }, ...list];
    writeFav(list);
    // в Яндексе — «Мои исполнители», чтобы и его рекомендации учитывали
    if (refs.ya && ya && ya.loggedIn) ya.likeArtist(refs.ya, !!on).catch((e) => console.warn('[fav] Яндекс', e.message));
    return list;
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
    const [a, b, c, d, e, arYa, arYt, alYa, alYt] = await Promise.all([
      yaOn ? safe(ya.search(q), []) : [], up('yt') ? safe(yt.search(q), []) : [], up('sc') ? safe(sc.search(q), []) : [], vk.loggedIn && up('vk') ? safe(vk.search(q), []) : [],
      spOn() ? spSafe(sp.search(q), []) : [],
      // исполнители и альбомы: Яндекс и YouTube Music
      yaOn ? safe(ya.searchArtist(q), []) : [], up('yt') ? safe(yt.searchArtist(q), []) : [],
      yaOn ? safe(ya.searchAlbum(q), []) : [], up('yt') ? safe(yt.searchAlbum(q), []) : []
    ]);
    const albums = [];
    for (let i = 0; i < Math.max(alYa.length, alYt.length) && albums.length < 12; i++) for (const l of [alYa, alYt]) if (l[i] && albums.length < 12) albums.push(l[i]);
    return { ya: a, yt: b, sc: c, vk: d, sp: e, artists: mergeArtists([arYa, arYt], q), albums };
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
  const lyricsDeps = () => ({
    fetch: fetchFn,
    // порядок провайдеров из настроек («Текст песни»)
    order: settings.get().lyricsOrder,
    wordsFirst: settings.get().lyricsWordsFirst !== false,
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
  });
  handle('lyrics', (track, opts = {}) => findLyricsChain(track, {
    ...lyricsDeps(),
    exclude: Array.isArray(opts && opts.exclude) ? opts.exclude.map(String) : []
  }));
  // Разработчик: каждый источник текста отдельно — что вернул и за сколько
  handle('dev:lyricsProbe', async (track) => {
    const deps = lyricsDeps();
    return Promise.all(LYRICS_PROVIDERS.map(async (id) => {
      const t0 = Date.now();
      try {
        // только этот источник: остальные явно выключены (иначе недостающие добавляются включёнными)
        if (id === 'ytm' && track.source !== 'yt') return { id, ms: 0, found: false, skipped: 'только для треков YouTube Music' };
        if (id === 'ya' && !deps.ya) return { id, ms: 0, found: false, skipped: 'нет входа в Яндекс' };
        const r = await findLyricsChain(track, { ...deps, order: LYRICS_PROVIDERS.map((p) => ({ id: p, on: p === id })), wordsFirst: false, log: () => {} });
        return { id, ms: Date.now() - t0, found: !!(r && r.lines && r.lines.length), synced: !!(r && r.synced), words: !!(r && r.words), lines: r && r.lines ? r.lines.length : 0, source: r && r.source, diag: r && r.diag ? r.diag.join(' · ') : '' };
      } catch (e) {
        return { id, ms: Date.now() - t0, found: false, error: e.message };
      }
    }));
  });
  handle('like', async (track, on) => {
    wave.invalidateLikes();
    if (track.source === 'ya') await ya.like(track, on);
    else if (track.source === 'yt') await yt.like(track, on);
    else if (track.source === 'sc') return likeSoundCloud(track, on);
    else if (track.source === 'vk') await vk.like(track, on);
    else if (track.source === 'sp') await sp.like(track, on);
    return on;
  });
}

/**
 * Оформление: на всех ПК — тема Nyao (как на Windows); на macOS можно включить Liquid Glass в настройках.
 * NYAO_THEME=mac|win переопределяет выбор (удобно, чтобы посмотреть чужую тему).
 */
function currentTheme() {
  if (process.env.NYAO_THEME === 'mac' || process.env.NYAO_THEME === 'win') return process.env.NYAO_THEME;
  return process.platform === 'darwin' && (settings.get() || {}).macTheme === 'glass' ? 'mac' : 'win';
}
/** «Светофоры» macOS: в Liquid Glass — в боковой панели, в теме Nyao — по центру полосы заголовка (44 px) */
const trafficLights = (theme) => (theme === 'mac' ? { x: 26, y: 26 } : { x: 16, y: 15 });

function createWindow() {
  const theme = currentTheme();
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    // На macOS оставляем родные «светофоры», на Windows — свои кнопки окна
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: trafficLights(theme) }
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
  watchHotStart(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadFile(path.join(RENDERER, 'index.html'), { query: { theme } });
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
  // ссылки nyao:// в системе ведут в Nyao Music (в собранном приложении это прописывает и установщик)
  try {
    if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('nyao', process.execPath, [path.resolve(process.argv[1])]);
    else app.setAsDefaultProtocolClient('nyao');
  } catch {
    // не страшно: останется кнопка «Открыть» на странице ссылки
  }
  // При запуске через npm start показываем нашу иконку в доке (в собранном .app она и так своя)
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      app.dock.setIcon(path.join(globalThis.__nyaoBundledRoot || path.join(__dirname, '..', '..'), 'build', 'icon-mac.png'));
    } catch {
      // иконка не критична
    }
  }
  initProviders();
  // копии треков Spotify из других сервисов: id трека Spotify → трек (значок «SP → Я»)
  const spSubs = new Map();
  const spFinding = new Map();
  spSubstitute = (id, params) => {
    if (spSubs.has(id)) return Promise.resolve(spSubs.get(id));
    if (spFinding.has(id)) return spFinding.get(id);
    const track = {
      id,
      source: 'sp',
      srcId: id.slice(3),
      title: String(params.get('t') || '').slice(0, 200),
      artist: String(params.get('a') || '').slice(0, 200),
      duration: Number(params.get('d')) || 0
    };
    const job = (async () => {
      if (!track.title) return null;
      const ok = (s) => up(s) && (s === 'yt' || s === 'sc' || (s === 'ya' && ya.loggedIn) || (s === 'vk' && vk.loggedIn));
      for (const s of ['ya', 'yt', 'vk', 'sc'].filter(ok)) {
        const m = await findMatch(track, (q) => ({ ya, yt, sc, vk })[s].search(q), { minScore: 0.8 }).catch(() => null);
        if (m) {
          spSubs.set(id, m.track);
          while (spSubs.size > 500) spSubs.delete(spSubs.keys().next().value);
          send('stream:substitute', { id, track: m.track });
          return m.track;
        }
      }
      return null;
    })().finally(() => spFinding.delete(id));
    spFinding.set(id, job);
    return job;
  };
  protocol.handle('nyao', async (request) => {
    const u = new URL(request.url);
    // трек Spotify: в <audio> — тишина той же длины, звук даёт устройство Spotify (см. renderer/spotify-sync.js)
    let req = request;
    const sid = u.host === 'stream' ? decodeURIComponent(u.pathname.slice(1)) : '';
    if (sid.startsWith('sp:')) {
      // Spotify сам играть не может (нет Premium, регион, не вошли) — играем копию из другого сервиса
      if (u.searchParams.get('x') !== '1' && spOn()) return silenceResponse(Number(u.searchParams.get('d')) || 0, request.headers.get('range'));
      const sub = await spSubstitute(sid, u.searchParams).catch(() => null);
      if (!sub) return new Response('Не нашёл этот трек в других сервисах — без Premium Spotify сам не играет', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      req = new Request(`nyao://stream/${encodeURIComponent(sub.id)}`, { headers: request.headers });
    }
    const res = await streams.handle(req);
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
app.on('before-quit', () => { quitting = true; spExperiment?.nativeEngine.release(); });

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
