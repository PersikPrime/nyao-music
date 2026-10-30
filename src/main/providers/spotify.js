import { safeDiagnostic } from '../diagnostics.js';
// Spotify (официальный путь): вход OAuth PKCE со своим Client ID, Web API для поиска, библиотеки и
// управления воспроизведением на устройстве Nyao (Web Playback SDK в скрытом окне, см. spotify-engine.js).
// Client Secret не нужен. Токены лежат только на этом компьютере (secrets, зашифрованы safeStorage).
import http from 'node:http';
import crypto from 'node:crypto';

export const SP_PORT = 43819;
export const SP_REDIRECT = `http://127.0.0.1:${SP_PORT}/spotify-callback`;
const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const BASE = 'https://api.spotify.com/v1';
const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state',
  'user-library-read', 'user-library-modify', 'playlist-read-private', 'playlist-read-collaborative',
  'user-read-recently-played'
];
const CLIENT_RE = /^[0-9a-fA-F]{32}$/;
export const REGION_MSG = 'Spotify недоступен из этой страны — без VPN он не отвечает';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function mapTrack(o) {
  if (!o || !o.id || (o.type && o.type !== 'track')) return null;
  const artists = Array.isArray(o.artists) ? o.artists : [];
  const album = o.album || {};
  return {
    id: `sp:${o.id}`,
    source: 'sp',
    srcId: o.id,
    title: o.name || 'Без названия',
    artist: artists.map((a) => a.name).filter(Boolean).join(', '),
    album: album.name || '',
    albumId: album.id || null,
    albumRef: null,
    artistRef: null,
    duration: Math.round((o.duration_ms || 0) / 1000),
    cover: (album.images && album.images[0] && album.images[0].url) || null,
    url: `https://open.spotify.com/track/${o.id}`,
    isrc: o.external_ids?.isrc || null,
    available: o.is_playable !== false && !o.is_local
  };
}

export class SpotifyError extends Error {
  constructor(message, code = 0) {
    super(message);
    this.code = code;
  }
}

export class SpotifyProvider {
  /** store: { get(key), set(key, value) } — защищённое хранилище; fetchFn — сетевой fetch; openUrl — открыть в браузере */
  constructor({ store, fetchFn, openUrl, timeoutMs = 10_000, redirectUri = SP_REDIRECT }) {
    this.store = store;
    this.fetch = fetchFn;
    this.openUrl = openUrl;
    this.timeoutMs = timeoutMs;
    this.redirectUri = redirectUri;
    this.blockedUntil = 0;
    this.log = [];
    this.refreshing = null;
    this.server = null;
  }

  get clientId() {
    return this.store.get('spClientId') || '';
  }
  setClientId(id) {
    const v = String(id || '').trim();
    if (v === this.clientId) return;
    // токены выданы другому приложению — с новым Client ID они не годятся
    this.store.set('spClientId', v);
    this.store.set('spTokens', null);
  }
  get hasClientId() {
    return CLIENT_RE.test(this.clientId);
  }
  get tokens() {
    return this.store.get('spTokens') || null;
  }
  get loggedIn() {
    return !!(this.tokens && this.tokens.refresh);
  }
  get regionBlocked() {
    return Date.now() < this.blockedUntil;
  }

  note(s) {
    const t = new Date().toTimeString().slice(0, 8);
    this.log.push(`${t} ${safeDiagnostic(s).slice(0, 300)}`);
    if (this.log.length > 60) this.log.shift();
  }
  debugText() {
    return this.log.join('\n');
  }

  // ---------- Вход ----------

  /** Открывает страницу входа в браузере и ждёт ответа на 127.0.0.1 (до 5 минут) */
  async login() {
    if (!this.hasClientId) throw new SpotifyError('Сначала впиши Client ID');
    if (this.server) throw new SpotifyError('Вход Spotify уже открыт — заверши его в браузере');
    const verifier = b64url(crypto.randomBytes(64));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new SpotifyError('Вход не завершён за 5 минут')), 5 * 60_000);
      const finish = (err, val) => {
        clearTimeout(timer);
        if (this.server) this.server.close();
        this.server = null;
        err ? reject(err) : resolve(val);
      };
      this.server = http.createServer((req, res) => {
        const u = new URL(req.url, this.redirectUri);
        if (u.pathname !== new URL(this.redirectUri).pathname) {
          res.writeHead(404).end();
          return;
        }
        const err = u.searchParams.get('error');
        const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Nyao Music</title><body style="font:16px system-ui;background:#141218;color:#e6e0e9;display:grid;place-items:center;height:100vh;margin:0"><div>${ok ? 'Spotify подключён — можно вернуться в Nyao Music' : 'Вход не удался — попробуй ещё раз в Nyao Music'}</div></body>`);
        if (err) finish(new SpotifyError(err === 'access_denied' ? 'Вход отменён' : `Spotify: ${err}`));
        else if (!ok) finish(new SpotifyError('Ответ входа не совпал — попробуй ещё раз'));
        else finish(null, u.searchParams.get('code'));
      });
      this.server.on('error', (e) => finish(new SpotifyError(`Не открыть порт ${new URL(this.redirectUri).port}: ${e.message}`)));
      this.server.listen(Number(new URL(this.redirectUri).port), '127.0.0.1', () => {
        const q = new URLSearchParams({
          client_id: this.clientId, response_type: 'code', redirect_uri: this.redirectUri,
          code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES.join(' '), state
        });
        this.openUrl(`${AUTHORIZE}?${q}`);
      });
    });
    const t = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri, client_id: this.clientId, code_verifier: verifier });
    this.saveTokens(t);
  }

  logout() {
    this.store.set('spTokens', null);
  }

  saveTokens(t) {
    const old = this.tokens || {};
    this.store.set('spTokens', {
      access: t.access_token,
      expires: Date.now() + (t.expires_in || 3600) * 1000,
      // при обновлении Spotify может не прислать новый refresh_token — тогда оставляем старый
      refresh: t.refresh_token || old.refresh
    });
  }

  async tokenRequest(form) {
    const res = await this.fetch(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 400 && text.includes('invalid_grant')) this.logout();
      throw new SpotifyError(`Spotify не выдал доступ (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
    return JSON.parse(text);
  }

  /** Действующий access token; обновляет, если до конца меньше минуты */
  async accessToken(force = false) {
    const t = this.tokens;
    if (!t || !t.refresh) throw new SpotifyError('Нужно войти в Spotify');
    if (!force && t.access && Date.now() < t.expires - 60_000) return t.access;
    if (!this.refreshing) {
      this.refreshing = this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: this.clientId })
        .then((r) => this.saveTokens(r))
        .finally(() => { this.refreshing = null; });
    }
    await this.refreshing;
    return this.tokens.access;
  }

  // ---------- Web API ----------

  async request(method, path, query = {}, body = null) {
    if (this.regionBlocked) throw new SpotifyError(REGION_MSG, 451);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const token = await this.accessToken(attempt === 2);
      const url = `${BASE}/${path}${Object.keys(query).length ? '?' + new URLSearchParams(query) : ''}`;
      const res = await this.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : null;
      if (res.status === 401 && attempt === 1) continue;
      if (res.status === 429 && attempt <= 2) {
        const wait = Math.min(5, Number(res.headers.get('retry-after')) || 1);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      let msg = text.slice(0, 160);
      try {
        msg = JSON.parse(text).error.message || msg;
      } catch {
        // ответ не JSON
      }
      this.note(`${method} /${path} → ${res.status} ${msg}`);
      if (res.status === 403 && /unavailable in this country/i.test(msg)) {
        this.blockedUntil = Date.now() + 5 * 60_000;
        throw new SpotifyError(REGION_MSG, 451);
      }
      throw new SpotifyError(this.explain(res.status, msg), res.status);
    }
    throw new SpotifyError('Spotify не ответил');
  }

  explain(code, msg) {
    if (code === 401) return 'Spotify: вход устарел, войди заново';
    if (code === 403) return /premium/i.test(msg) ? 'Spotify: нужен Premium' : `Spotify не пустил (${msg}). Проверь, что ты добавлен в User Management своего приложения`;
    if (code === 404) return `Spotify: не найдено (${msg})`;
    if (code === 429) return 'Spotify просит подождать — слишком много запросов';
    return `Spotify ${code}: ${msg}`;
  }

  async pages(path, maxPages) {
    const out = [];
    let offset = 0;
    for (let i = 0; i < maxPages; i++) {
      const page = await this.request('GET', path, { limit: '50', offset: String(offset) });
      const items = (page && page.items) || [];
      out.push(...items);
      if (items.length < 50 || !page.next) break;
      offset += items.length;
    }
    return out;
  }

  /** «Недавно прослушанное» в самом Spotify (до 50 последних), новее after (мс) → [{ track, playedAt }] */
  async recentlyPlayed(after = 0) {
    const r = await this.request('GET', 'me/player/recently-played', { limit: '50', ...(after ? { after: String(after) } : {}) });
    return ((r && r.items) || [])
      .map((it) => ({ track: mapTrack(it.track), playedAt: Date.parse(it.played_at) }))
      .filter((x) => x.track && x.playedAt);
  }

  async getAccount() {
    const me = await this.request('GET', 'me');
    return { name: me.display_name || me.id || 'Spotify', premium: me.product === 'premium', uid: me.id };
  }

  async search(q) {
    let r;
    try {
      r = await this.request('GET', 'search', { q, type: 'track', limit: '20' });
    } catch (e) {
      if (e.code !== 400) throw e;
      r = await this.request('GET', 'search', { q, type: 'track', limit: '10' });
    }
    return ((r && r.tracks && r.tracks.items) || []).map(mapTrack).filter(Boolean);
  }

  async likedTracks(limit = 1000) {
    return (await this.pages('me/tracks', Math.ceil(limit / 50))).slice(0, limit).map(it => {
      const t = mapTrack(it.track || it.item);
      return t ? { ...t, likedAt: Date.parse(it.added_at || '') || 0 } : null;
    }).filter(Boolean);
  }

  async playlists() {
    return (await this.pages('me/playlists', 6)).map((p) => ({
      id: `sp:${p.id}`,
      source: 'sp',
      title: p.name,
      count: (p.tracks && p.tracks.total) || (p.items && p.items.total) || 0,
      cover: (p.images && p.images[0] && p.images[0].url) || null,
      subtitle: p.owner && p.owner.display_name ? `Spotify · ${p.owner.display_name}` : 'Spotify'
    }));
  }

  async playlistTracks(id) {
    const pid = String(id).replace(/^sp:/, '');
    let items;
    try {
      items = await this.pages(`playlists/${pid}/items`, 20);
    } catch (e) {
      if (![400, 403, 404].includes(e.code)) throw e;
      items = await this.pages(`playlists/${pid}/tracks`, 20);
    }
    return items.map((it) => mapTrack(it.item || it.track)).filter(Boolean);
  }

  async like(track, on = true) {
    const method = on ? 'PUT' : 'DELETE';
    try {
      await this.request(method, 'me/tracks', { ids: track.srcId });
    } catch (e) {
      if (e.code !== 404 && e.code !== 410) throw e;
      await this.request(method, 'me/library', { uris: `spotify:track:${track.srcId}` });
    }
  }

  // ---------- Воспроизведение на устройстве Nyao ----------

  playUris(deviceId, uris, positionMs = 0) {
    return this.request('PUT', 'me/player/play', { device_id: deviceId }, { uris, position_ms: Math.max(0, Math.round(positionMs)) });
  }
  setShuffle(deviceId, on) {
    return this.request('PUT', 'me/player/shuffle', { state: String(!!on), device_id: deviceId });
  }
  setRepeat(deviceId, state) {
    return this.request('PUT', 'me/player/repeat', { state, device_id: deviceId });
  }
}
