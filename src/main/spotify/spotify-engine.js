import { safeDiagnostic } from '../diagnostics.js';
// Устройство Spotify Connect внутри Nyao на ПК: официальный Web Playback SDK в скрытом окне.
// Звук играет сам SDK через Widevine (Electron от castlabs), поэтому прослушивания засчитываются в Spotify.
// Тот же движок, что на Android (SpotifyEngine.kt), только окно вместо WebView.
import { BrowserWindow, ipcMain, session, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Как на телефоне (https://appassets.androidplatform.net): страница плеера открыта с обычного https-адреса.
// Адрес на нашем домене, но в сеть не уходит — его отдаёт само приложение в отдельной сессии окна плеера.
export const PLAYER_HOST = 'spotify-player.nmusic.bixtl.cc';
export const PLAYER_URL = `https://${PLAYER_HOST}/player.html`;
export const PLAYER_FILE = path.join(__dirname, 'player.html');
const PARTITION = 'persist:nyao-spotify';
const ALLOWED_HOSTS = new Set([PLAYER_HOST, 'sdk.scdn.co']);

export class SpotifyEngine {
  /** sp — SpotifyProvider; widevine — промис готовности Widevine; onChange — состояние для интерфейса */
  constructor({ sp, widevine, onChange }) {
    this.sp = sp;
    this.widevine = widevine;
    this.onChange = onChange || (() => {});
    this.win = null;
    this.status = { state: 'idle' };
    this.snapshot = null;
    this.calls = new Map();
    this.seq = 0;
    this.readyWaiters = [];
    this.log = [];
    this.wired = false;
    this.startPromise = null;
    this.generation = 0;
  }

  note(s) {
    this.log.push(`${new Date().toTimeString().slice(0, 8)} ${safeDiagnostic(s).slice(0, 400)}`);
    if (this.log.length > 80) this.log.shift();
  }
  debugText() {
    return this.log.join('\n');
  }

  setStatus(s) {
    this.status = s;
    if (s.state === 'ready' || s.state === 'failed') {
      const waiters = this.readyWaiters.splice(0);
      for (const w of waiters) w(s);
    }
    this.onChange({ status: this.status, snapshot: this.snapshot });
  }

  wire() {
    if (this.wired) return;
    this.wired = true;
    const own = (e) => this.win && !this.win.isDestroyed() && e.sender === this.win.webContents;
    ipcMain.on('sp:event', (e, type, payload) => {
      if (!own(e)) return;
      let p = null;
      try {
        p = payload === 'null' ? null : JSON.parse(payload);
      } catch {
        p = null;
      }
      this.handleEvent(type, p);
    });
    ipcMain.on('sp:token', async (e, id) => {
      if (!own(e)) return;
      let token = '';
      try {
        token = await this.sp.accessToken();
      } catch (err) {
        this.fail('auth', err.message || 'Нужно войти в Spotify');
      }
      this.exec(`window.__engine.resolveToken(${Number(id)}, ${JSON.stringify(token)})`);
    });
    ipcMain.on('sp:result', (e, id, ok, payload) => {
      if (!own(e)) return;
      const c = this.calls.get(id);
      if (!c) return;
      this.calls.delete(id);
      clearTimeout(c.timer);
      ok ? c.resolve(payload) : c.reject(new Error(payload));
    });
    // Widevine (EME) разрешаем только окну плеера Spotify и фрейму официального SDK
    const ses = session.fromPartition(PARTITION);
    // своя страница плеера — из приложения, всё остальное — в сеть как обычно
    ses.protocol.handle('https', (req) => {
      let host = '';
      try {
        host = new URL(req.url).host;
      } catch {
        host = '';
      }
      if (host === PLAYER_HOST) return new Response(fs.readFileSync(PLAYER_FILE), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    });
    // журнал: лицензия и ошибки сети плеера Spotify (только адрес без параметров и код ответа)
    const mine = (d) => this.win && !this.win.isDestroyed() && d.webContentsId === this.win.webContents.id;
    const short = (u) => {
      try {
        const x = new URL(u);
        return x.host + x.pathname.slice(0, 60);
      } catch {
        return '?';
      }
    };
    ses.webRequest.onCompleted({ urls: ['https://*/*'] }, (d) => {
      if (mine(d) && (d.statusCode >= 400 || /licen|widevine|playready/i.test(d.url))) this.note(`сеть: ${d.method} ${short(d.url)} → ${d.statusCode}`);
    });
    ses.webRequest.onErrorOccurred({ urls: ['https://*/*'] }, (d) => {
      if (mine(d)) this.note(`сеть: ${d.method} ${short(d.url)} → ${d.error}`);
    });
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      if (permission === 'mediaKeySystem') {
        let host = '';
        try {
          host = new URL(details.requestingUrl || '').host;
        } catch {
          host = '';
        }
        const ok = !!this.win && !this.win.isDestroyed() && wc === this.win.webContents && ALLOWED_HOSTS.has(host);
        this.note(`разрешение mediaKeySystem от ${host || '?'}: ${ok ? 'дано' : 'нет'}`);
        return cb(ok);
      }
      return cb(true);
    });
  }

  get started() {
    return !!this.win && !this.win.isDestroyed();
  }

  start() {
    if (this.started) return Promise.resolve();
    if (!this.startPromise) {
      const running = this.open().finally(() => { if (this.startPromise === running) this.startPromise = null; });
      this.startPromise = running;
    }
    return this.startPromise;
  }

  async open() {
    const generation = this.generation;
    this.wire();
    this.setStatus({ state: 'loading' });
    const wv = await this.widevine;
    if (generation !== this.generation) return;
    this.note(`Widevine: ${wv.ok ? 'готов ' + JSON.stringify(wv.status || {}) : 'нет — ' + wv.reason}`);
    if (!wv.ok) {
      this.fail('init', `Widevine не готов: ${wv.reason}`);
      return;
    }
    this.win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: {
        preload: path.join(__dirname, 'spotify-preload.cjs'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    // Spotify пускает только поддерживаемые браузеры: окно плеера представляется обычным Chrome той же версии
    // (без «NyaoMusic/…» и «Electron/…»). Widevine и подпись VMP — настоящие.
    const ua = chromeUserAgent(this.win.webContents.getUserAgent());
    this.win.webContents.setUserAgent(ua);
    this.note(`браузер для Spotify: ${ua}`);
    this.win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) this.note(`console: ${message}`);
    });
    this.win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (isMain) this.fail('engine', `Страница плеера не загрузилась: ${desc}`);
    });
    this.win.on('closed', () => {
      this.win = null;
    });
    this.win.loadURL(PLAYER_URL);
  }

  release() {
    this.generation++;
    this.startPromise = null;
    for (const waiter of this.readyWaiters.splice(0)) waiter({ state: 'failed', message: 'Плеер Spotify остановлен' });
    if (this.started) {
      this.exec("window.__engine && window.__engine.call(0, 'disconnect', '[]')");
      this.win.destroy();
    }
    this.win = null;
    for (const c of this.calls.values()) { clearTimeout(c.timer); c.reject(new Error('Плеер Spotify остановлен')); }
    this.calls.clear();
    this.snapshot = null;
    this.setStatus({ state: 'idle' });
  }

  exec(js) {
    if (this.started) this.win.webContents.executeJavaScript(js).catch(() => {});
  }

  /** Ждёт ready и возвращает device_id; запускает движок, если нужно */
  async awaitReady(timeoutMs = 30_000) {
    if (this.status.state === 'failed') this.release();
    if (this.status.state === 'ready') return this.status.deviceId;
    let timer, waiter;
    const waiting = new Promise(resolve => {
      waiter = resolve;
      this.readyWaiters.push(waiter);
      timer = setTimeout(() => resolve({ state: 'failed', message: 'Плеер Spotify не ответил — попробуй ещё раз' }), timeoutMs);
    });
    this.start().catch(() => waiter({ state: 'failed', message: 'Не удалось запустить плеер Spotify' }));
    try {
      const state = await waiting;
      if (state.state !== 'ready') throw new Error(state.message || 'Плеер Spotify не готов');
      return state.deviceId;
    } finally {
      clearTimeout(timer);
      this.readyWaiters = this.readyWaiters.filter(w => w !== waiter);
    }
  }

  call(method, ...args) {
    if (!this.started) return Promise.reject(new Error('Плеер Spotify не запущен'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`Spotify: ${method} не ответил`));
      }, 15_000);
      this.calls.set(id, { resolve, reject, timer });
      this.exec(`window.__engine.call(${id}, ${JSON.stringify(method)}, ${JSON.stringify(JSON.stringify(args))})`);
    });
  }

  pause() { return this.call('pause'); }
  resume() { return this.call('resume'); }
  seek(ms) { return this.call('seek', Math.max(0, Math.round(ms))); }
  nextTrack() { return this.call('nextTrack'); }
  setVolume(v) { return this.call('setVolume', Math.min(1, Math.max(0, v))); }

  async playUris(uris, positionMs = 0) {
    const dev = await this.awaitReady();
    await this.sp.playUris(dev, uris, positionMs);
  }

  async ensureModes() {
    const dev = await this.awaitReady();
    await this.sp.setShuffle(dev, false).catch(() => {});
    await this.sp.setRepeat(dev, 'off').catch(() => {});
  }

  fail(kind, message) {
    this.note(`ошибка ${kind}: ${message}`);
    this.setStatus({ state: 'failed', kind, message });
    this.onChange({ error: { kind, message }, status: this.status, snapshot: this.snapshot });
  }

  handleEvent(type, p) {
    const message = (p && p.message) || '';
    if (type !== 'player_state_changed') this.note(`событие ${type}${message ? ': ' + message : ''}`);
    switch (type) {
      case 'eme':
        this.note(`EME: ${p && p.keySystem} → ${p && p.result}${p && p.robustness ? ' · robustness ' + p.robustness : ''}`);
        break;
      case 'diag':
        this.note(`браузер: ${p && p.ua} · secure=${p && p.secure} · EME=${p && p.eme} · Widevine=${p && p.widevine} · SW_SECURE_CRYPTO=${p && p.widevineSw}`);
        break;
      case 'sdk_ready':
        this.setStatus({ state: 'connecting' });
        this.exec(`window.__engine.init(${JSON.stringify('Nyao Music (ПК)')}, 1.0)`);
        break;
      case 'connect_result':
        if (!p || !p.ok) this.fail('engine', 'Плеер Spotify не подключился');
        break;
      case 'ready':
        this.setStatus({ state: 'ready', deviceId: p.device_id });
        break;
      case 'not_ready':
        this.setStatus({ state: 'not_ready', deviceId: p.device_id });
        break;
      case 'player_state_changed':
        this.snapshot = p ? { uri: p.uri, linked: p.linked, paused: !!p.paused, position: p.position || 0, duration: p.duration || 0, at: Date.now() } : null;
        this.onChange({ status: this.status, snapshot: this.snapshot });
        break;
      case 'autoplay_failed':
        this.onChange({ error: { kind: 'autoplay', message: 'Звук не стартовал сам — нажми «играть»' } });
        break;
      case 'initialization_error':
        this.fail('init', `Spotify не запустил плеер: ${message}`);
        break;
      case 'authentication_error':
        this.fail('auth', `Spotify не принял вход — войди заново (${message})`);
        break;
      case 'account_error':
        this.fail('account', 'Для плеера Spotify нужен Premium');
        break;
      case 'playback_error':
        this.onChange({ error: { kind: 'playback', message: `Spotify не смог включить трек (${message})` } });
        break;
      default:
        break;
    }
  }
}

/** «… NyaoMusic/0.8 Chrome/152 Electron/44 Safari/537.36» → «… Chrome/152 Safari/537.36» */
export function chromeUserAgent(ua) {
  return String(ua || '').replace(/\s+NyaoMusic\/\S+/i, '').replace(/\s+Electron\/\S+/i, '').replace(/\s+nyao-music\/\S+/i, '');
}

/** WAV-тишина длиной с трек (8 кГц, моно, 16 бит) — на её месте в <audio> играет трек Spotify */
export function silenceResponse(durationSec, rangeHeader) {
  const rate = 8000;
  const bps = rate * 2;
  const dataLen = Math.max(1, Math.round((durationSec > 0 ? durationSec : 600) * bps / 2)) * 2;
  const total = 44 + dataLen;
  let start = 0;
  let end = total - 1;
  const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  if (m) {
    if (m[1]) start = Math.min(Number(m[1]), total - 1);
    if (m[2]) end = Math.min(Number(m[2]), total - 1);
    else if (!m[1] && m[2]) {
      start = Math.max(0, total - Number(m[2]));
      end = total - 1;
    }
  }
  const len = end - start + 1;
  const buf = Buffer.alloc(len);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + dataLen, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(bps, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(dataLen, 40);
  if (start < 44) h.copy(buf, 0, start, Math.min(44, end + 1));
  const headers = {
    'content-type': 'audio/wav',
    'accept-ranges': 'bytes',
    'content-length': String(len),
    'access-control-allow-origin': '*'
  };
  if (m) headers['content-range'] = `bytes ${start}-${end}/${total}`;
  return new Response(buf, { status: m ? 206 : 200, headers });
}
