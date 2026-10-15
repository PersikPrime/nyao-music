// Скробблинг в Last.fm: «Слушает сейчас» и запись прослушанных треков в профиль.
// Вход — подтверждением в браузере (auth.getToken → страница Last.fm → auth.getSession), адрес возврата не нужен.
// Ключ сессии хранится только на этом компьютере (зашифрованно, как токены сервисов).
import crypto from 'node:crypto';
import fs from 'node:fs';

export const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';

/** Подпись запроса: md5(параметры по алфавиту ключ+значение + секрет), без format/callback */
export function signParams(params, secret) {
  const keys = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort();
  const raw = keys.map((k) => k + params[k]).join('') + secret;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex');
}

/** «Исполнитель 1, Исполнитель 2» → основной исполнитель: так Last.fm лучше узнаёт трек */
export function mainArtist(artist) {
  return String(artist || '').split(/,\s+|\s+feat\.?\s+|\s+ft\.?\s+/i)[0].trim() || String(artist || '');
}

/** Правило Last.fm: трек длиннее 30 с, прослушан наполовину или хотя бы 4 минуты */
export function shouldScrobble(duration, listened) {
  if (!(duration > 30)) return false;
  return listened >= Math.min(duration / 2, 240);
}

export class LastFm {
  constructor({ key = '', secret = '', fetch = globalThis.fetch, getSession, setSession, queueFile, openUrl = () => {}, log = () => {} }) {
    this.key = key;
    this.secret = secret;
    this.fetch = fetch;
    this.getSession = getSession; // () => { name, key } | null
    this.setSession = setSession;
    this.queueFile = queueFile;
    this.openUrl = openUrl;
    this.log = log;
    this.lastNow = '';
    this.pending = null;
  }

  get configured() {
    return !!(this.key && this.secret);
  }

  get session() {
    try {
      return this.getSession() || null;
    } catch {
      return null;
    }
  }

  status() {
    const s = this.session;
    return { configured: this.configured, connected: !!s, name: s ? s.name : null, queued: this.readQueue().length };
  }

  async call(method, params = {}, { post = false, signed = true } = {}) {
    const p = { method, api_key: this.key, ...params };
    if (signed) p.api_sig = signParams(p, this.secret);
    p.format = 'json';
    const body = new URLSearchParams(p).toString();
    const res = post
      ? await this.fetch(LASTFM_API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NyaoMusic' }, body })
      : await this.fetch(`${LASTFM_API}?${body}`, { headers: { 'User-Agent': 'NyaoMusic' } });
    const json = await res.json().catch(() => ({}));
    if (json.error) {
      const err = new Error(`Last.fm: ${json.message || json.error}`);
      err.code = json.error;
      throw err;
    }
    return json;
  }

  /** Вход: открываем страницу Last.fm и ждём, пока пользователь нажмёт «Разрешить» (до 3 минут) */
  async connect() {
    if (!this.configured) throw new Error('Last.fm не настроен в этой сборке');
    const { token } = await this.call('auth.getToken');
    this.openUrl(`https://www.last.fm/api/auth/?api_key=${encodeURIComponent(this.key)}&token=${encodeURIComponent(token)}`);
    const started = Date.now();
    this.pending = token;
    while (Date.now() - started < 180_000 && this.pending === token) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const { session } = await this.call('auth.getSession', { token });
        const s = { name: session.name, key: session.key };
        this.setSession(s);
        this.pending = null;
        this.flush().catch(() => {});
        return { name: s.name };
      } catch (e) {
        if (e.code !== 14 && e.code !== '14') throw e; // 14 — ещё не подтвердили, ждём
      }
    }
    this.pending = null;
    throw new Error('Не дождался подтверждения в Last.fm — попробуй ещё раз');
  }

  cancel() {
    this.pending = null;
  }

  disconnect() {
    this.setSession(null);
  }

  /** «Слушает сейчас» в профиле (один раз на трек) */
  async nowPlaying(track) {
    const s = this.session;
    if (!s || !track || !track.title) return;
    const id = track.id || track.title;
    if (id === this.lastNow) return;
    this.lastNow = id;
    const p = { artist: mainArtist(track.artist), track: track.title, sk: s.key };
    if (track.album) p.album = track.album;
    if (track.duration) p.duration = String(Math.round(track.duration));
    await this.call('track.updateNowPlaying', p, { post: true }).catch((e) => this.log(`[lastfm] nowPlaying: ${e.message}`));
  }

  readQueue() {
    try {
      return JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
    } catch {
      return [];
    }
  }

  writeQueue(q) {
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(q.slice(-500)));
    } catch {
      // нет места — потеряем немного скробблов, не страшно
    }
  }

  /** Трек закончился или переключён: если прослушан достаточно — в очередь и отправить */
  scrobble({ track, listened = 0, at = Date.now() }) {
    if (!this.session || !track || !track.title) return false;
    const duration = Number(track.duration) || 0;
    if (!shouldScrobble(duration, listened)) return false;
    const item = { artist: mainArtist(track.artist), track: track.title, album: track.album || '', duration: Math.round(duration), timestamp: Math.floor((at - listened * 1000) / 1000) };
    const q = this.readQueue();
    q.push(item);
    this.writeQueue(q);
    this.lastNow = '';
    this.flush().catch(() => {});
    return true;
  }

  /** Отправляет накопленное пачками по 50 (так требует Last.fm); без сети — останется на потом */
  async flush() {
    const s = this.session;
    if (!s || this.flushing) return;
    this.flushing = true;
    try {
      let q = this.readQueue();
      while (q.length) {
        const batch = q.slice(0, 50);
        const p = { sk: s.key };
        batch.forEach((it, i) => {
          p[`artist[${i}]`] = it.artist;
          p[`track[${i}]`] = it.track;
          p[`timestamp[${i}]`] = String(it.timestamp);
          if (it.album) p[`album[${i}]`] = it.album;
          if (it.duration) p[`duration[${i}]`] = String(it.duration);
        });
        try {
          await this.call('track.scrobble', p, { post: true });
        } catch (e) {
          // 9 — сессия отозвана: выходим; остальное (сеть, сбой) — попробуем позже
          if (e.code === 9 || e.code === '9') this.setSession(null);
          this.log(`[lastfm] scrobble: ${e.message}`);
          return;
        }
        q = this.readQueue().slice(batch.length);
        this.writeQueue(q);
      }
    } finally {
      this.flushing = false;
    }
  }
}
