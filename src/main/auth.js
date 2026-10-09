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
    width: 520,
    height: 760,
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
  if (userAgent) win.webContents.setUserAgent(userAgent);
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
