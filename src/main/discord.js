// Discord Rich Presence без зависимостей: локальный IPC-канал Discord (discord-ipc-N).
// Показываем «Слушает Nyao Music»: обложка, трек, исполнитель, полоска времени и значок сервиса.
import net from 'node:net';
import path from 'node:path';

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function ipcPath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base.replace(/\/$/, ''), `discord-ipc-${i}`);
}

export function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

// Discord принимает внешнюю картинку только как https-URL не длиннее 256 символов
function imageOrKey(url, fallbackKey) {
  if (url && /^https:\/\//.test(url) && url.length <= 256) return url;
  return fallbackKey;
}

export function buildActivity(info) {
  const { track, playing, position = 0, duration = 0 } = info;
  if (!track) return null;
  const isYa = track.source === 'ya';
  const activity = {
    type: 2, // «Слушает»
    details: String(track.title || 'Без названия').slice(0, 128),
    state: String(track.artist || ' ').slice(0, 128).padEnd(2, ' '),
    assets: {
      large_image: imageOrKey(track.cover, 'logo'),
      large_text: String(track.album || (isYa ? 'Яндекс Музыка' : 'YouTube Music')).slice(0, 128).padEnd(2, ' '),
      small_image: isYa ? 'yandex' : 'youtube',
      small_text: isYa ? 'Яндекс Музыка' : 'YouTube Music'
    },
    instance: false
  };
  if (playing && duration > 0) {
    const start = Date.now() - Math.round(position * 1000);
    activity.timestamps = { start, end: start + Math.round(duration * 1000) };
  } else if (!playing) {
    activity.assets.small_image = 'pause';
    activity.assets.small_text = 'На паузе';
  }
  const link = isYa
    ? track.albumId ? `https://music.yandex.ru/album/${track.albumId}/track/${track.srcId}` : `https://music.yandex.ru/track/${track.srcId}`
    : `https://music.youtube.com/watch?v=${track.srcId}`;
  activity.buttons = [{ label: isYa ? 'Открыть в Яндекс Музыке' : 'Открыть в YouTube Music', url: link }];
  return activity;
}

export class DiscordRPC {
  constructor({ clientId, log = () => {} } = {}) {
    this.clientId = clientId;
    this.log = log;
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    this.pending = null; // последняя активность, отправим после подключения
    this.retryTimer = null;
    this.enabled = false;
    this.nonce = 0;
  }

  get status() {
    if (!this.enabled) return 'off';
    if (!this.clientId) return 'no-id';
    return this.ready ? 'connected' : 'connecting';
  }

  configure({ enabled, clientId }) {
    const changed = clientId !== this.clientId || enabled !== this.enabled;
    this.clientId = clientId;
    this.enabled = !!enabled;
    if (!changed) return;
    this.disconnect();
    if (this.enabled && this.clientId) this.connect();
  }

  async connect(i = 0) {
    if (!this.enabled || !this.clientId || this.socket) return;
    if (i > 9) return this.scheduleRetry();
    const sock = net.createConnection(ipcPath(i));
    let opened = false;
    sock.once('connect', () => {
      opened = true;
      this.socket = sock;
      sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId }));
    });
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', () => {
      if (!opened) {
        sock.destroy();
        this.connect(i + 1); // Discord может слушать на discord-ipc-1, -2…
      }
    });
    sock.on('close', () => {
      if (!opened) return;
      this.log('[discord] соединение закрыто');
      this.socket = null;
      this.ready = false;
      this.buffer = Buffer.alloc(0);
      this.scheduleRetry();
    });
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.enabled || !this.clientId) return;
    this.retryTimer = setTimeout(() => this.connect(), 15_000);
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    if (this.socket) {
      try {
        this.socket.write(encode(OP.CLOSE, {}));
      } catch {
        // уже закрыт
      }
      this.socket.destroy();
    }
    this.socket = null;
    this.ready = false;
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString('utf8');
      this.buffer = this.buffer.subarray(8 + len);
      let msg = {};
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (op === OP.PING) this.socket.write(encode(OP.PONG, msg));
      else if (op === OP.CLOSE) {
        this.log(`[discord] Discord закрыл соединение: ${msg.message || ''}`);
        this.socket.destroy();
      } else if (msg.evt === 'READY') {
        this.ready = true;
        this.log(`[discord] подключено как ${msg.data && msg.data.user ? msg.data.user.username : '?'}`);
        if (this.pending !== undefined) this.send(this.pending);
      } else if (msg.evt === 'ERROR') {
        this.log(`[discord] ошибка: ${msg.data && msg.data.message}`);
      }
    }
  }

  send(activity) {
    if (!this.socket || !this.ready) return;
    this.socket.write(encode(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: String(++this.nonce) }));
  }

  update(info) {
    const activity = info ? buildActivity(info) : null;
    this.pending = activity;
    if (!this.enabled) return;
    if (!this.socket) this.connect();
    else this.send(activity);
  }
}
