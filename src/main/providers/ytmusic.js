// Провайдер YouTube Music через youtubei.js (внутреннее API InnerTube).
// Метаданные (главная, лайки, плейлисты, поиск, радио) идут через сессию с cookies аккаунта,
// а прямую ссылку на аудио берём отдельной анонимной сессией, перебирая клиентов:
// часть клиентов YouTube требует PO-токен и отдаёт 403, поэтому каждую ссылку проверяем.
import vm from 'node:vm';
import { Innertube, Platform, UniversalCache, Constants } from 'youtubei.js';

// youtubei.js с версии 15+ не исполняет JS плеера сам — даём ему изолированный вычислитель.
Platform.shim.eval = (data) => {
  const code = `(function(){\n${data.output}\n})()`;
  return vm.runInNewContext(code, Object.create(null), { timeout: 5000 });
};

// Порядок перебора: сначала клиенты, которым обычно не нужен PO-токен
export const STREAM_CLIENTS = ['ANDROID_VR', 'VISIONOS', 'TV', 'IOS', 'TV_SIMPLY', 'WEB_EMBEDDED', 'YTMUSIC', 'WEB'];
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// googlevideo сверяет User-Agent с клиентом, для которого выдана ссылка: чужой UA → 403
export function streamHeaders(client) {
  const def = Constants.CLIENTS && Constants.CLIENTS[client];
  const headers = { 'User-Agent': (def && def.USER_AGENT) || DESKTOP_UA };
  if (client === 'YTMUSIC') {
    headers.Origin = 'https://music.youtube.com';
    headers.Referer = 'https://music.youtube.com/';
  } else if (client === 'WEB' || client === 'WEB_EMBEDDED') {
    headers.Origin = 'https://www.youtube.com';
    headers.Referer = 'https://www.youtube.com/';
  }
  return headers;
}

export function bestThumb(list, size = 400) {
  const arr = Array.isArray(list) ? list : (list && list.contents) || [];
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => (b.width || 0) - (a.width || 0));
  let url = sorted[0].url;
  // Обложки YTM масштабируются параметром в URL
  url = url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`);
  return url.startsWith('//') ? 'https:' + url : url;
}

function text(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  return t.text != null ? String(t.text) : String(t);
}

export function mapItem(item) {
  if (!item) return null;
  const videoId = item.video_id || item.id || (item.endpoint && item.endpoint.payload && item.endpoint.payload.videoId);
  if (!videoId) return null;
  const artists = item.artists && item.artists.length ? item.artists.map((a) => a.name).join(', ') : text(item.author) || (item.authors || []).map((a) => a.name).join(', ');
  const thumbs = item.thumbnails || item.thumbnail;
  const firstArtist = (item.artists || item.authors || []).find((a) => a && a.channel_id);
  return {
    id: `yt:${videoId}`,
    source: 'yt',
    srcId: videoId,
    artistRef: firstArtist ? `yt:${firstArtist.channel_id}` : null,
    albumRef: item.album && item.album.id ? `yt:${item.album.id}` : null,
    title: text(item.title) || 'Без названия',
    artist: artists || 'YouTube Music',
    album: (item.album && item.album.name) || '',
    duration: (item.duration && item.duration.seconds) || 0,
    cover: bestThumb(thumbs),
    available: true
  };
}

function isSong(item) {
  if (!item) return false;
  const t = item.item_type;
  if (t && !['song', 'video', 'non_music_track'].includes(t)) return false;
  return !!(item.video_id || (item.id && (!t || t === 'song' || t === 'video')));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class YTMusicProvider {
  constructor({ cookie = null, cacheDir = null, fetch = globalThis.fetch, factory = null } = {}) {
    this.cookie = cookie;
    this.cacheDir = cacheDir;
    this.fetch = fetch;
    this.factory = factory || ((opts) => Innertube.create(opts));
    this.yt = null;
    this.anon = null;
    this.likedCache = null;
    this.blocked = new Map();
  }

  get loggedIn() {
    return !!this.cookie;
  }

  setCookie(cookie) {
    this.cookie = cookie;
    this.yt = null;
    this.likedCache = null;
  }

  cache() {
    return this.cacheDir ? new UniversalCache(true, this.cacheDir) : undefined;
  }

  async client() {
    if (!this.yt) {
      this.yt = await this.factory({
        cookie: this.cookie || undefined,
        cache: this.cache(),
        fetch: this.fetch,
        lang: 'ru',
        location: 'RU',
        retrieve_player: false,
        generate_session_locally: false
      });
    }
    return this.yt;
  }

  async streamClient() {
    if (!this.anon) {
      this.anon = await this.factory({ cache: this.cache(), fetch: this.fetch, retrieve_player: true, generate_session_locally: true });
    }
    return this.anon;
  }

  async getAccount() {
    if (!this.cookie) return null;
    try {
      const yt = await this.client();
      const info = await yt.account.getInfo();
      const header = info && info.contents && info.contents.contents && info.contents.contents[0];
      const name = header && (text(header.account_name) || text(header.title));
      return { name: name || 'YouTube Music' };
    } catch {
      return { name: 'YouTube Music' };
    }
  }

  async likedTracks(limit = 300) {
    if (this.likedCache && Date.now() - this.likedCache.at < 10 * 60 * 1000) return this.likedCache.tracks;
    const tracks = await this.playlistTracks('yt:LM', limit);
    this.likedCache = { at: Date.now(), tracks };
    return tracks;
  }

  async playlistTracks(playlistId, limit = 500) {
    const yt = await this.client();
    let page = await yt.music.getPlaylist(playlistId.replace(/^yt:/, ''));
    const out = [];
    for (;;) {
      for (const item of page.items || []) {
        const t = isSong(item) ? mapItem(item) : null;
        if (t) out.push(t);
      }
      if (out.length >= limit || !page.has_continuation) break;
      page = await page.getContinuation();
    }
    return out.slice(0, limit);
  }

  async playlists() {
    const yt = await this.client();
    const lib = await yt.music.getLibrary();
    const items = [];
    for (const section of lib.contents || []) {
      items.push(...(section.items || section.contents || []));
    }
    const lists = items
      .filter((i) => i && (i.item_type === 'playlist' || /^(VL)?(PL|RD|LM|OLAK)/.test(i.id || '')))
      .map((i) => ({
        id: `yt:${String(i.id).replace(/^VL/, '')}`,
        source: 'yt',
        title: text(i.title),
        count: parseInt(String(text(i.item_count) || text(i.subtitle)).replace(/\D/g, ''), 10) || 0,
        cover: bestThumb(i.thumbnail || i.thumbnails, 300)
      }));
    const hasLiked = lists.some((l) => l.id === 'yt:LM');
    if (!hasLiked) lists.unshift({ id: 'yt:LM', source: 'yt', title: 'Понравившиеся', count: 0, cover: null });
    return lists;
  }

  async home() {
    const yt = await this.client();
    const feed = await yt.music.getHomeFeed();
    return (feed.sections || [])
      .filter((s) => s.contents && s.header)
      .map((s) => ({
        title: text(s.header.title),
        tracks: s.contents.filter(isSong).map(mapItem).filter(Boolean),
        playlists: s.contents
          .filter((i) => i.item_type === 'playlist' || i.item_type === 'album')
          .map((i) => ({ id: `yt:${String(i.id).replace(/^VL/, '')}`, source: 'yt', title: text(i.title), sub: text(i.subtitle), cover: bestThumb(i.thumbnail, 300), kind: i.item_type }))
      }))
      .filter((s) => s.tracks.length || s.playlists.length);
  }

  async search(query) {
    const yt = await this.client();
    const res = await yt.music.search(query, { type: 'song' });
    const shelf = res.songs || (res.contents || [])[0];
    return ((shelf && shelf.contents) || []).filter(isSong).map(mapItem).filter(Boolean);
  }

  async radio(videoId) {
    const yt = await this.client();
    const panel = await yt.music.getUpNext(videoId, true);
    return (panel.contents || [])
      .map((c) => c.primary || c)
      .filter((c) => c && c.video_id)
      .map(mapItem)
      .filter(Boolean);
  }

  // Пул треков для подмешивания в «Мою волну».
  // favorite: часть пула — сами лайки; discover: только радио, без уже лайкнутого.
  async wavePool({ diversity = 'favorite', exclude = new Set(), size = 25 } = {}) {
    let liked = [];
    try {
      liked = await this.likedTracks();
    } catch {
      liked = [];
    }
    const likedIds = new Set(liked.map((t) => t.id));
    const pool = [];
    const seeds = shuffle(liked).slice(0, 3);
    if (!seeds.length) {
      // Нет лайков — берём «быстрый выбор» с главной
      const home = await this.home().catch(() => []);
      seeds.push(...shuffle(home.flatMap((s) => s.tracks)).slice(0, 3));
    }
    for (const seed of seeds) {
      try {
        const radio = await this.radio(seed.srcId);
        for (const t of radio) {
          if (exclude.has(t.id) || pool.some((p) => p.id === t.id)) continue;
          if (diversity === 'discover' && likedIds.has(t.id)) continue;
          pool.push(t);
        }
      } catch {
        // один сид не сработал — пробуем следующий
      }
      if (pool.length >= size) break;
    }
    if (diversity === 'favorite') {
      const fav = shuffle(liked.filter((t) => !exclude.has(t.id))).slice(0, Math.ceil(size / 3));
      pool.push(...fav);
    }
    return shuffle(pool).slice(0, size);
  }

  // ---------- Исполнители и альбомы ----------

  static albumCard(i, kindHint) {
    const sub = text(i.subtitle);
    const kind = kindHint || (/сингл|single|ep\b/i.test(sub) ? 'single' : 'album');
    return {
      ref: `yt:${i.id}`,
      source: 'yt',
      title: text(i.title),
      year: i.year || (sub.match(/\b(19|20)\d{2}\b/) || [null])[0],
      kind,
      cover: bestThumb(i.thumbnail || i.thumbnails, 300),
      artist: (i.artists || []).map((a) => a.name).join(', ') || (i.author && i.author.name) || ''
    };
  }

  static artistCard(i) {
    return { ref: `yt:${i.id}`, source: 'yt', name: text(i.title) || text(i.name), cover: bestThumb(i.thumbnail || i.thumbnails, 200) };
  }

  async artist(channelId) {
    const yt = await this.client();
    const a = await yt.music.getArtist(channelId);
    const h = a.header || {};
    const out = {
      ref: `yt:${channelId}`,
      name: text(h.title),
      cover: bestThumb(h.thumbnail || h.foreground_thumbnail, 1200),
      listeners: null,
      description: text(h.description),
      popular: [],
      albums: [],
      similar: []
    };
    for (const s of a.sections || []) {
      const title = text(s.title || (s.header && s.header.title)).toLowerCase();
      const items = s.contents || [];
      if (!out.popular.length && items.some(isSong)) {
        out.popular = items.filter(isSong).map(mapItem).filter(Boolean);
        continue;
      }
      if (items.some((i) => i.item_type === 'artist')) {
        out.similar.push(...items.filter((i) => i.item_type === 'artist').map(YTMusicProvider.artistCard));
      } else if (items.some((i) => i.item_type === 'album' || /^MPRE/.test(i.id || ''))) {
        const kind = /сингл|single/.test(title) ? 'single' : 'album';
        out.albums.push(...items.filter((i) => /^MPRE/.test(i.id || '')).map((i) => YTMusicProvider.albumCard(i, kind)));
      }
    }
    // Треки страницы исполнителя часто приходят без артиста — подставляем
    out.popular.forEach((t) => {
      if (!t.artistRef) t.artistRef = out.ref;
      if (t.artist === 'YouTube Music') t.artist = out.name;
    });
    return out;
  }

  async album(browseId) {
    const yt = await this.client();
    const a = await yt.music.getAlbum(browseId);
    const h = a.header || {};
    const artistName = text(h.strapline_text_one) || (h.author && h.author.name) || '';
    const artistRef = h.author && h.author.channel_id ? `yt:${h.author.channel_id}` : null;
    const thumbs = (h.thumbnail && (h.thumbnail.contents || h.thumbnail)) || h.thumbnails;
    const cover = bestThumb(thumbs, 600);
    const tracks = (a.contents || []).filter(isSong).map(mapItem).filter(Boolean).map((t) => ({
      ...t,
      artist: t.artist === 'YouTube Music' ? artistName : t.artist,
      artistRef: t.artistRef || artistRef,
      albumRef: `yt:${browseId}`,
      album: text(h.title),
      cover: t.cover || cover
    }));
    const sub = text(h.subtitle);
    return {
      ref: `yt:${browseId}`,
      title: text(h.title),
      artist: artistName,
      artistRef,
      year: h.year || (sub.match(/\b(19|20)\d{2}\b/) || [null])[0],
      kind: /сингл|single|ep\b/i.test(sub) ? 'single' : 'album',
      cover,
      tracks
    };
  }

  async searchArtist(name) {
    const yt = await this.client();
    const r = await yt.music.search(name, { type: 'artist' });
    const shelf = r.artists || (r.contents || [])[0];
    return ((shelf && shelf.contents) || []).filter((i) => i.item_type === 'artist' || /^UC/.test(i.id || '')).map(YTMusicProvider.artistCard);
  }

  async searchAlbum(query) {
    const yt = await this.client();
    const r = await yt.music.search(query, { type: 'album' });
    const shelf = r.albums || (r.contents || [])[0];
    return ((shelf && shelf.contents) || []).filter((i) => /^MPRE/.test(i.id || '')).map((i) => YTMusicProvider.albumCard(i));
  }

  async like(track, on = true) {
    // Не через yt.interact: в youtubei.js 18 он шлёт target строкой и через клиент TV,
    // который не принимает вход по cookies → 400. Шлём как веб-версия YouTube Music.
    if (!this.cookie) throw new Error('Войди в YouTube Music, чтобы ставить лайки');
    const yt = await this.client();
    const endpoint = on ? '/like/like' : '/like/removelike';
    const res = await yt.actions.execute(endpoint, { client: 'YTMUSIC', target: { videoId: track.srcId } });
    if (res && res.success === false) throw new Error(`YouTube Music не принял лайк (HTTP ${res.status_code})`);
    this.likedCache = null;
  }

  // Клиент, на котором googlevideo начал отвечать 403, отправляется «на скамейку» на 10 минут.
  // Если заблокированы все — пересоздаём анонимную сессию (новые visitor data).
  reportBlocked(client) {
    if (!client) return;
    this.blocked.set(client, Date.now() + 10 * 60_000);
    const now = Date.now();
    if (STREAM_CLIENTS.every((c) => (this.blocked.get(c) || 0) > now)) this.resetStreamSession();
  }

  resetStreamSession() {
    this.anon = null;
    this.blocked.clear();
    this.sessionResets = (this.sessionResets || 0) + 1;
  }

  clientOrder(exclude = []) {
    const now = Date.now();
    return STREAM_CLIENTS.filter((c) => !exclude.includes(c)).sort((a, b) => ((this.blocked.get(a) || 0) > now) - ((this.blocked.get(b) || 0) > now));
  }

  // Прямая ссылка на аудиопоток.
  // check(url, headers) => Promise<number> — HTTP-статус пробного запроса (0 — сеть не ответила).
  // exclude — клиенты, которые для этого трека уже отдали 403.
  async streamUrl(videoId, check, log = () => {}, { exclude = [] } = {}) {
    const errors = [];
    for (let round = 0; round < 2; round++) {
      const yt = await this.streamClient();
      for (const client of this.clientOrder(exclude)) {
        try {
          const info = await yt.getBasicInfo(videoId, { client });
          const ps = info.playability_status;
          if (ps && ps.status && ps.status !== 'OK') throw new Error(`playability ${ps.status}${ps.reason ? ': ' + ps.reason : ''}`);
          const format = info.chooseFormat({ type: 'audio', quality: 'best', format: 'any' });
          const url = await format.decipher(yt.session.player);
          if (!url) throw new Error('у формата нет прямой ссылки (вероятно, только SABR)');
          const headers = streamHeaders(client);
          if (check) {
            const status = await check(url, headers);
            if (status === 403) this.reportBlocked(client);
            if (status !== 200 && status !== 206) throw new Error(`проверка ссылки: HTTP ${status || 'нет ответа'}`);
          }
          const expire = Number(new URL(url).searchParams.get('expire')) * 1000;
          const ttl = expire ? Math.max(60_000, expire - Date.now() - 5 * 60_000) : 30 * 60_000;
          log(`${videoId} ${client}: OK (${format.mime_type})`);
          return { url, headers, ttl, mime: format.mime_type, client };
        } catch (e) {
          log(`${videoId} ${client}: ${e.message}`);
          errors.push(`${client}: ${e.message}`);
        }
      }
      // Ни один клиент не подошёл — пробуем ещё раз со свежей сессией
      if (round === 0) {
        log(`${videoId}: все клиенты отказали, пересоздаю сессию`);
        this.resetStreamSession();
        exclude = [];
      }
    }
    throw new Error('YouTube не отдал поток. ' + errors.slice(-4).join(' | '));
  }
}
