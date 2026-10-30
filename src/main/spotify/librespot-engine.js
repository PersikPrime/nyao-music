import fs from 'node:fs';
import { spawn } from 'node:child_process';

const TRACK = /^spotify:track:[A-Za-z0-9]{22}$/;
const MESSAGES = {
  auth: 'Librespot не принял вход — проверь Premium и войди заново',
  audio_backend: 'Librespot не смог открыть звуковое устройство',
  not_ready: 'Librespot отключился — попробуй включить трек ещё раз',
  unavailable: 'Этот трек недоступен в librespot',
  queue_end: 'В очереди librespot больше нет треков',
  protocol: 'Не удалось связаться с движком librespot',
};

export class LibrespotEngine {
  constructor({ api, binary, args = [], deviceId, allowed = () => false, onChange = () => {}, spawnFn = spawn }) {
    Object.assign(this, { api, binary, args, deviceId, allowed, onChange, spawnFn });
    this.child = null;
    this.status = { state: 'idle' };
    this.snapshot = null;
    this.calls = new Map();
    this.seq = 0;
    this.epoch = 0;
    this.intent = 0;
    this.commandIntent = 0;
    this.starting = null;
    this.volume = 0.8;
  }
  get available() { return !!this.binary && fs.existsSync(this.binary); }
  get started() { return !!this.child; }
  debugText() { return 'librespot 0.8.0 · ' + this.status.state; }
  publish(extra = {}) { this.onChange({ backend: 'librespot', status: this.status, snapshot: this.snapshot, ...extra }); }
  fail(code, kind = 'engine') {
    const message = MESSAGES[code] || 'Нативный плеер Spotify остановился — попробуй подключить его заново';
    this.status = { state: 'failed', kind, message };
    this.publish({ error: { kind, message } });
  }
  async awaitReady() {
    if (!this.allowed()) throw new Error('Эксперимент librespot выключен');
    if (!this.available) throw new Error('Для librespot нужен полный установщик этой версии');
    if (this.status.state === 'ready' && this.child) return 'librespot';
    if (this.starting) return this.starting;
    if (this.child) {
      // Keep the caller's play intent while retiring a failed worker.
      const pendingIntent = this.commandIntent; this.release(); this.commandIntent = pendingIntent;
    }
    const epoch = this.epoch;
    const starting = (async () => {
      this.status = { state: 'loading' }; this.publish();
      const token = await this.api.accessToken();
      if (epoch !== this.epoch || !this.allowed()) throw new Error('Подключение librespot отменено');
      const child = this.spawnFn(this.binary, this.args, {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, RUST_LOG: 'off', RUST_BACKTRACE: '0' },
      });
      this.child = child;
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        if (this.child !== child) return;
        buffer += chunk;
        if (buffer.length > 65536) { this.release(); this.fail('protocol'); return; }
        for (;;) {
          const i = buffer.indexOf('\n');
          if (i < 0) break;
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
          try { this.receive(JSON.parse(line)); }
          catch { this.release(); this.fail('protocol'); return; }
        }
      });
      // Native dependency diagnostics may contain credential material. Never collect or forward them.
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', () => { if (this.child === child) { this.release(); this.fail('not_ready'); } });
      child.on('exit', () => { if (this.child === child) { this.release(); this.fail('not_ready'); } });
      const hello = await this.send('ping', {}, 5000);
      if (hello?.protocol !== 1) throw new Error(MESSAGES.protocol);
      const account = await this.send('connect', { accessToken: token, deviceId: typeof this.deviceId === 'function' ? this.deviceId() : this.deviceId }, 30000);
      if (epoch !== this.epoch || !this.allowed()) throw new Error('Подключение librespot отменено');
      await this.send('volume', { volume: this.volume });
      this.username = account?.username || '';
      this.status = { state: 'ready', deviceId: 'librespot' }; this.publish();
      return 'librespot';
    })().catch(error => {
      if (epoch === this.epoch) { this.release(); this.fail('not_ready'); }
      throw error;
    }).finally(() => { if (this.starting === starting) this.starting = null; });
    this.starting = starting;
    return starting;
  }
  receive(message) {
    if (message.id != null) {
      const call = this.calls.get(message.id);
      if (!call) return;
      this.calls.delete(message.id); clearTimeout(call.timer);
      message.ok ? call.resolve(message.data) : call.reject(new Error(MESSAGES[message.code] || MESSAGES.protocol));
      return;
    }
    if (message.event === 'hello') {
      if (message.protocol !== 1) throw new Error('protocol');
      return;
    }
    if (message.generation !== this.intent || !this.allowed()) return;
    if (message.event === 'state' && message.snapshot) {
      const s = message.snapshot;
      if (!TRACK.test(s.uri || '')) return;
      const finite = n => Number.isFinite(n) ? Math.max(0, Math.min(n, 172800000)) : 0;
      this.snapshot = { uri: s.uri, paused: !!s.paused, position: finite(s.position), duration: finite(s.duration), at: Date.now() };
      this.publish();
    } else if (message.event === 'error') {
      this.fail(message.code, message.kind === 'playback' ? 'playback' : 'engine');
    }
  }
  send(command, params = {}, timeout = 10000) {
    if (!this.child?.stdin.writable) return Promise.reject(new Error(MESSAGES.not_ready));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error('Librespot не ответил вовремя'));
      }, timeout);
      this.calls.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, command, ...params }) + '\n', error => {
        if (!error) return;
        const call = this.calls.get(id);
        if (call) { clearTimeout(call.timer); this.calls.delete(id); reject(new Error(MESSAGES.not_ready)); }
      });
    });
  }
  async playUris(uris, positionMs = 0) {
    if (!Array.isArray(uris) || !uris.length || uris.length > 20 || uris.some(u => !TRACK.test(u))) throw new Error('Некорректная очередь Spotify');
    const intent = ++this.commandIntent;
    await this.awaitReady();
    if (intent !== this.commandIntent || !this.allowed()) return;
    const generation = ++this.intent;
    await this.send('play', { uris, positionMs: Math.max(0, Math.min(172800000, Math.round(Number(positionMs) || 0))), generation });
  }
  pause() { ++this.commandIntent; return this.started ? this.send('pause') : Promise.resolve(); }
  resume() { return this.allowed() ? this.send('resume') : Promise.reject(new Error('Эксперимент librespot выключен')); }
  seek(ms) { return this.allowed() ? this.send('seek', { positionMs: Math.max(0, Math.min(172800000, Math.round(Number(ms) || 0))) }) : Promise.reject(new Error('Эксперимент librespot выключен')); }
  nextTrack() { return this.allowed() ? this.send('next') : Promise.reject(new Error('Эксперимент librespot выключен')); }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    return this.started ? this.send('volume', { volume: this.volume }) : Promise.resolve();
  }
  ensureModes() { return Promise.resolve(); } // The local queue follows Nyao; no remote shuffle/autoplay.
  release() {
    this.epoch++; this.intent++; this.commandIntent++;
    const child = this.child; this.child = null; this.starting = null;
    for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(new Error('Librespot остановлен')); }
    this.calls.clear();
    if (child) { child.stdin.destroy(); child.kill(); }
    this.snapshot = null; this.status = { state: 'idle' };
  }
}
