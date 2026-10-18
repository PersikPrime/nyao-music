// Окошки в углу экрана, как у Steam: «Takko зовёт слушать вместе», «прислал трек», заявки в друзья.
// Показываются, когда окно Nyao свёрнуто или не в фокусе. Своё маленькое окно поверх всего —
// без системных уведомлений, в стиле Nyao. Нажатие открывает Nyao на нужном месте.
import { BrowserWindow, screen } from 'electron';

const W = 360;
const H = 92;
const GAP = 12;
const LIFE_MS = 7000;
const MAX = 3;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeImg = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

/** HTML окошка. accent — цвет акцента приложения, mac — стеклянный вид */
export function popupHtml({ title, body, picture, cover, action, accent = '#C6B8FF', mac = false }) {
  const img = safeImg(cover) || safeImg(picture);
  const round = safeImg(cover) ? '14px' : '50%';
  const letter = esc(String(title || 'N').trim().slice(0, 1).toUpperCase());
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:13px/1.35 "Segoe UI",system-ui,-apple-system,sans-serif;color:#F2F0F7;user-select:none}
a{all:unset;display:flex;align-items:center;gap:12px;box-sizing:border-box;height:${H - 8}px;margin:4px;padding:12px 14px;border-radius:24px;cursor:pointer;
  background:${mac ? 'rgba(28,26,36,.82)' : '#1D1B25'};${mac ? 'backdrop-filter:blur(30px) saturate(1.6);' : ''}border:1px solid rgba(255,255,255,.08);
  box-shadow:0 10px 30px rgba(0,0,0,.45);animation:in .35s cubic-bezier(.2,1.4,.4,1)}
a:hover{border-color:${accent}66}
@keyframes in{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
.pic{width:52px;height:52px;flex:none;border-radius:${round};background:linear-gradient(135deg,${accent},#7F6BFF);display:grid;place-items:center;font-weight:700;font-size:22px;color:#1A1033;overflow:hidden}
.pic img{width:100%;height:100%;object-fit:cover}
.t{flex:1;min-width:0}.t b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t span{display:block;color:#A9A4B8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.act{flex:none;color:${accent};font-weight:700}
.brand{position:absolute;right:20px;top:9px;font-size:10px;letter-spacing:.06em;color:#8E89A0;text-transform:uppercase}
</style></head><body><a href="nyao-popup://open">
<div class="pic">${img ? `<img src="${esc(img)}" alt="">` : letter}</div>
<div class="t"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ''}</div>
${action ? `<div class="act">${esc(action)}</div>` : ''}
<div class="brand">Nyao</div></a></body></html>`;
}

export class Popups {
  /** onOpen(payload) — окошко нажали: показать Nyao и открыть нужное */
  constructor({ onOpen, getAccent = () => '#C6B8FF', mac = process.platform === 'darwin' }) {
    this.onOpen = onOpen;
    this.getAccent = getAccent;
    this.mac = mac;
    this.list = [];
  }

  show(item) {
    while (this.list.length >= MAX) this.close(this.list[0]);
    const area = screen.getPrimaryDisplay().workArea;
    const w = new BrowserWindow({
      width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, fullscreenable: false,
      ...(this.mac ? { vibrancy: undefined, type: 'panel' } : { type: 'toolbar' }),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false }
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    const entry = { w, item, timer: null };
    this.list.push(entry);
    w.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();
      if (url.startsWith('nyao-popup://')) {
        this.close(entry);
        this.onOpen(item.payload || {});
      }
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(popupHtml({ ...item, accent: this.getAccent(), mac: this.mac })));
    w.once('ready-to-show', () => w.showInactive());
    entry.timer = setTimeout(() => this.close(entry), LIFE_MS);
    // наводишь мышь — окошко не исчезает
    w.on('closed', () => {
      this.list = this.list.filter((x) => x !== entry);
      this.layout();
    });
    this.layout(area);
  }

  close(entry) {
    clearTimeout(entry.timer);
    if (!entry.w.isDestroyed()) entry.w.close();
    this.list = this.list.filter((x) => x !== entry);
    this.layout();
  }

  /** Стопка снизу справа (на macOS — сверху справа, под строкой меню) */
  layout(area = screen.getPrimaryDisplay().workArea) {
    this.list.forEach((e, i) => {
      if (e.w.isDestroyed()) return;
      const x = area.x + area.width - W - GAP;
      const y = this.mac ? area.y + GAP + i * (H + 4) : area.y + area.height - GAP - (i + 1) * (H + 4);
      e.w.setBounds({ x, y, width: W, height: H });
    });
  }
}

/** Живое событие «social» → окошко (или null, если показывать нечего) */
export function popupFor(e) {
  const u = e.user || e.from || {};
  const who = u.name || (u.nick ? '@' + u.nick : 'Друг');
  const t = e.track;
  switch (e.kind) {
    case 'friend-request':
      return { title: 'Заявка в друзья', body: `${who} хочет дружить`, picture: u.picture, action: 'Открыть', payload: { route: 'user', key: u.id } };
    case 'friend-accepted':
      return { title: 'Теперь вы друзья', body: `${who} в друзьях`, picture: u.picture, payload: { route: 'user', key: u.id } };
    case 'track':
      return { title: `${who} прислал трек${e.emoji ? ' ' + e.emoji : ''}`, body: t ? `${t.artist} — ${t.title}` : '', cover: t && t.cover, picture: u.picture, action: 'Слушать', payload: { play: t, from: who } };
    case 'room':
      return { title: `${who} зовёт слушать вместе`, body: 'Нажми, чтобы войти в комнату', picture: u.picture, action: 'Войти', payload: { room: e.code } };
    case 'react':
      return { title: `${who}: ${e.emoji || ''}`, body: t ? `на «${t.title}»` : 'на то, что ты слушаешь', picture: u.picture, payload: { route: 'user', key: u.id } };
    default:
      return null;
  }
}
