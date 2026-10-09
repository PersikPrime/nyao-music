import { app, BrowserWindow, ipcMain, protocol, net, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { settings, secrets } from './store.js';
import { YandexProvider } from './providers/yandex.js';
import { YTMusicProvider } from './providers/ytmusic.js';
import { SoundCloudProvider } from './providers/soundcloud.js';
import { checkUpdate, downloadAsset } from './updates.js';
import { WaveMixer } from './wave.js';
import { StreamService } from './stream.js';
import { findLyrics } from './lyrics.js';
import { Catalog } from './catalog.js';
import { DiscordRPC } from './discord.js';
import { loginYandex, loginYTMusic, logoutYandex, logoutYTMusic, loginSoundCloud, logoutSoundCloud } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(__dirname, '..', 'renderer');

// Версия «0.2 (14)»: номер сборки лежит в version.json в корне проекта
function readVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8'));
    return { name: v.name, build: v.build, label: `${v.name} (${v.build})` };
  } catch {
    return { name: app.getVersion(), build: 0, label: app.getVersion() };
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'nyao', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
]);

const fetchFn = (url, opts) => net.fetch(url, opts);
let ya, yt, sc, wave, streams, catalog, win;
const rpc = new DiscordRPC({ log: (m) => console.log(m) });
function configureRpc() {
  const s = settings.get();
  rpc.configure({ enabled: s.discordRpc, clientId: String(s.discordClientId || '').trim() });
}

function initProviders() {
  ya = new YandexProvider({ token: secrets.get('yandexToken'), fetch: fetchFn });
  // YouTube — через fetch из Node (как в npm run yt-test): сеть Electron может подменять заголовки,
  // по которым googlevideo проверяет ссылку
  const nodeFetch = globalThis.fetch.bind(globalThis);
  yt = new YTMusicProvider({ cookie: secrets.get('ytmCookie'), cacheDir: path.join(app.getPath('userData'), 'yt-cache'), fetch: nodeFetch });
  sc = new SoundCloudProvider({ token: secrets.get('scToken'), fetch: nodeFetch });
  wave = new WaveMixer({ ya, yt, sc, getSettings: () => settings.get() });
  streams = new StreamService({ ya, yt, sc, fetchBySource: { ya: fetchFn, yt: nodeFetch, sc: nodeFetch } });
  catalog = new Catalog({ ya, yt });
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
function writeMixes(list) {
  fs.writeFileSync(mixesFile(), JSON.stringify(list, null, 2));
}
function mixSummary(m) {
  return { id: m.id, source: 'mix', title: m.title, count: m.tracks.length, cover: (m.tracks.find((t) => t.cover) || {}).cover || null, ya: m.tracks.filter((t) => t.source === 'ya').length, yt: m.tracks.filter((t) => t.source === 'yt').length };
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

function registerIpc() {
  handle('win:minimize', () => win.minimize());
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.close());
  handle('open:external', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  handle('app:version', () => readVersion());
  handle('update:check', () => checkUpdate(readVersion(), globalThis.fetch.bind(globalThis)));
  handle('update:download', async (asset) => {
    if (!asset || !/^https:\/\/github\.com\//.test(asset.url)) throw new Error('Нет файла для этой системы');
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
    if ('discordRpc' in patch || 'discordClientId' in patch) configureRpc();
    return next;
  });
  handle('rpc:update', (info) => rpc.update(info));
  handle('rpc:status', () => rpc.status);

  handle('auth:status', async () => {
    const [yaAcc, ytAcc, scAcc] = await Promise.all([
      ya.loggedIn ? safe(ya.getAccount(), { name: 'Яндекс', error: true }) : null,
      yt.loggedIn ? safe(yt.getAccount(), { name: 'YouTube Music' }) : null,
      sc.loggedIn ? safe(sc.getAccount(), { name: 'SoundCloud', error: true }) : null
    ]);
    return { ya: yaAcc, yt: ytAcc, sc: scAcc };
  });
  handle('auth:login', async (service) => {
    if (service === 'ya') {
      const token = await loginYandex(win);
      secrets.set('yandexToken', token);
      ya.setToken(token);
      return ya.getAccount();
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

  handle('library:playlists', async () => {
    const [yaLists, ytLists, scLists] = await Promise.all([
      ya.loggedIn ? safe(ya.playlists(), []) : [],
      yt.loggedIn ? safe(yt.playlists(), []) : [],
      sc.loggedIn ? safe(sc.playlists(), []) : []
    ]);
    return [...readMixes().map(mixSummary), ...yaLists, ...ytLists, ...scLists];
  });

  handle('library:liked', async () => {
    const [a, b, c] = await Promise.all([
      ya.loggedIn ? safe(ya.likedTracks(), []) : [],
      yt.loggedIn ? safe(yt.likedTracks(), []) : [],
      sc.loggedIn ? safe(sc.likedTracks(), []) : []
    ]);
    // Чередуем, чтобы общий список не был «сначала весь Яндекс, потом весь YT»
    const out = [];
    for (let i = 0; i < Math.max(a.length, b.length, c.length); i++) {
      if (a[i]) out.push(a[i]);
      if (b[i]) out.push(b[i]);
      if (c[i]) out.push(c[i]);
    }
    return { tracks: out, ya: a.length, yt: b.length, sc: c.length };
  });

  handle('library:tracks', async (playlistId) => {
    if (playlistId.startsWith('mix:')) return (readMixes().find((m) => m.id === playlistId) || { tracks: [] }).tracks;
    if (playlistId.startsWith('ya:')) return ya.playlistTracks(playlistId);
    if (playlistId.startsWith('yt:')) return yt.playlistTracks(playlistId);
    if (playlistId.startsWith('sc:')) return sc.playlistTracks(playlistId);
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
    const [a, b, c] = await Promise.all([ya.loggedIn ? safe(ya.search(q), []) : [], safe(yt.search(q), []), safe(sc.search(q), [])]);
    return { ya: a, yt: b, sc: c };
  });

  handle('wave:start', () => wave.start());
  handle('wave:more', (queueIds) => wave.more(queueIds || []));
  handle('wave:feedback', (type, track, played) => wave.feedback(type, track, played));

  handle('catalog:artist', (ref) => catalog.artist(ref));
  handle('catalog:album', (ref) => catalog.album(ref));
  handle('stream:prepare', (trackId) => streams.prepare(trackId));
  handle('stream:error', (trackId) => streams.lastError(trackId));
  handle('lyrics', (track) => findLyrics(track, fetchFn));
  handle('like', async (track, on) => {
    if (track.source === 'ya') await ya.like(track, on);
    else if (track.source === 'yt') await yt.like(track, on);
    else if (track.source === 'sc') await sc.like(track, on);
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
  protocol.handle('nyao', (request) => streams.handle(request));
  registerIpc();
  configureRpc();
  createWindow();
  // Картинки обложек грузятся напрямую с CDN сервисов — убираем Referer, чтобы не было 403
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.googleusercontent.com/*', 'https://avatars.yandex.net/*', 'https://*.ggpht.com/*'] }, (details, cb) => {
    delete details.requestHeaders.Referer;
    cb({ requestHeaders: details.requestHeaders });
  });
});

app.on('window-all-closed', () => {
  rpc.disconnect();
  app.quit();
});

// Диагностика: какой сайт отдал сертификат, которому Chromium не доверяет, и кем он выпущен.
// Сертификат не принимаем — только пишем в терминал.
app.on('certificate-error', (event, _wc, url, error, cert) => {
  console.warn(`[cert] ${error} ${url} | выпущен: ${cert.issuerName} | для: ${cert.subjectName}`);
});
