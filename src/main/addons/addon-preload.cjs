// Мост для дополнений: всё, что дополнение видит от Nyao Music, — объект nyao ниже.
// Права проверяет главный процесс (host.js); здесь только удобная обёртка.
const { contextBridge, ipcRenderer } = require('electron');

const tag = (process.argv.find((a) => a.startsWith('--nyao-addon=')) || '').slice(13).split('@');
const listeners = { track: new Set(), state: new Set(), settings: new Set() };
const menu = new Map(); // id пункта → { title, run }

async function call(method, ...args) {
  const res = await ipcRenderer.invoke('addon:call', method, args);
  if (!res || !res.ok) throw new Error((res && res.error) || 'ошибка');
  return res.data;
}
ipcRenderer.on('addon:event', (_e, name, payload) => {
  if (name === 'menu') {
    const item = menu.get(payload && payload.id);
    if (item) try { item.run(payload.track); } catch (e) { console.error(e && e.message); }
    return;
  }
  for (const cb of listeners[name] || []) try { cb(payload); } catch (e) { console.error(e && e.message); }
});
const on = (name) => (cb) => { if (typeof cb === 'function') listeners[name].add(cb); };
const pushMenu = () => call('ui.trackMenu', [...menu].map(([id, m]) => ({ id, title: m.title })));

contextBridge.exposeInMainWorld('nyao', {
  api: 1,
  addon: { id: tag[0] || '', version: tag[1] || '' },
  player: {
    get: () => call('player.get'),
    onTrack: on('track'),
    onState: on('state'),
    play: () => call('player.cmd', 'play'),
    pause: () => call('player.cmd', 'pause'),
    toggle: () => call('player.cmd', 'toggle'),
    next: () => call('player.cmd', 'next'),
    prev: () => call('player.cmd', 'prev'),
    like: () => call('player.cmd', 'like'),
    seek: (seconds) => call('player.cmd', 'seek', Number(seconds)),
    setVolume: (v) => call('player.cmd', 'volume', Number(v)),
  },
  lyrics: { get: () => call('lyrics.get') },
  history: { recent: (n) => call('history.recent', n) },
  ui: {
    toast: (text) => call('ui.toast', String(text)),
    trackMenu: {
      add: (item, run) => { menu.set(String(item.id), { title: String(item.title), run }); return pushMenu(); },
      remove: (id) => { menu.delete(String(id)); return pushMenu(); },
    },
  },
  page: { publish: (data) => call('page.publish', data), url: () => call('page.url') },
  settings: { get: () => call('settings.get'), onChange: on('settings') },
  storage: { get: (key) => call('storage.get', String(key)), set: (key, value) => call('storage.set', String(key), value) },
  net: { fetch: (url, opts) => call('net.fetch', String(url), opts || {}) },
  log: (...a) => call('log', ...a).catch(() => {}),
});
