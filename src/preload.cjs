// Мост между окном и главным процессом: окно видит только эти функции.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

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
    onState: (cb) => ipcRenderer.on('win:state', (_e, s) => cb(s)),
    fullscreen: (on) => call('win:fullscreen', on),
    onFullscreen: (cb) => ipcRenderer.on('win:fullscreen', (_e, on) => cb(on))
  },
  coverColor: (url) => call('cover:color', url),
  trackDetails: (track) => call('track:details', track),
  onControl: (cb) => ipcRenderer.on('control', (_e, cmd) => cb(cmd)),
  radio: {
    start: (track) => call('radio:start', track),
    more: (ids) => call('radio:more', ids),
    feedback: (type, track, played) => call('radio:feedback', type, track, played)
  },
  lastfm: {
    status: () => call('lastfm:status'),
    connect: () => call('lastfm:connect'),
    cancel: () => call('lastfm:cancel'),
    disconnect: () => call('lastfm:disconnect')
  },
  status: {
    get: (force) => call('status:get', force),
    onChange: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
  },
  openExternal: (url) => call('open:external', url),
  vkLog: () => call('vk:openLog'),
  // ссылки nyao:// и music.withnyao.app/share/…: приглашение, комната, профиль, трек
  deepLinks: {
    take: () => call('deeplink:take'),
    on: (fn) => on('deeplink', fn)
  },
  // Spotify: вход со своим Client ID, плеер — Web Playback SDK в скрытом окне главного процесса
  spotify: {
    status: () => call('spotify:status'),
    setClientId: (id) => call('spotify:setClientId', id),
    login: () => call('spotify:login'),
    logout: () => call('spotify:logout'),
    prewarm: () => call('spotify:prewarm'),
    play: (uris, positionMs) => call('spotify:play', uris, positionMs),
    pause: () => call('spotify:pause'),
    resume: () => call('spotify:resume'),
    seek: (ms) => call('spotify:seek', ms),
    next: () => call('spotify:next'),
    volume: (v) => call('spotify:volume', v),
    modes: () => call('spotify:modes'),
    snapshot: () => call('spotify:snapshot'),
    debug: () => call('spotify:debug'),
    onState: (fn) => on('spotify:state', fn),
    // трек Spotify играет копией из другого сервиса (нет Premium): { id, track }
    onSubstitute: (fn) => on('stream:substitute', fn)
  },
  ytLog: () => call('yt:openLog'),
  version: () => call('app:version'),
  onOutdated: (cb) => ipcRenderer.on('app:outdated', (_e, min) => cb(min)),
  updates: {
    check: () => call('update:check'),
    download: (asset) => call('update:download', asset),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p))
  },
  theme: {
    set: (v) => call('theme:set', v)
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
  releases: (force) => call('home:releases', !!force),
  connect: {
    devices: () => call('connect:devices'),
    cmd: (deviceId, cmd, args) => call('connect:cmd', deviceId, cmd, args)
  },
  room: {
    current: () => call('room:current'),
    create: () => call('room:create'),
    join: (code) => call('room:join', code),
    leave: (code) => call('room:leave', code),
    state: (code, st) => call('room:state', code, st),
    react: (code, emoji) => call('room:react', code, emoji)
  },
  stats: (period, year) => call('stats', period, year),
  matchPlayable: (track) => call('match:playable', track),
  transfer: {
    targets: () => call('transfer:targets'),
    start: (job) => call('transfer:start', job),
    onProgress: (fn) => on('transfer:progress', fn)
  },
  onLive: (fn) => on('live:event', fn),
  social: (method, path, body) => call('social:api', method, path, body),
  artists: { list: () => call('artists:list'), like: (a, on) => call('artists:like', a, on) },
  onSocialOpen: (fn) => on('social:open', fn),
  library: {
    playlists: () => call('library:playlists'),
    liked: () => call('library:liked'),
    tracks: (id) => call('library:tracks', id)
  },
  mix: {
    create: (title) => call('mix:create', title),
    add: (mixId, track) => call('mix:add', mixId, track),
    addMany: (mixId, tracks) => call('mix:addMany', mixId, tracks),
    remove: (mixId, trackId) => call('mix:remove', mixId, trackId),
    delete: (mixId) => call('mix:delete', mixId)
  },
  search: (q) => call('search', q),
  catalog: {
    artist: (ref) => call('catalog:artist', ref),
    album: (ref) => call('catalog:album', ref),
    artistTracks: (refs) => call('catalog:artistTracks', refs)
  },
  wave: {
    start: () => call('wave:start'),
    more: (ids) => call('wave:more', ids),
    feedback: (type, track, played) => call('wave:feedback', type, track, played)
  },
  prepare: (id) => call('stream:prepare', id),
  loudness: (id) => call('stream:loudness', id),
  streamError: (id) => call('stream:error', id),
  lyrics: (track) => call('lyrics', track),
  like: (track, on) => call('like', track, on),
  sc: {
    pending: () => call('sc:pending'),
    flush: () => call('sc:flush'),
    onSent: (cb) => ipcRenderer.on('sc:pending', (_e, r) => cb(r))
  },
  cloud: {
    status: () => call('cloud:status'),
    login: () => call('cloud:login'),
    cancel: () => call('cloud:cancel'),
    logout: () => call('cloud:logout'),
    me: () => call('cloud:me'),
    removeDevice: (id) => call('cloud:removeDevice', id),
    play: (p) => call('cloud:play', p),
    now: (info) => call('cloud:now', info),
    others: () => call('cloud:others'),
    history: () => call('cloud:history'),
    top: (opts) => call('cloud:top', opts),
    sync: () => call('cloud:sync'),
    onChanged: (cb) => ipcRenderer.on('cloud:changed', (_e, keys) => cb(keys))
  },
  rpc: {
    update: (info) => call('rpc:update', info),
    status: () => call('rpc:status')
  }
});
