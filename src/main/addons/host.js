// Дополнения: запуск в песочнице и выдача прав. Работает в главном процессе.
//
// Каждое дополнение — своё невидимое окно: sandbox, без Node, своя память (partition в памяти, без куки приложения),
// страница грузится по схеме nyao-addon:// и по строгой политике содержимого не может сходить в сеть сама.
// Наружу у дополнения один путь — мост из addon-preload.cjs: он шлёт сюда «вызов», а здесь проверяется право.
// Чего нет в API, того дополнение не может: входы в сервисы, куки и ключи сюда не попадают вовсе.
import { BrowserWindow, ipcMain, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, missingGrants, netAllowed, settingValues, rateLimiter, describePermission, API_VERSION } from './manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ADDON_SCHEME = 'nyao-addon';
const CSP = "default-src 'none'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css; charset=utf-8' };
// выполняется раньше кода дополнения: убирает из окна всё, чем можно выйти в сеть мимо моста (вдобавок к политике содержимого и запрету запросов)
const BOOT = `for (const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','WebSocket','EventSource','XMLHttpRequest','fetch','WebTransport','Worker','SharedWorker','open']) { try { Object.defineProperty(window, k, { value: undefined, configurable: false, writable: false }); } catch {} }
try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false }); Object.defineProperty(navigator, 'serviceWorker', { value: undefined }); } catch {}`;
const STORAGE_LIMIT = 256 * 1024;

/** Трек в том виде, в каком его видят дополнения: без внутренних полей */
export function publicTrack(t) {
  if (!t || typeof t !== 'object') return null;
  return { id: String(t.id || ''), title: String(t.title || ''), artist: String(t.artist || ''), album: String(t.album || ''), source: String(t.source || ''), duration: Number(t.duration) || 0, url: typeof t.url === 'string' && /^https?:/.test(t.url) ? t.url : '', cover: typeof t.cover === 'string' && /^https?:/.test(t.cover) ? t.cover : '' };
}
export function publicState(st) {
  const s = st || {};
  return { playing: !!s.playing, position: Number(s.position) || 0, duration: Number(s.duration) || 0, live: !!s.live, liked: !!s.liked, volume: Number(s.volume) || 0, shuffle: !!s.shuffle, repeat: s.repeat || 'off', mode: String(s.mode || ''), track: publicTrack(s.track), next: (Array.isArray(s.next) ? s.next : []).slice(0, 5).map(publicTrack).filter(Boolean), at: Date.now() };
}

export class AddonHost {
  /**
   * @param {object} o
   * @param {string} o.builtinDir  папка встроенных дополнений (src/addons)
   * @param {string|null} o.devDir папка для разработки — только в Nyao Music Red, иначе null
   * @param {string} o.dataDir     куда складывать хранилища дополнений
   * @param {{get:Function,set:Function}} o.settings
   * @param {import('./pages.js').AddonPages} o.pages
   * @param {(cmd:string, value?:any)=>void} o.command  команда плееру
   * @param {(track:object)=>Promise<object|null>} o.lyrics
   * @param {()=>object[]} o.history
   * @param {(payload:object)=>void} o.toast
   * @param {()=>void} o.changed   список или состояние дополнений поменялись — окну пора перерисовать
   * @param {Record<string, {status?:Function, onToggle?:Function}>} o.natives  встроенные части приложения, оформленные как дополнения (Last.fm)
   */
  constructor(o) {
    Object.assign(this, { natives: {}, log: () => {} }, o);
    this.addons = new Map(); // id → запись
    this.sessions = new Set(); // чьи сессии уже настроены
    this.state = publicState(null);
    ipcMain.handle('addon:call', (e, method, args) => this.call(e.sender, String(method || ''), Array.isArray(args) ? args : []));
  }

  conf(id) {
    return ((this.settings.get() || {}).addons || {})[id] || {};
  }
  setConf(id, patch) {
    const all = { ...((this.settings.get() || {}).addons || {}) };
    all[id] = { ...(all[id] || {}), ...patch };
    this.settings.set({ addons: all });
  }

  /** Перечитать папки. Встроенные идут первыми и их id нельзя занять из папки разработки */
  async scan() {
    const found = new Map();
    const read = (root, source) => {
      let names = [];
      try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
      for (const name of names.sort()) {
        const dir = path.join(root, name);
        let v;
        try { v = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))); } catch { v = { ok: false, error: 'manifest.json не найден или в нём ошибка JSON' }; }
        if (v.ok && source !== 'builtin' && (v.manifest.id.startsWith('nyao.') || v.manifest.native)) v = { ok: false, error: 'id «nyao.…» и native — только для встроенных дополнений' };
        if (v.ok && found.has(v.manifest.id)) v = { ok: false, error: `id «${v.manifest.id}» уже занят` };
        const id = v.ok ? v.manifest.id : `!${source}/${name}`;
        found.set(id, { id, dir, source, folder: name, manifest: v.ok ? v.manifest : null, error: v.ok ? '' : v.error });
      }
    };
    read(this.builtinDir, 'builtin');
    if (this.devDir) read(this.devDir, 'dev');
    for (const [id, a] of this.addons) if (!found.has(id) || found.get(id).dir !== a.dir) this.stop(id);
    const next = new Map();
    for (const [id, f] of found) {
      const old = this.addons.get(id);
      next.set(id, { status: 'off', logs: [], menu: [], crashes: [], win: null, ...(old && old.dir === f.dir ? { status: old.status, logs: old.logs, menu: old.menu, crashes: old.crashes, win: old.win } : {}), ...f });
    }
    this.addons = next;
    for (const a of this.addons.values()) if (a.manifest && this.enabled(a) && !a.win) await this.start(a.id).catch((e) => this.note(a, `не запустилось: ${e.message}`));
    this.changed();
  }

  enabled(a) {
    const c = this.conf(a.id);
    return typeof c.enabled === 'boolean' ? c.enabled : a.source === 'builtin' && !!a.manifest.native; // встроенные «родные» части (Last.fm) работали и раньше — остаются включёнными
  }
  grants(a) {
    return a.source === 'builtin' ? a.manifest.permissions : (this.conf(a.id).grants || []).filter((p) => a.manifest.permissions.includes(p));
  }
  values(a) {
    return settingValues(a.manifest, this.conf(a.id).values);
  }

  note(a, text) {
    a.logs.push({ at: Date.now(), text: String(text).slice(0, 500) });
    if (a.logs.length > 200) a.logs.splice(0, a.logs.length - 200);
    this.log(`[дополнение ${a.id}] ${text}`);
  }

  /** Список для окна настроек */
  list() {
    return [...this.addons.values()].map((a) => {
      if (!a.manifest) return { id: a.id, name: a.folder, source: a.source, error: a.error, status: 'error', enabled: false, permissions: [], settings: [], values: {}, menu: [] };
      const m = a.manifest;
      const native = m.native && this.natives[m.native];
      const need = missingGrants(m.permissions, this.grants(a));
      return {
        id: a.id, name: m.name, version: m.version, author: m.author, description: m.description, icon: m.icon, color: m.color, source: a.source, native: m.native || '',
        enabled: this.enabled(a), status: a.status, needs: need,
        permissions: m.permissions.map(describePermission), settings: m.settings, values: this.values(a),
        menu: a.status === 'running' ? a.menu : [], pageUrl: a.status === 'running' && m.page ? this.pages.url(a.id) : '',
        nativeStatus: native && native.status ? native.status() : null, lastLog: a.logs.length ? a.logs[a.logs.length - 1] : null,
      };
    });
  }
  logs(id) {
    const a = this.addons.get(id);
    return a ? a.logs.slice(-200) : [];
  }

  /** Включить или выключить. grant: человек подтвердил список прав (для сторонних обязательно) */
  async toggle(id, on, { grant = false } = {}) {
    const a = this.addons.get(id);
    if (!a || !a.manifest) throw new Error('Дополнение не найдено');
    if (on && a.source !== 'builtin') {
      if (grant) this.setConf(id, { grants: [...a.manifest.permissions] });
      if (missingGrants(a.manifest.permissions, this.grants(a)).length) throw new Error('Сначала нужно разрешить доступ');
    }
    this.setConf(id, { enabled: !!on });
    a.crashes = [];
    if (on) await this.start(id); else this.stop(id);
    const native = a.manifest.native && this.natives[a.manifest.native];
    if (native && native.onToggle) native.onToggle(!!on);
    this.changed();
  }

  setValue(id, key, value) {
    const a = this.addons.get(id);
    if (!a || !a.manifest) throw new Error('Дополнение не найдено');
    const values = settingValues(a.manifest, { ...this.values(a), [key]: value });
    this.setConf(id, { values });
    this.emit(a, 'settings', values);
    this.changed();
    return values;
  }

  /** Работает ли «родное» дополнение (Last.fm) и что у него в настройках */
  native(name) {
    const a = [...this.addons.values()].find((x) => x.manifest && x.manifest.native === name);
    return a ? { enabled: this.enabled(a), values: this.values(a) } : { enabled: true, values: {} };
  }

  session(a) {
    const ses = session.fromPartition(`addon:${a.id}`); // без persist: — всё в памяти и отдельно от приложения
    if (this.sessions.has(a.id)) return ses;
    this.sessions.add(a.id);
    ses.protocol.handle(ADDON_SCHEME, (req) => this.serve(req));
    ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(`${ADDON_SCHEME}://`) && !d.url.startsWith('devtools://') }));
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setProxy({ proxyRules: 'http://127.0.0.1:9' }).catch(() => {}); // даже если запрос проскочит — уйдёт в никуда
    return ses;
  }

  serve(req) {
    const u = new URL(req.url);
    const a = this.addons.get(u.hostname);
    const reply = (body, type, status = 200) => new Response(body, { status, headers: { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    if (!a || !a.manifest) return reply('нет', 'text/plain', 404);
    if (u.pathname === '/__host.html') return reply(`<!doctype html><meta charset="utf-8"><script src="/__boot.js"></script><script src="/${a.manifest.main}"></script>`, 'text/html; charset=utf-8');
    if (u.pathname === '/__boot.js') return reply(BOOT, TYPES['.js']);
    let rel;
    try { rel = decodeURIComponent(u.pathname.slice(1)); } catch { return reply('нет', 'text/plain', 400); }
    const file = path.resolve(a.dir, rel);
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type || !file.startsWith(path.resolve(a.dir) + path.sep)) return reply('нет', 'text/plain', 404);
    try { return reply(fs.readFileSync(file), type); } catch { return reply('нет', 'text/plain', 404); }
  }

  async start(id) {
    const a = this.addons.get(id);
    if (!a || !a.manifest) return;
    if (a.manifest.native) { a.status = 'running'; return; }
    if (missingGrants(a.manifest.permissions, this.grants(a)).length) { a.status = 'needs-grant'; return; }
    this.stop(id, true);
    a.menu = [];
    a.limits = { toast: rateLimiter(5, 60_000), net: rateLimiter(60, 60_000) };
    if (a.manifest.page && this.grants(a).includes('page')) await this.pages.mount(a.id, path.join(a.dir, a.manifest.page));
    const win = new BrowserWindow({
      show: false, width: 400, height: 300, skipTaskbar: true, focusable: false, paintWhenInitiallyHidden: false,
      webPreferences: { preload: path.join(HERE, 'addon-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, session: this.session(a), backgroundThrottling: false, spellcheck: false, additionalArguments: [`--nyao-addon=${a.id}@${a.manifest.version}`] },
    });
    a.win = win;
    a.status = 'running';
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    // в новых Electron сообщение лежит в самом событии, в старых — отдельными аргументами
    wc.on('console-message', (e, level, message) => {
      const lvl = e && e.level !== undefined ? e.level : level;
      this.note(a, `${lvl === 'error' || lvl >= 3 ? 'ошибка: ' : ''}${(e && e.message) || message || ''}`);
    });
    wc.on('unresponsive', () => { a.status = 'slow'; this.note(a, 'не отвечает'); this.changed(); });
    wc.on('responsive', () => { if (a.win === win) { a.status = 'running'; this.changed(); } });
    wc.on('render-process-gone', (_e, d) => {
      if (a.win !== win) return;
      const now = Date.now();
      a.crashes = a.crashes.filter((t) => now - t < 60_000).concat(now);
      this.note(a, `упало (${d.reason})`);
      this.stop(id, true);
      if (a.crashes.length >= 3) { a.status = 'crashed'; this.note(a, 'упало трижды за минуту — остановлено'); this.changed(); }
      else setTimeout(() => { if (this.addons.get(id) === a && this.enabled(a) && !a.win) this.start(id).then(() => this.changed()).catch(() => {}); }, 1500);
    });
    await win.loadURL(`${ADDON_SCHEME}://${a.id}/__host.html`);
    this.note(a, `запущено, версия ${a.manifest.version}`);
  }

  stop(id, keepStatus = false) {
    const a = this.addons.get(id);
    if (!a) return;
    const win = a.win;
    a.win = null;
    a.menu = [];
    if (!keepStatus) a.status = 'off';
    this.pages.unmount(id);
    if (win && !win.isDestroyed()) win.destroy();
  }

  stopAll() {
    for (const id of this.addons.keys()) this.stop(id);
  }

  emit(a, name, payload) {
    if (a.win && !a.win.isDestroyed()) a.win.webContents.send('addon:event', name, payload);
  }

  /** Плеер сообщил новое состояние: раздаём тем, у кого есть право «track» */
  setState(raw) {
    const prev = this.state;
    const st = (this.state = publicState(raw));
    const trackChanged = (prev.track && prev.track.id) !== (st.track && st.track.id);
    for (const a of this.addons.values()) {
      if (!a.win || !this.grants(a).includes('track')) continue;
      if (trackChanged) this.emit(a, 'track', st.track);
      this.emit(a, 'state', st);
    }
  }

  /** Человек выбрал пункт дополнения в меню трека */
  menuClick(id, itemId, track) {
    const a = this.addons.get(id);
    if (a && a.menu.some((m) => m.id === itemId)) this.emit(a, 'menu', { id: itemId, track: publicTrack(track) });
  }

  storageFile(a) {
    return path.join(this.dataDir, `${a.id}.json`);
  }
  storage(a) {
    try { return JSON.parse(fs.readFileSync(this.storageFile(a), 'utf8')) || {}; } catch { return {}; }
  }

  /** Вызов из дополнения. Кто зовёт — определяем по окну-отправителю, а не по словам дополнения */
  async call(sender, method, args) {
    const a = [...this.addons.values()].find((x) => x.win && !x.win.isDestroyed() && x.win.webContents === sender);
    if (!a) return { ok: false, error: 'нет такого дополнения' };
    try {
      return { ok: true, data: await this.dispatch(a, method, args) };
    } catch (e) {
      this.note(a, `${method}: ${e.message}`);
      return { ok: false, error: String(e.message || e) };
    }
  }

  async dispatch(a, method, args) {
    const grants = this.grants(a);
    const need = (p) => { if (!grants.includes(p)) throw new Error(`нет права «${p}» — добавь его в permissions`); };
    switch (method) {
      case 'info': return { id: a.id, version: a.manifest.version, api: API_VERSION, permissions: grants };
      case 'player.get': need('track'); return this.state;
      case 'player.cmd': {
        need('control');
        const [cmd, value] = args;
        if (!['play', 'pause', 'toggle', 'next', 'prev', 'like'].includes(cmd) && !(['seek', 'volume'].includes(cmd) && Number.isFinite(value))) throw new Error('неизвестная команда');
        this.command(cmd, cmd === 'volume' ? Math.min(1, Math.max(0, value)) : cmd === 'seek' ? Math.max(0, value) : undefined);
        return true;
      }
      case 'lyrics.get': {
        need('lyrics');
        if (!this.state.track) return null;
        const r = await this.lyrics(this.state.track);
        if (!r || !Array.isArray(r.lines) || !r.lines.length) return null;
        return { synced: !!r.synced, lines: r.lines.map((l) => ({ time: Number.isFinite(l.time) ? l.time : null, text: String(l.text || '') })) };
      }
      case 'history.recent': {
        need('history');
        const n = Math.min(200, Math.max(1, Number(args[0]) || 50));
        return (this.history() || []).slice(0, n).map((h) => ({ track: publicTrack({ ...h, id: h.trackId }), at: Number(h.playedAt) || 0, listened: Number(h.listened) || 0 }));
      }
      case 'ui.toast': {
        need('ui.toast');
        if (!a.limits.toast()) throw new Error('слишком часто: не больше 5 уведомлений в минуту');
        this.toast({ id: a.id, name: a.manifest.name, text: String(args[0] || '').slice(0, 140) });
        return true;
      }
      case 'ui.trackMenu': {
        need('ui.trackMenu');
        const items = (Array.isArray(args[0]) ? args[0] : []).slice(0, 3).map((m) => ({ id: String(m.id || '').slice(0, 40), title: String(m.title || '').slice(0, 40) })).filter((m) => m.id && m.title);
        a.menu = items;
        this.changed();
        return true;
      }
      case 'page.publish': need('page'); return this.pages.publish(a.id, args[0]);
      case 'page.url': need('page'); return this.pages.url(a.id);
      case 'settings.get': return this.values(a);
      case 'storage.get': return this.storage(a)[String(args[0])] ?? null;
      case 'storage.set': {
        const data = this.storage(a);
        if (args[1] === null || args[1] === undefined) delete data[String(args[0])]; else data[String(args[0]).slice(0, 80)] = args[1];
        const json = JSON.stringify(data);
        if (json.length > STORAGE_LIMIT) throw new Error('хранилище дополнения переполнено (предел 256 КБ)');
        fs.mkdirSync(this.dataDir, { recursive: true });
        fs.writeFileSync(this.storageFile(a), json);
        return true;
      }
      case 'net.fetch': {
        const [url, opts = {}] = args;
        if (!netAllowed(grants, url)) throw new Error(`нет права на этот адрес — нужен «net:${(() => { try { return new URL(url).hostname; } catch { return '…'; } })()}» и https`);
        if (!a.limits.net()) throw new Error('слишком часто: не больше 60 запросов в минуту');
        const method2 = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(opts.method || 'GET').toUpperCase()) ? String(opts.method || 'GET').toUpperCase() : 'GET';
        const body = method2 === 'GET' || opts.body == null ? undefined : String(opts.body);
        if (body && body.length > 256 * 1024) throw new Error('тело запроса больше 256 КБ');
        const headers = {};
        for (const [k, v] of Object.entries(opts.headers || {})) if (!/^(cookie|host|origin|referer|user-agent)$/i.test(k)) headers[k] = String(v);
        headers['user-agent'] = `NyaoMusic-addon/${a.id}`;
        // чистая сессия: без куки приложения и сервисов; переадресации запрещены, чтобы не увели на другой домен
        const res = await session.fromPartition(`addon-net:${a.id}`).fetch(String(url), { method: method2, headers, body, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000) });
        const text = (await res.text()).slice(0, 1024 * 1024);
        return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), text };
      }
      case 'log': this.note(a, args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); return true;
      default: throw new Error(`в API нет «${method}»`);
    }
  }
}
