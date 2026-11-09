// Пульт для других программ на этом компьютере (первым — мод Nyao MinePlay для Minecraft).
// Маленький HTTP-сервер только на 127.0.0.1; включается в настройках («Пульт для Minecraft»).
//
// Безопасность:
//  • слушаем только 127.0.0.1 — с других компьютеров недоступно;
//  • каждый запрос с токеном (Authorization: Bearer …); токен новый при каждом запуске
//    и лежит в control.json в папке данных Nyao Music — его может прочитать только программа этого пользователя;
//  • запросы из браузера (есть заголовок Origin) отклоняем — сайт не сможет управлять плеером.
//
// API v1 (JSON):
//   GET  /v1/state                      — что играет (см. snapshot ниже)
//   GET  /v1/state?since=<rev>          — длинный опрос: ответит, как только rev изменится (или через 25 с)
//   POST /v1/cmd {cmd, value?}          — toggle | play | pause | next | prev | like | seek(сек) | volume(0..1) | shuffle | repeat | wave
//   GET  /v1/cover?size=64              — обложка текущего трека, PNG size×size (Minecraft читает только PNG)
//   GET  /v1/lyrics                     — текст текущего трека: {trackId, synced, lines:[{t, text, words?:[{t, e, text}]}]}
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CONTROL_PORT = 47822;
export const CONTROL_CMDS = ['toggle', 'play', 'pause', 'next', 'prev', 'like', 'seek', 'volume', 'shuffle', 'repeat', 'wave'];

export class ControlServer {
  /**
   * @param {object} o
   * @param {string} o.dir         папка данных (сюда control.json)
   * @param {(cmd: string, value: any) => void} o.onCommand
   * @param {(url: string, size: number) => Promise<Buffer|null>} o.cover  PNG обложки
   * @param {string} o.version
   */
  constructor({ dir, onCommand, cover, lyrics = null, version = '', log = () => {} }) {
    this.dir = dir;
    this.onCommand = onCommand;
    this.coverPng = cover;
    this.lyricsFor = lyrics;
    this.lyricsCache = { id: null, value: null }; // текст последнего трека (или промис, пока ищется)
    this.version = version;
    this.log = log;
    this.server = null;
    this.port = 0;
    this.token = '';
    this.rev = 0;
    this.state = { playing: false, track: null };
    this.waiters = new Set();
    this.covers = new Map(); // url|size → Buffer (последние несколько)
  }

  get file() { return path.join(this.dir, 'control.json'); }
  get running() { return !!this.server; }

  /** Плеер в окне сообщает своё состояние; ждущие опросы получают его сразу */
  setState(s) {
    const next = { ...s, at: Date.now() };
    const changed = JSON.stringify({ ...next, at: 0, position: 0 }) !== JSON.stringify({ ...this.state, at: 0, position: 0 })
      || Math.abs((next.position || 0) - this.expectedPosition()) > 2;
    this.state = next;
    if (!changed) return;
    this.rev++;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  expectedPosition() {
    const s = this.state;
    if (!s.track) return 0;
    return (s.position || 0) + (s.playing ? (Date.now() - (s.at || Date.now())) / 1000 : 0);
  }

  snapshot() {
    const s = this.state;
    return {
      app: 'Nyao Music', version: this.version, rev: this.rev,
      playing: !!s.playing,
      // позиция на момент ответа: мод дальше сам двигает полоску, пока playing
      position: Math.round(this.expectedPosition() * 10) / 10,
      duration: s.duration || 0,
      live: !!s.live,
      liked: !!s.liked,
      volume: s.volume ?? 1,
      shuffle: !!s.shuffle,
      repeat: s.repeat || 'off',
      mode: s.mode || '',
      track: s.track || null,
      next: s.next || [],
    };
  }

  start() {
    if (this.server) return Promise.resolve(this.port);
    this.token = crypto.randomBytes(24).toString('hex');
    return new Promise((resolve) => {
      const tryPort = (port, left) => {
        const srv = http.createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, 500, { error: String(e && e.message || e) })));
        srv.once('error', () => {
          if (left > 0) tryPort(port + 1, left - 1);
          else { this.log('пульт: все порты заняты'); resolve(0); }
        });
        srv.listen(port, '127.0.0.1', () => {
          this.server = srv;
          this.port = port;
          this.writeFile();
          this.log(`пульт: 127.0.0.1:${port}`);
          resolve(port);
        });
      };
      tryPort(CONTROL_PORT, 9);
    });
  }

  stop() {
    for (const w of this.waiters) w();
    this.waiters.clear();
    if (this.server) this.server.close();
    this.server = null;
    this.port = 0;
    try { fs.unlinkSync(this.file); } catch { /* уже нет */ }
  }

  writeFile() {
    const data = { app: 'Nyao Music', version: this.version, port: this.port, token: this.token, pid: process.pid, api: 1 };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }

  send(res, code, body, type = 'application/json; charset=utf-8') {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    res.writeHead(code, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store' });
    res.end(buf);
  }

  authorized(req) {
    if (req.headers.origin) return false; // браузер
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false; // защита от подмены DNS
    const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
    if (!m) return false;
    const a = Buffer.from(m[1]);
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 16 * 1024) throw new Error('слишком большой запрос');
      chunks.push(c);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/v1/ping') return this.send(res, 200, { app: 'Nyao Music', api: 1 }); // без токена: «плеер запущен?»
    if (!this.authorized(req)) return this.send(res, 401, { error: 'нужен токен из control.json' });

    if (req.method === 'GET' && url.pathname === '/v1/state') {
      const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : NaN;
      if (Number.isFinite(since) && since === this.rev) {
        await new Promise((resolve) => {
          const done = () => { clearTimeout(t); this.waiters.delete(done); resolve(); };
          const t = setTimeout(done, 25_000);
          this.waiters.add(done);
          req.on('close', done);
        });
      }
      if (res.destroyed) return;
      return this.send(res, 200, this.snapshot());
    }

    if (req.method === 'POST' && url.pathname === '/v1/cmd') {
      const { cmd, value } = await this.body(req);
      if (!CONTROL_CMDS.includes(cmd)) return this.send(res, 400, { error: 'неизвестная команда', cmds: CONTROL_CMDS });
      if (cmd === 'seek' && !Number.isFinite(Number(value))) return this.send(res, 400, { error: 'seek: нужны секунды' });
      if (cmd === 'volume' && !(Number(value) >= 0 && Number(value) <= 1)) return this.send(res, 400, { error: 'volume: от 0 до 1' });
      this.onCommand(cmd, value === undefined ? undefined : Number(value));
      return this.send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/v1/cover') {
      const t = this.state.track;
      const size = Math.max(16, Math.min(512, Number(url.searchParams.get('size')) || 64));
      if (!t || !t.cover) return this.send(res, 404, { error: 'нет обложки' });
      const key = `${t.cover}|${size}`;
      let png = this.covers.get(key);
      if (!png) {
        png = await this.coverPng(t.cover, size).catch(() => null);
        if (!png) return this.send(res, 404, { error: 'обложка не загрузилась' });
        this.covers.set(key, png);
        if (this.covers.size > 12) this.covers.delete(this.covers.keys().next().value);
      }
      return this.send(res, 200, png, 'image/png');
    }

    if (req.method === 'GET' && url.pathname === '/v1/lyrics') {
      const t = this.state.track;
      if (!t || !this.lyricsFor || this.state.live) return this.send(res, 404, { error: 'нет текста' });
      if (this.lyricsCache.id !== t.id) {
        const p = Promise.resolve().then(() => this.lyricsFor(t)).then((r) => compactLyrics(t.id, r)).catch(() => null);
        this.lyricsCache = { id: t.id, value: p };
      }
      const value = await this.lyricsCache.value;
      if (!value) return this.send(res, 404, { error: 'нет текста' });
      return this.send(res, 200, value);
    }

    return this.send(res, 404, { error: 'нет такого адреса' });
  }
}

/** Текст для мода: только строки с временем; слова — с началом и концом (караоке), если они есть */
export function compactLyrics(trackId, r) {
  if (!r || !Array.isArray(r.lines) || !r.synced) return null;
  const round = (x) => Math.round(Number(x) * 100) / 100;
  const lines = r.lines
    .filter((l) => l && Number.isFinite(Number(l.time)))
    .map((l) => ({
      t: round(l.time),
      text: String(l.text || ''),
      ...(Array.isArray(l.words) && l.words.length ? { words: l.words.map((w) => ({ t: round(w.time), e: round(w.end ?? w.time), text: String(w.text) })) } : {}),
    }));
  if (!lines.length) return null;
  return { trackId, synced: true, words: lines.some((l) => l.words), source: r.source || '', lines };
}
