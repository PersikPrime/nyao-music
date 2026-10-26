// Окна входа. Яндекс: OAuth-страница, токен приходит в адресе после редиректа.
// Google: обычная страница входа, после попадания на music.youtube.com забираем cookies сессии.
import { BrowserWindow, session } from 'electron';
import { OAUTH_URL } from './providers/yandex.js';

// Google часто не пускает «встроенные браузеры»; с UA обычного Firefox вход обычно проходит.
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
const YTM_PARTITION = 'persist:ytm-login';

// Обычное окно с родной рамкой и кнопкой закрытия — не модальное:
// модальное окно на macOS превращается в «шторку» без кнопок, и его не закрыть.
function loginWindow(parent, title, partition, userAgent) {
  const win = new BrowserWindow({
    width: 560,
    height: 780,
    title,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    minimizable: false,
    fullscreenable: false,
    webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  if (parent && !parent.isDestroyed()) {
    const [px, py] = parent.getPosition();
    const [pw] = parent.getSize();
    win.setPosition(Math.round(px + pw / 2 - 260), py + 60);
  }
  if (userAgent) {
    win.webContents.setUserAgent(userAgent);
    // UA на всю сессию входа — так его получают и всплывающие окна (например, «Войти через Google» у SoundCloud)
    session.fromPartition(partition).setUserAgent(userAgent);
  }
  // Всплывающие окна входа (Google, Apple, Facebook) открываем в той же сессии и без меню Electron —
  // иначе они получают «голый» браузер Electron, и Google отвечает «браузер не поддерживает JavaScript»
  win.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 500,
      height: 700,
      autoHideMenuBar: true,
      backgroundColor: '#FFFFFF',
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false }
    }
  }));
  const children = new Set();
  win.on('closed', () => children.forEach((c) => !c.isDestroyed() && c.close()));
  win.webContents.on('did-create-window', (child) => {
    children.add(child);
    child.on('closed', () => children.delete(child));
    child.setMenuBarVisibility(false);
    if (userAgent) child.webContents.setUserAgent(userAgent);
  });
  return win;
}

export function loginYandex(parent) {
  return new Promise((resolve, reject) => {
    const win = loginWindow(parent, 'Вход в Яндекс Музыку', 'persist:ya-login');
    let done = false;
    const inspect = (url) => {
      if (done || !url.includes('access_token=')) return;
      const hash = url.split('#')[1] || url.split('?')[1] || '';
      const token = new URLSearchParams(hash).get('access_token');
      if (!token) return;
      done = true;
      resolve(token);
      win.close();
    };
    for (const ev of ['will-redirect', 'will-navigate', 'did-navigate', 'did-navigate-in-page', 'did-redirect-navigation']) {
      win.webContents.on(ev, (e, url) => inspect(String(url || (e && e.url) || '')));
    }
    win.on('closed', () => {
      if (!done) reject(new Error('Вход в Яндекс отменён'));
    });
    win.loadURL(OAUTH_URL);
  });
}

export async function ytmCookieString() {
  const ses = session.fromPartition(YTM_PARTITION);
  const cookies = await ses.cookies.get({ domain: '.youtube.com' });
  const names = new Set(cookies.map((c) => c.name));
  if (!names.has('SAPISID') && !names.has('__Secure-3PAPISID')) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function loginYTMusic(parent) {
  return new Promise((resolve, reject) => {
    const win = loginWindow(parent, 'Вход в YouTube Music', YTM_PARTITION, FIREFOX_UA);
    let done = false;
    const inspect = async (url) => {
      if (done || !/^https:\/\/music\.youtube\.com\//.test(url)) return;
      const cookie = await ytmCookieString();
      if (!cookie || done) return;
      done = true;
      resolve(cookie);
      win.close();
    };
    win.webContents.on('did-navigate', (e, url) => inspect(url));
    win.webContents.on('did-navigate-in-page', (e, url) => inspect(url));
    win.on('closed', () => {
      if (!done) reject(new Error('Вход в YouTube Music отменён'));
    });
    const cont = encodeURIComponent('https://music.youtube.com/');
    win.loadURL(`https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=${cont}`);
  });
}

export async function logoutYTMusic() {
  await session.fromPartition(YTM_PARTITION).clearStorageData();
}

export async function logoutYandex() {
  await session.fromPartition('persist:ya-login').clearStorageData();
}

// ---------- SoundCloud: после входа сайт кладёт OAuth-токен в cookie oauth_token ----------
const SC_PARTITION = 'persist:sc-login';

export async function scToken() {
  const cookies = await session.fromPartition(SC_PARTITION).cookies.get({ name: 'oauth_token' });
  const c = cookies.find((x) => /soundcloud\.com$/.test(x.domain.replace(/^\./, '')));
  return c ? decodeURIComponent(c.value) : null;
}

export function loginSoundCloud(parent) {
  return new Promise((resolve, reject) => {
    const win = loginWindow(parent, 'Вход в SoundCloud', SC_PARTITION, FIREFOX_UA);
    let done = false;
    const inspect = async () => {
      if (done) return;
      const token = await scToken();
      if (!token || done) return;
      done = true;
      clearInterval(timer);
      resolve(token);
      win.close();
    };
    // окно входа SoundCloud — одностраничное, поэтому кроме навигаций раз в секунду проверяем cookie
    const timer = setInterval(inspect, 1000);
    win.webContents.on('did-navigate', inspect);
    win.webContents.on('did-navigate-in-page', inspect);
    win.on('closed', () => {
      clearInterval(timer);
      if (!done) reject(new Error('Вход в SoundCloud отменён'));
    });
    win.loadURL('https://soundcloud.com/signin');
  });
}

export async function logoutSoundCloud() {
  await session.fromPartition(SC_PARTITION).clearStorageData();
}

/** fetch через сессию окна входа SoundCloud (cookie DataDome + сетевой стек Chromium) */
export function scSessionFetch(url, opts) {
  const ses = session.fromPartition(SC_PARTITION);
  ses.setUserAgent(FIREFOX_UA);
  return ses.fetch(url, opts);
}

/**
 * Окно с капчей SoundCloud (DataDome) в той же сессии. Резолвится, когда проверка пройдена
 * (DataDome поставил новую cookie) или окно закрыли.
 */
export function solveScCaptcha(parent, url) {
  return new Promise((resolve) => {
    const ses = session.fromPartition(SC_PARTITION);
    const win = loginWindow(parent, 'SoundCloud: проверка, что ты не бот', SC_PARTITION, FIREFOX_UA);
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      ses.cookies.removeListener('changed', onCookie);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    const onCookie = (_e, cookie, _cause, removed) => {
      if (!removed && cookie.name === 'datadome') setTimeout(() => finish(true), 800);
    };
    ses.cookies.on('changed', onCookie);
    win.on('closed', () => finish(false));
    win.loadURL(url);
  });
}

// ---------- VK Музыка (dev): вход в обычном окне vk.com, дальше работаем cookie этой сессии ----------
const VK_PARTITION = 'persist:vk-login';

/**
 * Вход во VK: обычное окно сайта. Вошёл ли человек — спрашиваем саму страницу: у веб-версии VK
 * в глобальном объекте vk лежит id вошедшего пользователя (vk.id). Так не зависим от имён cookie
 * и от домена (vk.com или vk.ru). Возвращает { uid, origin }.
 */
export function loginVK(parent) {
  return new Promise((resolve, reject) => {
    const win = loginWindow(parent, 'Вход во VK', VK_PARTITION, FIREFOX_UA);
    let done = false;
    const inspect = async () => {
      if (done || win.isDestroyed()) return;
      let r = null;
      try {
        r = await win.webContents.executeJavaScript('({ uid: (window.vk && Number(window.vk.id)) || 0, origin: location.origin })', true);
      } catch {
        return; // страница ещё грузится
      }
      if (!r || !r.uid || done) return;
      done = true;
      clearInterval(timer);
      resolve({ uid: r.uid, origin: /^https:\/\/([a-z0-9-]+\.)?vk\.(com|ru)$/.test(r.origin) ? r.origin.replace(/\/\/(m|new)\./, '//') : 'https://vk.com' });
      win.close();
    };
    const timer = setInterval(inspect, 1500);
    win.webContents.on('did-finish-load', inspect);
    win.webContents.on('did-navigate-in-page', inspect);
    win.on('closed', () => {
      clearInterval(timer);
      if (!done) reject(new Error('Вход во VK отменён'));
    });
    win.loadURL('https://vk.com/login');
  });
}

export async function logoutVK() {
  await session.fromPartition(VK_PARTITION).clearStorageData();
}

/** fetch через сессию окна входа VK — с её cookie и тем же User-Agent */
export function vkSessionFetch(url, opts = {}) {
  const ses = session.fromPartition(VK_PARTITION);
  ses.setUserAgent(FIREFOX_UA);
  return ses.fetch(url, opts);
}

let vkRefreshing = null;
/** Let VK renew its own cookies. A loaded page alone is not proof of authentication. */
export function refreshVkSession(uid, base) {
  if (vkRefreshing) return vkRefreshing;
  if (!/^https:\/\/vk\.(com|ru)$/.test(base) || !Number(uid)) return Promise.resolve(null);
  vkRefreshing = new Promise(resolve => {
    const w = new BrowserWindow({ show: false, webPreferences: { partition: VK_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    w.webContents.setUserAgent(FIREFOX_UA);
    session.fromPartition(VK_PARTITION).setUserAgent(FIREFOX_UA);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let done = false;
    const finish = result => { if (done) return; done = true; clearTimeout(timer); if (!w.isDestroyed()) w.destroy(); resolve(result); };
    const timer = setTimeout(() => finish(null), 25_000);
    w.webContents.on('did-finish-load', async () => {
      try {
        const state = await w.webContents.executeJavaScript('({ uid: Number(window.vk?.id) || 0, url: location.href })');
        if (state.uid === Number(uid)) finish(true);
        else { const u = new URL(state.url); if (u.pathname.startsWith('/login') || u.pathname.startsWith('/join') || /^(id|login)\.vk\./.test(u.hostname)) finish(false); }
      } catch { /* Wait for a later navigation or the deadline. */ }
    });
    w.webContents.on('did-fail-load', (_e, _code, _desc, _url, main) => { if (main) finish(null); });
    w.on('closed', () => finish(null));
    w.loadURL(base + '/audios' + Number(uid)).catch(() => finish(null));
  }).finally(() => { vkRefreshing = null; });
  return vkRefreshing;
}
