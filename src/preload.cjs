// Мост между окном и главным процессом: окно видит только эти функции.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Неизвестная ошибка');
  return res.data;
}

contextBridge.exposeInMainWorld('nyao', {
  platform: process.platform,
  win: {
    minimize: () => call('win:minimize'),
    maximize: () => call('win:maximize'),
    close: () => call('win:close'),
    onState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s))
  },
  openExternal: (url) => call('open:external', url),
  version: () => call('app:version'),
  updates: {
    check: () => call('update:check'),
    download: (asset) => call('update:download', asset),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p))
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch)
  },
  auth: {
    status: () => call('auth:status'),
    login: (service) => call('auth:login', service),
    setManual: (service, value) => call('auth:setManual', service, value),
    logout: (service) => call('auth:logout', service)
  },
  home: () => call('home'),
  library: {
    playlists: () => call('library:playlists'),
    liked: () => call('library:liked'),
    tracks: (id) => call('library:tracks', id)
  },
  mix: {
    create: (title) => call('mix:create', title),
    add: (mixId, track) => call('mix:add', mixId, track),
    remove: (mixId, trackId) => call('mix:remove', mixId, trackId),
    delete: (mixId) => call('mix:delete', mixId)
  },
  search: (q) => call('search', q),
  catalog: {
    artist: (ref) => call('catalog:artist', ref),
    album: (ref) => call('catalog:album', ref)
  },
  wave: {
    start: () => call('wave:start'),
    more: (ids) => call('wave:more', ids),
    feedback: (type, track, played) => call('wave:feedback', type, track, played)
  },
  prepare: (id) => call('stream:prepare', id),
  streamError: (id) => call('stream:error', id),
  lyrics: (track) => call('lyrics', track),
  like: (track, on) => call('like', track, on),
  rpc: {
    update: (info) => call('rpc:update', info),
    status: () => call('rpc:status')
  }
});
