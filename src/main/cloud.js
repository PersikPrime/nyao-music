// Аккаунт Nyao и синхронизация через свой сервер (api.nmusic.bixtl.cc).
// Важно: токены Яндекса, YouTube и SoundCloud остаются только на этом компьютере — на сервер уходят
// лишь история прослушиваний, «сейчас играет», миксы и настройки волны.
import fs from 'node:fs';
import path from 'node:path';

export const API_BASE = 'https://api.nmusic.bixtl.cc';
const HISTORY_MAX = 1500;
const OUTBOX_MAX = 2000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/** Минимум полей трека, который нужен другому устройству, чтобы включить его */
export function slimTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: t.id, source: t.source, srcId: t.srcId, title: t.title, artist: t.artist, album: t.album || '',
    albumId: t.albumId || null, duration: t.duration || 0, cover: t.cover || null,
    ...(t.albumRef ? { albumRef: t.albumRef } : {}), ...(t.artistRef ? { artistRef: t.artistRef } : {}), ...(t.url ? { url: t.url } : {})
  };
}

export class NyaoCloud {
  /**
   * @param dir      папка userData
   * @param getToken / setToken — хранение токена Nyao (в зашифрованных секретах)
   * @param openUrl  открыть ссылку в браузере пользователя
   */
  constructor({ dir, getToken, setToken, openUrl, fetch = globalThis.fetch, base = API_BASE, device = 'ПК', platform = process.platform, log = () => {} }) {
    this.dir = dir;
    this.getToken = getToken;
    this.setToken = setToken;
    this.openUrl = openUrl;
    this.fetch = fetch;
    this.base = base;
    this.device = device;
    this.platform = platform;
    this.log = log;
    this.user = readJson(this.file('cloud-user.json'), null);
    this.loginAbort = null;
    this.lastNow = 0;
    this.lastNowKey = '';
    this.remoteRecent = { at: 0, ids: new Set() };
  }

  file(name) {
    return path.join(this.dir, name);
  }

  get loggedIn() {
    return !!this.getToken();
  }

  async request(method, p, body) {
    const token = this.getToken();
    const res = await this.fetch(this.base + p, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'NyaoMusic', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // не JSON — значит, что-то посередине (прокси, страница ошибки)
    }
    if (res.status === 401 && token) {
      // сессию удалили с другого устройства — выходим тихо
      this.forget();
    }
    if (!res.ok) {
      const err = new Error((json && json.error) || `Сервер Nyao ответил ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  status() {
    return { loggedIn: this.loggedIn, user: this.loggedIn ? this.user : null };
  }

  forget() {
    this.setToken(null);
    this.user = null;
    try {
      fs.unlinkSync(this.file('cloud-user.json'));
    } catch {
      // уже нет
    }
  }

  /** Вход: открываем Telegram в браузере и ждём, пока сервер скажет «готово» */
  async login({ timeoutMs = 10 * 60_000, interval = 2000 } = {}) {
    this.cancelLogin();
    const ctrl = { aborted: false };
    this.loginAbort = ctrl;
    const start = await this.request('POST', '/auth/start', { device: this.device, platform: this.platform });
    await this.openUrl(start.url);
    const until = Date.now() + Math.min(timeoutMs, (start.expiresIn || 600) * 1000);
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, interval));
      if (ctrl.aborted) throw new Error('Вход отменён');
      let r;
      try {
        r = await this.request('GET', `/auth/poll?id=${encodeURIComponent(start.id)}`);
      } catch (e) {
        if (e.status === 400 || e.status === 410) throw e;
        continue; // сеть моргнула — пробуем дальше
      }
      if (r && r.status === 'done') {
        this.setToken(r.token);
        this.user = r.user;
        writeJson(this.file('cloud-user.json'), r.user);
        this.loginAbort = null;
        return r.user;
      }
    }
    throw new Error('Время входа вышло — попробуй ещё раз');
  }

  cancelLogin() {
    if (this.loginAbort) this.loginAbort.aborted = true;
    this.loginAbort = null;
  }

  async logout() {
    try {
      if (this.loggedIn) await this.request('POST', '/auth/logout');
    } catch {
      // всё равно выходим локально
    }
    this.forget();
  }

  async me() {
    const r = await this.request('GET', '/me');
    this.user = r.user;
    writeJson(this.file('cloud-user.json'), r.user);
    return r;
  }

  removeDevice(id) {
    return this.request('DELETE', `/devices/${encodeURIComponent(id)}`);
  }

  // ---------- История: локально всегда, на сервер — когда вошёл ----------
  history() {
    return readJson(this.file('history.json'), []);
  }

  recordPlay({ track, listened = 0, skipped = false, at = Date.now() }) {
    const t = slimTrack(track);
    if (!t) return;
    const play = { trackId: t.id, source: t.source, title: t.title, artist: t.artist, cover: t.cover, duration: t.duration, listened: Math.round(listened), skipped: !!skipped, playedAt: at };
    const hist = this.history();
    hist.unshift(play);
    writeJson(this.file('history.json'), hist.slice(0, HISTORY_MAX));
    if (this.loggedIn) {
      const out = readJson(this.file('cloud-outbox.json'), []);
      out.push(play);
      writeJson(this.file('cloud-outbox.json'), out.slice(-OUTBOX_MAX));
      if (out.length >= 10) this.flush().catch(() => {});
    }
  }

  async flush() {
    if (!this.loggedIn || this.flushing) return;
    const out = readJson(this.file('cloud-outbox.json'), []);
    if (!out.length) return;
    this.flushing = true;
    try {
      for (let i = 0; i < out.length; i += 200) await this.request('POST', '/history', { plays: out.slice(i, i + 200) });
      // за время отправки могли добавиться новые — оставляем только их
      const now = readJson(this.file('cloud-outbox.json'), []);
      writeJson(this.file('cloud-outbox.json'), now.slice(out.length));
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Что недавно звучало (для волны без повторов): своя история + история всех устройств с сервера.
   * Пропущенные треки помним дольше — раз скипнул, не надо их снова подсовывать.
   */
  async recentIds({ days = 3, skippedDays = 14 } = {}) {
    const now = Date.now();
    const ids = new Set();
    for (const p of this.history()) {
      const age = now - p.playedAt;
      if (age < days * 86_400_000 || (p.skipped && age < skippedDays * 86_400_000)) ids.add(p.trackId);
    }
    if (this.loggedIn) {
      if (now - this.remoteRecent.at > 5 * 60_000) {
        try {
          const r = await this.request('GET', `/history?days=${skippedDays}&limit=2000`);
          const set = new Set();
          for (const p of r.plays || []) {
            const age = now - new Date(p.playedAt).getTime();
            if (age < days * 86_400_000 || p.skipped) set.add(p.trackId);
          }
          this.remoteRecent = { at: now, ids: set };
        } catch {
          // без сервера — только своя история
        }
      }
      for (const id of this.remoteRecent.ids) ids.add(id);
    }
    return ids;
  }

  // ---------- «Сейчас играет» ----------
  /** Шлём не чаще раза в 20 секунд, но смену трека и паузу — сразу */
  async setNow({ track, position = 0, playing = false, context = '' }) {
    if (!this.loggedIn) return;
    const t = slimTrack(track);
    const key = `${t ? t.id : '-'}|${playing}`;
    const now = Date.now();
    if (key === this.lastNowKey && now - this.lastNow < 20_000) return;
    this.lastNowKey = key;
    this.lastNow = now;
    await this.request('PUT', '/now', { track: t, position, playing, context });
  }

  async others() {
    if (!this.loggedIn) return [];
    const r = await this.request('GET', '/now');
    return r.devices || [];
  }

  // ---------- Синхронизируемые данные ----------
  meta() {
    return readJson(this.file('cloud-meta.json'), {});
  }
  touch(key, at = Date.now()) {
    const m = this.meta();
    m[key] = at;
    writeJson(this.file('cloud-meta.json'), m);
  }

  async pushState(key, data) {
    const at = Date.now();
    this.touch(key, at);
    if (!this.loggedIn) return;
    await this.request('PUT', `/state/${key}`, { data, updatedAt: at });
  }

  /**
   * Сверка с сервером. Для каждого ключа: где свежее, оттуда и берём.
   * handlers: { key: { get: () => локальные данные, set: (data) => записать локально } }
   */
  async syncState(handlers) {
    if (!this.loggedIn) return [];
    const remote = await this.request('GET', '/state');
    const meta = this.meta();
    const changed = [];
    for (const [key, h] of Object.entries(handlers)) {
      const r = remote[key];
      const localAt = meta[key] || 0;
      if (r && !localAt && h.merge) {
        // первый вход с этого устройства, а на сервере уже что-то есть — объединяем, ничего не теряя
        const data = h.merge(h.get(), r.data);
        h.set(data);
        const at = Date.now();
        this.touch(key, at);
        await this.request('PUT', `/state/${key}`, { data, updatedAt: at });
        changed.push(key);
      } else if (r && r.updatedAt > localAt) {
        h.set(r.data);
        this.touch(key, r.updatedAt);
        changed.push(key);
      } else if (localAt && (!r || localAt > r.updatedAt)) {
        await this.request('PUT', `/state/${key}`, { data: h.get(), updatedAt: localAt });
      } else if (!r && !localAt) {
        // первый вход с этого устройства: отдаём то, что есть
        const at = Date.now();
        this.touch(key, at);
        await this.request('PUT', `/state/${key}`, { data: h.get(), updatedAt: at });
      }
    }
    return changed;
  }
}
