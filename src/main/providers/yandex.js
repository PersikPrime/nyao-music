// Провайдер Яндекс Музыки через неофициальное API (api.music.yandex.net).
// Методы и формат ответов взяты из библиотеки yandex-music-api (MarshalX).
// Официального API нет: если Яндекс что-то поменяет, править нужно здесь.
import crypto from 'node:crypto';

const API = 'https://api.music.yandex.net';
// client_id официального Android-приложения: стандартный способ получить OAuth-токен для музыки
export const OAUTH_CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d';
export const OAUTH_URL = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${OAUTH_CLIENT_ID}`;
const SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';

export function coverUrl(uri, size = 400) {
  if (!uri) return null;
  return 'https://' + uri.replace('%%', `${size}x${size}`);
}

export function mapTrack(t) {
  if (!t || t.id == null) return null;
  const album = (t.albums && t.albums[0]) || {};
  const firstArtist = (t.artists || [])[0];
  return {
    id: `ya:${t.id}`,
    source: 'ya',
    srcId: String(t.id),
    albumId: album.id != null ? String(album.id) : null,
    albumRef: album.id != null ? `ya:${album.id}` : null,
    artistRef: firstArtist && firstArtist.id != null ? `ya:${firstArtist.id}` : null,
    title: t.title + (t.version ? ` (${t.version})` : ''),
    artist: (t.artists || []).map((a) => a.name).join(', ') || 'Неизвестный исполнитель',
    album: album.title || '',
    duration: Math.round((t.durationMs || 0) / 1000),
    cover: coverUrl(t.coverUri || album.coverUri || t.ogImage),
    available: t.available !== false,
    // громкость трека (LUFS по EBU R128) — для выравнивания громкости между треками и сервисами
    loud: t.r128 && Number.isFinite(t.r128.i) ? t.r128.i : null
  };
}

export function signDownload(info) {
  const sign = crypto.createHash('md5').update(SIGN_SALT + info.path.slice(1) + info.s).digest('hex');
  return `https://${info.host}/get-mp3/${sign}/${info.ts}${info.path}`;
}

function xmlValue(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : null;
}

const MOODS = new Set(['active', 'fun', 'calm', 'sad']);
const DIVERSITIES = new Set(['favorite', 'discover', 'popular']);

export class YandexProvider {
  constructor({ token = null, fetch = globalThis.fetch } = {}) {
    this.token = token;
    this.fetch = fetch;
    this.account = null;
    this.wave = null; // { sessionId, batchId }
  }

  get loggedIn() {
    return !!this.token;
  }

  setToken(token) {
    this.token = token;
    this.account = null;
    this.wave = null;
  }

  headers(extra = {}) {
    const h = {
      'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
      'User-Agent': 'Yandex-Music-API',
      'Accept-Language': 'ru',
      ...extra
    };
    if (this.token) h.Authorization = `OAuth ${this.token}`;
    return h;
  }

  async request(method, pathOrUrl, { json, form, query } = {}) {
    let url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
    if (query) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query).toString();
    const opts = { method, headers: this.headers() };
    if (json !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(json);
    } else if (form !== undefined) {
      opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      opts.body = new URLSearchParams(form).toString();
    }
    const res = await this.fetch(url, opts);
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Яндекс ${method} ${pathOrUrl}: ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    if (!text) return null;
    if (text.trimStart().startsWith('<')) return text; // XML у download-info
    const data = JSON.parse(text);
    return data && 'result' in data ? data.result : data;
  }

  async getAccount() {
    if (this.account) return this.account;
    const status = await this.request('GET', '/account/status');
    const acc = status.account || {};
    this.account = {
      uid: acc.uid,
      name: acc.displayName || acc.fullName || acc.login || 'Яндекс',
      login: acc.login,
      plus: !!(status.plus && status.plus.hasPlus)
    };
    return this.account;
  }

  // ---------- Моя волна ----------

  waveSeeds({ diversity, mood } = {}) {
    const seeds = ['user:onyourwave'];
    if (diversity && DIVERSITIES.has(diversity)) seeds.push(`settingDiversity:${diversity}`);
    if (mood && MOODS.has(mood)) seeds.push(`settingMoodEnergy:${mood}`);
    return seeds;
  }

  async waveStart(opts = {}) {
    const body = { seeds: this.waveSeeds(opts), includeTracksInResponse: true, includeWaveModel: false, interactive: true };
    let session;
    try {
      session = await this.request('POST', '/rotor/session/new', { json: body });
    } catch (e) {
      // Если сиды настроек не приняты — запускаем обычную волну
      if (body.seeds.length > 1) {
        session = await this.request('POST', '/rotor/session/new', { json: { ...body, seeds: ['user:onyourwave'] } });
      } else {
        return this.waveLegacy();
      }
    }
    this.wave = { sessionId: session.radioSessionId, batchId: session.batchId };
    return (session.sequence || []).map((s) => mapTrack(s.track)).filter(Boolean);
  }

  /** Радио по треку: станция Яндекса track:ID (отдельная сессия, волну не трогает) */
  async radioStart(trackId) {
    const id = String(trackId).split(':')[0];
    const session = await this.request('POST', '/rotor/session/new', { json: { seeds: [`track:${id}`], includeTracksInResponse: true, includeWaveModel: false, interactive: true } });
    this.radio = { sessionId: session.radioSessionId, batchId: session.batchId };
    return (session.sequence || []).map((s) => mapTrack(s.track)).filter(Boolean);
  }

  async radioMore(queueIds = []) {
    if (!this.radio) return [];
    const ids = queueIds.filter((id) => id.startsWith('ya:')).map((id) => id.slice(3)).slice(-10);
    const res = await this.request('POST', `/rotor/session/${this.radio.sessionId}/tracks`, { json: { queue: ids } });
    if (res.batchId) this.radio.batchId = res.batchId;
    return (res.sequence || []).map((s) => mapTrack(s.track)).filter(Boolean);
  }

  async waveMore(queueIds = []) {
    if (!this.wave) return this.waveStart();
    const ids = queueIds.filter((id) => id.startsWith('ya:')).map((id) => id.slice(3)).slice(-10);
    try {
      const res = await this.request('POST', `/rotor/session/${this.wave.sessionId}/tracks`, { json: { queue: ids } });
      if (res.batchId) this.wave.batchId = res.batchId;
      return (res.sequence || []).map((s) => mapTrack(s.track)).filter(Boolean);
    } catch (e) {
      // Сессия могла протухнуть — стартуем заново
      this.wave = null;
      return this.waveStart();
    }
  }

  async waveLegacy() {
    const res = await this.request('GET', '/rotor/station/user:onyourwave/tracks', { query: { settings2: 'true' } });
    this.wave = null;
    return (res.sequence || []).map((s) => mapTrack(s.track)).filter(Boolean);
  }

  async waveFeedback(type, track, playedSeconds = 0) {
    if (!this.wave || !track || track.source !== 'ya') return;
    const event = { type, timestamp: new Date().toISOString(), from: 'desktop_win-home-playlist_of_the_day-playlist-default' };
    if (type !== 'radioStarted') event.trackId = track.albumId ? `${track.srcId}:${track.albumId}` : track.srcId;
    if (type === 'trackFinished' || type === 'skip') event.totalPlayedSeconds = playedSeconds;
    try {
      await this.request('POST', `/rotor/session/${this.wave.sessionId}/feedback`, { json: { event, batchId: this.wave.batchId } });
    } catch {
      // фидбек не критичен
    }
  }

  // ---------- Медиатека ----------

  async tracksByIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const res = await this.request('POST', '/tracks', { form: { 'track-ids': chunk.join(','), 'with-positions': 'false' } });
      out.push(...(res || []).map(mapTrack).filter(Boolean));
    }
    return out;
  }

  async likedTracks(limit = 10000) {
    const { uid } = await this.getAccount();
    const res = await this.request('GET', `/users/${uid}/likes/tracks`);
    const ids = ((res.library && res.library.tracks) || []).slice(0, limit).map((t) => (t.albumId ? `${t.id}:${t.albumId}` : t.id));
    return this.tracksByIds(ids);
  }

  async playlists() {
    const { uid } = await this.getAccount();
    const list = (await this.request('GET', `/users/${uid}/playlists/list`)) || [];
    const own = list.map((p) => this.mapPlaylist(p));
    let personal = [];
    try {
      const landing = await this.request('GET', '/landing3', { query: { blocks: 'personalplaylists' } });
      personal = (landing.blocks || [])
        .flatMap((b) => b.entities || [])
        .map((e) => e.data && e.data.data)
        .filter(Boolean)
        .map((p) => this.mapPlaylist(p));
    } catch {
      // персональные плейлисты необязательны
    }
    return [...personal, ...own];
  }

  mapPlaylist(p) {
    const cover = p.cover && (p.cover.uri || (p.cover.itemsUri && p.cover.itemsUri[0]));
    const owner = (p.owner && p.owner.uid) || p.uid;
    return {
      id: `ya:${owner}:${p.kind}`,
      source: 'ya',
      title: p.title,
      count: p.trackCount || 0,
      cover: coverUrl(cover || p.ogImage, 300)
    };
  }

  /** Новый приватный плейлист с треками (для переноса). → id вида ya:uid:kind */
  async createPlaylist(title, tracks) {
    const { uid } = await this.getAccount();
    const pl = await this.request('POST', `/users/${uid}/playlists/create`, { form: { title: String(title).slice(0, 100), visibility: 'private' } });
    let revision = pl.revision;
    for (let i = 0; i < tracks.length; i += 100) {
      const chunk = tracks.slice(i, i + 100).map((t) => ({ id: String(t.srcId).split(':')[0], ...(t.albumId ? { albumId: String(t.albumId) } : {}) }));
      const r = await this.request('POST', `/users/${uid}/playlists/${pl.kind}/change-relative`, { form: { diff: JSON.stringify([{ op: 'insert', at: i, tracks: chunk }]), revision: String(revision) } });
      revision = r && r.revision != null ? r.revision : revision + 1;
    }
    return `ya:${uid}:${pl.kind}`;
  }

  /** Подробности трека для «О треке»: год, жанр, лейбл, номер в альбоме, метка «18+» */
  async trackDetails(trackId) {
    const res = await this.request('GET', `/tracks/${String(trackId).split(':')[0]}`);
    const t = (Array.isArray(res) ? res[0] : res) || {};
    const al = (t.albums || [])[0] || {};
    const pos = al.trackPosition || {};
    return {
      year: al.year || (al.releaseDate ? Number(String(al.releaseDate).slice(0, 4)) : null),
      genre: al.genre || null,
      label: (al.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean).join(', ') || null,
      position: pos.index ? `${pos.index}${al.trackCount ? ' из ' + al.trackCount : ''}` : null,
      explicit: t.contentWarning === 'explicit' || t.explicit === true,
      artists: (t.artists || []).map((a) => a.name)
    };
  }

  async playlistTracks(playlistId) {
    const [, owner, kind] = playlistId.split(':');
    const res = await this.request('GET', `/users/${owner}/playlists/${kind}`, { query: { 'rich-tracks': 'true' } });
    const items = res.tracks || [];
    const withData = items.map((i) => i.track).filter(Boolean);
    if (withData.length) return withData.map(mapTrack).filter(Boolean);
    return this.tracksByIds(items.map((i) => (i.albumId ? `${i.id}:${i.albumId}` : i.id)));
  }

  async search(text) {
    const res = await this.request('GET', '/search', { query: { text, type: 'track', page: '0', nocorrect: 'false' } });
    return ((res.tracks && res.tracks.results) || []).map(mapTrack).filter(Boolean);
  }

  // ---------- Исполнители и альбомы ----------

  mapAlbumCard(a) {
    return {
      ref: `ya:${a.id}`,
      source: 'ya',
      title: a.title + (a.version ? ` (${a.version})` : ''),
      year: a.year || null,
      kind: a.type === 'single' ? 'single' : a.metaType === 'compilation' || a.type === 'compilation' ? 'compilation' : 'album',
      cover: coverUrl(a.coverUri || a.ogImage, 300),
      artist: (a.artists || []).map((x) => x.name).join(', ')
    };
  }

  mapArtistCard(a) {
    return { ref: `ya:${a.id}`, source: 'ya', name: a.name, cover: coverUrl(a.cover && (a.cover.uri || a.cover.prefix && a.cover.prefix + '%%'), 200) };
  }

  async artist(id) {
    const r = await this.request('GET', `/artists/${id}/brief-info`);
    const a = r.artist || {};
    return {
      ref: `ya:${a.id}`,
      name: a.name,
      cover: coverUrl(a.cover && a.cover.uri, 600) || coverUrl(a.ogImage, 600),
      listeners: (r.stats && r.stats.lastMonthListeners) || null,
      description: (a.description && a.description.text) || '',
      popular: (r.popularTracks || []).map(mapTrack).filter(Boolean),
      albums: [...(r.albums || []), ...(r.alsoAlbums || [])].map((x) => this.mapAlbumCard(x)),
      similar: (r.similarArtists || []).map((x) => this.mapArtistCard(x))
    };
  }

  async album(id) {
    const r = await this.request('GET', `/albums/${id}/with-tracks`);
    const tracks = (r.volumes || []).flat().map(mapTrack).filter(Boolean);
    const artist = (r.artists || [])[0];
    return {
      ref: `ya:${r.id}`,
      title: r.title + (r.version ? ` (${r.version})` : ''),
      artist: (r.artists || []).map((x) => x.name).join(', '),
      artistRef: artist ? `ya:${artist.id}` : null,
      year: r.year || null,
      kind: r.type === 'single' ? 'single' : 'album',
      cover: coverUrl(r.coverUri || r.ogImage, 600),
      tracks
    };
  }

  /**
   * Новые релизы любимых исполнителей: лайкнутые исполнители (а если их мало — самые частые в лайках),
   * у каждого — свежие альбомы и синглы за последние ~4 месяца.
   */
  async newReleases({ days = 120, limit = 18 } = {}) {
    const { uid } = await this.getAccount();
    const ids = [];
    const add = (id) => {
      if (id != null && !ids.includes(String(id))) ids.push(String(id));
    };
    try {
      const liked = await this.request('GET', `/users/${uid}/likes/artists`);
      for (const x of Array.isArray(liked) ? liked : []) add((x.artist || x).id);
    } catch {
      // нет лайкнутых исполнителей — возьмём из треков
    }
    if (ids.length < 12) {
      try {
        const tracks = await this.likedTracks(300);
        const freq = new Map();
        for (const t of tracks) if (t.artistRef) freq.set(t.artistRef.slice(3), (freq.get(t.artistRef.slice(3)) || 0) + 1);
        [...freq.entries()].sort((a, b) => b[1] - a[1]).forEach(([id]) => add(id));
      } catch {
        // без лайков — без релизов
      }
    }
    const since = Date.now() - days * 86400000;
    const found = new Map();
    const pick = ids.slice(0, 40);
    let i = 0;
    const worker = async () => {
      while (i < pick.length) {
        const id = pick[i++];
        try {
          const r = await this.request('GET', `/artists/${id}/direct-albums`, { query: { page: '0', 'page-size': '6', 'sort-by': 'year' } });
          for (const a of r.albums || []) {
            const ts = a.releaseDate ? Date.parse(a.releaseDate) : NaN;
            if (!Number.isFinite(ts) || ts < since || ts > Date.now() + 86400000 || found.has(a.id)) continue;
            found.set(a.id, { ...this.mapAlbumCard(a), releaseDate: new Date(ts).toISOString() });
          }
        } catch {
          // у исполнителя не получилось — пропускаем
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return [...found.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)).slice(0, limit);
  }

  /**
   * Текст трека от Яндекса (лицензированный: Musixmatch, LyricFind и др.). format: 'LRC' — по строкам со временем, 'TEXT' — просто текст.
   * Запрос подписывается так же, как в приложении Яндекс Музыки. → { text, provider } или null
   */
  async lyrics(trackId, format = 'LRC') {
    const id = String(trackId).split(':')[0];
    const ts = Math.floor(Date.now() / 1000);
    const sign = crypto.createHmac('sha256', 'p93jhgh689SBReK6ghtw62').update(`${id}${ts}`).digest('base64');
    let r;
    try {
      r = await this.request('GET', `/tracks/${id}/lyrics`, { query: { format, timeStamp: String(ts), sign } });
    } catch (e) {
      if (e.status === 404) return null; // у трека нет текста
      throw e;
    }
    if (!r || !r.downloadUrl) return null;
    const res = await this.fetch(r.downloadUrl);
    if (!res.ok) throw Object.assign(new Error(`файл текста: HTTP ${res.status}`), { status: res.status });
    const text = await res.text();
    const major = r.major && (r.major.prettyName || r.major.name);
    return text.trim() ? { text, provider: major ? String(major).replace(/^MUSIXMATCH$/i, 'Musixmatch').replace(/^LYRICFIND$/i, 'LyricFind') : null } : null;
  }

  /** Все треки исполнителя (по популярности) */
  async artistTracks(id, limit = 500) {
    const r = await this.request('GET', `/artists/${id}/tracks`, { query: { page: '0', 'page-size': String(limit) } });
    return (r.tracks || []).map(mapTrack).filter(Boolean);
  }

  async searchArtist(name) {
    const r = await this.request('GET', '/search', { query: { text: name, type: 'artist', page: '0' } });
    return ((r.artists && r.artists.results) || []).map((x) => this.mapArtistCard(x));
  }

  async searchAlbum(text) {
    const r = await this.request('GET', '/search', { query: { text, type: 'album', page: '0' } });
    return ((r.albums && r.albums.results) || []).map((x) => this.mapAlbumCard(x));
  }

  async like(track, on = true) {
    const { uid } = await this.getAccount();
    const action = on ? 'add-multiple' : 'remove';
    await this.request('POST', `/users/${uid}/likes/tracks/${action}`, { form: { 'track-ids': track.srcId } });
  }

  // ---------- Поток ----------

  async streamUrl(srcId) {
    const infos = (await this.request('GET', `/tracks/${srcId}/download-info`)) || [];
    const mp3 = infos.filter((i) => i.codec === 'mp3').sort((a, b) => b.bitrateInKbps - a.bitrateInKbps);
    const best = mp3[0] || infos[0];
    if (!best) throw new Error('Яндекс не отдал ссылку на трек (нет подписки или трек недоступен)');
    const xml = await this.request('GET', best.downloadInfoUrl);
    const info = { host: xmlValue(xml, 'host'), path: xmlValue(xml, 'path'), ts: xmlValue(xml, 'ts'), s: xmlValue(xml, 's') };
    if (!info.host || !info.path) throw new Error('Не удалось разобрать download-info Яндекса');
    return { url: signDownload(info), headers: {}, ttl: 50 * 60 * 1000 };
  }
}
