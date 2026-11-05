// Плеер: очередь, режимы «волна» и «список», перемотка, Media Session (медиаклавиши Windows).
const api = window.nyao;
import { spMode } from './sp-mode.js';
import { fillCover } from './covers.js';

// Честное перемешивание (Фишер — Йетс): sort(() => Math.random() - 0.5) даёт перекос
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


/** Ссылка на поток. Трек Spotify — тишина его длины (звук даёт устройство Spotify, см. spotify-sync.js) */
export function streamSrc(t) {
  // эфир Яндекс Радио: main отдаёт бесконечный поток (см. main/live-radio.js)
  if (t.source === 'live') return `nyao://live/${encodeURIComponent(t.station)}/${encodeURIComponent(t.stream)}`;
  const base = `nyao://stream/${encodeURIComponent(t.id)}`;
  if (t.source !== 'sp') return base;
  const q = new URLSearchParams({ d: String(Math.round(t.duration || 0)), t: t.title || '', a: t.artist || '' });
  if (spMode.fallback) q.set('x', '1'); // x=1 — сыграть копию из другого сервиса
  return `${base}?${q}`;
}

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
    this.queue = [];
    this.index = -1;
    this.mode = null; // 'wave' | 'list' | 'radio' (похожее) | 'live' (эфир станции)
    this.onAir = null; // что звучит в эфире: { title, artist, cover, yaId }
    this.label = '';
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' (плейлист) | 'one' (трек)
    this.liked = new Set();
    this.loadingMore = false;
    this.errors = 0;
    this.startedAt = 0;
    this.continueSimilar = true; // список доиграл — продолжать похожим
    this.queueGeneration = 0;
    this.forceContinue = false; // трек из поиска в режиме «дальше похожее»

    audio.addEventListener('ended', () => {
      // у эфира нет конца: поток оборвался — подключаемся заново к той же станции
      if (this.live) { this.load(); return; }
      // повтор трека: тот же трек с начала (в историю — как полное прослушивание)
      if (this.repeat === 'one' && this.current) {
        this.reportLeave(false);
        this.startedAt = Date.now();
        this.audio.currentTime = 0;
        this.audio.play().catch(() => {});
        return;
      }
      this.next(false);
    });
    audio.addEventListener('playing', () => {
      this.errors = 0;
      this.emit('state');
    });
    audio.addEventListener('pause', () => this.emit('state'));
    audio.addEventListener('timeupdate', () => this.emit('time'));
    audio.addEventListener('durationchange', () => this.emit('time'));
    audio.addEventListener('error', () => this.onError());

    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.toggle());
      ms.setActionHandler('pause', () => this.toggle());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('nexttrack', () => this.next(true));
      ms.setActionHandler('seekto', (d) => this.seek(d.seekTime));
    }
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get current() {
    return this.queue[this.index] || null;
  }

  get live() {
    return this.mode === 'live';
  }

  /** Станция → «трек» очереди эфира */
  static stationTrack(st, stream = st.stream) {
    const sub = (st.streams || []).find((x) => x.slug === stream);
    return {
      id: `live:${st.slug}/${stream}`, source: 'live', srcId: `${st.slug}/${stream}`, station: st.slug, stream,
      title: st.name, artist: st.desc || 'Прямой эфир', album: sub && sub.name ? `Эфир · ${sub.name}` : 'Прямой эфир',
      cover: st.logo, duration: 0, available: true, bg: st.bg, streams: st.streams || [], listeners: st.listeners || 0,
    };
  }

  /** Эфир: очередь — станции (‹ › листают их), играет одна выбранная */
  playLive(stations, index = 0, label = 'Радио') {
    if (!stations.length) return;
    ++this.queueGeneration;
    this.loadingMore = false;
    this.reportLeave(true);
    this.mode = 'live';
    this.label = label;
    this.queue = stations.map((st) => (st.source === 'live' ? st : Player.stationTrack(st)));
    this.index = Math.max(0, Math.min(index, this.queue.length - 1));
    this.onAir = null;
    this.load();
  }

  /** Другой поток той же станции (Москва / Россия / регион) */
  switchStream(stream) {
    const t = this.current;
    if (!this.live || !t || t.stream === stream) return;
    const st = { slug: t.station, name: t.title, desc: t.artist, logo: t.cover, bg: t.bg, streams: t.streams, listeners: t.listeners };
    this.queue[this.index] = Player.stationTrack(st, stream);
    this.onAir = null;
    this.load();
  }

  setOnAir(item) {
    const same = this.onAir && item && this.onAir.title === item.title && this.onAir.artist === item.artist;
    if (same || (!this.onAir && !item)) return;
    this.onAir = item;
    this.updateSession();
    this.emit('onair');
  }

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  async startWave() {
    const generation = ++this.queueGeneration;
    this.loadingMore = false;
    this.reportLeave(true);
    this.emit('loading', true);
    try {
      const tracks = await api.wave.start();
      if (generation !== this.queueGeneration) return;
      this.mode = 'wave';
      if (this.repeat === 'all') this.repeat = 'off'; // у волны нет конца — повтор плейлиста не имеет смысла
      this.label = 'Моя волна';
      this.queue = tracks;
      this.index = 0;
      this.load();
    } finally {
      this.emit('loading', false);
    }
  }

  // Перезапуск волны после смены настроек: текущий трек доигрывает, хвост очереди меняется
  async refreshWave() {
    if (this.mode !== 'wave') return;
    const generation = ++this.queueGeneration;
    this.loadingMore = false;
    const tracks = await api.wave.start();
    if (generation !== this.queueGeneration || this.mode !== 'wave') return;
    const cur = this.current;
    this.queue = cur ? [cur, ...tracks.filter((t) => t.id !== cur.id)] : tracks;
    this.index = 0;
    if (!cur) this.load();
    this.emit('queue');
  }

  playList(tracks, startIndex = 0, label = '') {
    const playable = tracks.filter((t) => t.available !== false);
    if (!playable.length) return;
    ++this.queueGeneration;
    this.loadingMore = false;
    this.reportLeave(true);
    this.forceContinue = false;
    const start = Math.max(0, playable.indexOf(tracks[startIndex]));
    this.mode = 'list';
    this.label = label;
    this.original = playable;
    if (this.shuffle) {
      const first = playable[start];
      this.queue = [first, ...shuffled(playable.filter((t) => t !== first))];
      this.index = 0;
    } else {
      this.queue = playable;
      this.index = start;
    }
    this.load();
  }

  /** Перемешивание включили или выключили посреди списка — очередь перестраивается сразу */
  setShuffle(on) {
    this.shuffle = !!on;
    if (this.mode === 'wave' || !this.queue.length) return;
    const cur = this.current;
    if (this.shuffle) {
      this.original = this.queue.slice();
      const rest = this.queue.filter((t, i) => i !== this.index);
      this.queue = cur ? [cur, ...shuffled(rest)] : shuffled(rest);
      this.index = 0;
    } else {
      const base = (this.original || []).slice();
      // что добавили в очередь уже вперемешку, остаётся — в конце
      const ids = new Set(base.map((t) => t.id));
      const extra = this.queue.filter((t) => !ids.has(t.id));
      this.queue = [...base, ...extra];
      const at = cur ? this.queue.findIndex((t) => t.id === cur.id) : -1;
      this.index = at > -1 ? at : 0;
    }
    this.emit('queue');
  }

  playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.reportLeave(true);
    this.index = i;
    this.load();
  }

  enqueueNext(track) {
    if (!this.current) return this.playList([track], 0, '');
    // если трек уже стоит дальше в очереди — переносим, а не дублируем
    const at = this.queue.findIndex((t, i) => i > this.index && t.id === track.id);
    if (at > -1) this.queue.splice(at, 1);
    this.queue.splice(this.index + 1, 0, track);
    this.emit('queue');
  }

  /** В конец очереди (в волне — сразу после уже подгруженных треков) */
  enqueueLast(track) {
    if (!this.current) return this.playList([track], 0, '');
    const at = this.queue.findIndex((t, i) => i > this.index && t.id === track.id);
    if (at > -1) this.queue.splice(at, 1);
    this.queue.push(track);
    this.emit('queue');
  }

  /** Убрать трек из очереди (играющий не трогаем) */
  removeAt(i) {
    if (i === this.index || i < 0 || i >= this.queue.length) return false;
    this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    this.emit('queue');
    return true;
  }

  /** Перетащить трек в очереди: from → to; играющий трек остаётся играть */
  move(from, to) {
    const n = this.queue.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
    const cur = this.queue[this.index];
    const [t] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, t);
    this.index = this.queue.indexOf(cur);
    this.emit('queue');
  }

  /** Тот же трек заново с того же места (например, переключились на копию из другого сервиса) */
  reload() {
    const t = this.current;
    if (!t) return;
    const pos = this.audio.currentTime;
    const play = !this.audio.paused;
    this.audio.src = streamSrc(t);
    if (pos > 1) {
      const once = () => {
        this.audio.removeEventListener('loadedmetadata', once);
        this.seek(pos);
      };
      this.audio.addEventListener('loadedmetadata', once);
    }
    if (play) this.audio.play().catch(() => {});
  }

  load() {
    const t = this.current;
    if (!t) return;
    // трек без обложки (VK) — шаблонный диск: его же покажут плеер, полноэкранный режим и шторка Windows
    fillCover(t);
    this.audio.src = streamSrc(t);
    this.audio.play().catch(() => {});
    this.startedAt = Date.now();
    if (this.live) {
      this.updateSession();
      this.emit('track');
      this.emit('queue');
      return;
    }
    if (this.mode === 'wave') api.wave.feedback('trackStarted', t, 0).catch(() => {});
    if (this.mode === 'radio') api.radio.feedback('trackStarted', t, 0).catch(() => {});
    const nxt = this.queue[this.index + 1];
    if (nxt) api.prepare(nxt.id).catch(() => {});
    this.updateSession();
    this.emit('track');
    this.emit('queue');
    this.maybeMore();
  }

  /** Список доиграл: дальше «похожее» на последний трек (радио), прошлые треки остаются в очереди */
  async continueWithSimilar() {
    const last = this.current;
    if (!last) return false;
    try {
      const tracks = await api.radio.start(last);
      const have = new Set(this.queue.map((t) => t.id));
      const more = tracks.filter((t) => !have.has(t.id));
      if (!more.length || this.current !== last) return false;
      this.mode = 'radio';
      this.forceContinue = false;
      this.label = `Похожее на «${last.title}»`;
      this.queue.push(...more);
      this.index++;
      this.load();
      return true;
    } catch {
      return false;
    }
  }

  /** Радио по треку: сам трек и бесконечное «похожее» */
  async startRadio(track) {
    const generation = ++this.queueGeneration;
    this.loadingMore = false;
    this.reportLeave(true);
    this.emit('loading', true);
    try {
      const tracks = await api.radio.start(track);
      if (generation !== this.queueGeneration) return;
      this.mode = 'radio';
      if (this.repeat === 'all') this.repeat = 'off';
      this.label = `Радио: ${track.title}`;
      this.queue = tracks;
      this.index = 0;
      this.load();
      this.emit('queue');
    } finally {
      this.emit('loading', false);
    }
  }

  async maybeMore() {
    if ((this.mode !== 'wave' && this.mode !== 'radio') || this.loadingMore) return;
    if (this.queue.length - this.index > 3) return;
    this.loadingMore = true;
    const generation = this.queueGeneration;
    try {
      const ids = this.queue.map((t) => t.id);
      const more = this.mode === 'radio' ? await api.radio.more(ids) : await api.wave.more(ids);
      if (generation !== this.queueGeneration) return;
      const have = new Set(this.queue.map((t) => t.id));
      this.queue.push(...more.filter((t) => !have.has(t.id)));
      this.emit('queue');
    } catch (e) {
      this.emit('error', e.message);
    } finally {
      if (generation === this.queueGeneration) this.loadingMore = false;
    }
  }

  /** Трек закончился или его переключили: отчёт волне Яндекса и запись в историю (для волны без повторов) */
  reportLeave(skipped) {
    const t = this.current;
    if (!t || t.source === 'live' || this.reported === this.startedAt) return;
    this.reported = this.startedAt;
    const played = Math.round(this.audio.currentTime || 0);
    // «пропущен» — только если переключили в первые полминуты, а не на последних секундах
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : t.duration || 0;
    const skip = skipped && played < Math.min(30, dur * 0.5);
    if (played >= 5 || skip) api.cloud && api.cloud.play({ track: t, listened: played, skipped: skip }).catch(() => {});
    if (this.mode === 'wave') api.wave.feedback(skipped ? 'skip' : 'trackFinished', t, played).catch(() => {});
    if (this.mode === 'radio') api.radio.feedback(skipped ? 'skip' : 'trackFinished', t, played).catch(() => {});
  }

  /**
   * Что играло — для восстановления после перезапуска. В волне — только сыгранное и текущий трек:
   * дальше волна подберёт свежие треки, а не повторит стоявшие в очереди.
   */
  snapshot() {
    if (this.live) return null; // эфир после перезапуска не восстанавливаем — он уже другой
    const cur = this.index;
    if (!this.queue.length || cur < 0) return null;
    const from = Math.max(0, cur - 100);
    const to = this.mode === 'wave' ? cur + 1 : Math.min(this.queue.length, cur + 301);
    return {
      tracks: this.queue.slice(from, to),
      index: cur - from,
      position: Math.floor(this.audio.currentTime || 0),
      label: this.label,
      mode: this.mode === 'wave' ? 'wave' : 'list',
      shuffle: this.shuffle,
      repeat: this.repeat,
      at: Date.now(),
    };
  }

  /** После запуска: прошлый трек на том же месте, на паузе. Радио по треку — как список (дальше «похожее») */
  restore(s) {
    if (!s || !Array.isArray(s.tracks) || !s.tracks.length || this.queue.length) return false;
    this.queue = s.tracks;
    this.index = Math.min(Math.max(0, s.index | 0), s.tracks.length - 1);
    this.mode = s.mode === 'wave' ? 'wave' : 'list';
    this.label = s.label || '';
    this.shuffle = !!s.shuffle;
    this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
    this.original = this.mode === 'list' ? s.tracks.slice() : undefined;
    const t = this.current;
    this.audio.src = streamSrc(t);
    const pos = Number(s.position) || 0;
    if (pos > 2) {
      const once = () => {
        this.audio.removeEventListener('loadedmetadata', once);
        this.seek(pos);
      };
      this.audio.addEventListener('loadedmetadata', once);
    }
    this.startedAt = Date.now();
    this.updateSession();
    this.emit('track');
    this.emit('queue');
    this.emit('state');
    this.maybeMore();
    return true;
  }

  /** «Продолжить с другого устройства»: включает трек и перематывает на нужное место */
  resume(track, position = 0, label = 'С другого устройства') {
    this.playList([track], 0, label);
    if (position > 3) {
      const seekOnce = () => {
        this.seek(position);
        this.audio.removeEventListener('loadedmetadata', seekOnce);
      };
      this.audio.addEventListener('loadedmetadata', seekOnce);
    }
  }

  async next(skipped = true) {
    if (!this.current) return;
    // переход сам по окончании трека (для Spotify: он перейдёт к следующему по списку без команды)
    this.lastAuto = !skipped;
    if (this.live) {
      this.index = (this.index + 1) % this.queue.length;
      this.onAir = null;
      this.load();
      return;
    }
    this.reportLeave(skipped);
    if (this.index + 1 >= this.queue.length) {
      if (this.mode === 'wave' || this.mode === 'radio') {
        await this.maybeMore();
        if (this.index + 1 >= this.queue.length) return;
      } else if (this.repeat !== 'off') {
        this.index = -1;
      } else if ((this.continueSimilar || this.forceContinue) && (await this.continueWithSimilar())) {
        return;
      } else {
        this.audio.pause();
        this.emit('state');
        return;
      }
    }
    this.index++;
    this.load();
  }

  prev() {
    if (this.live) {
      if (!this.queue.length) return;
      this.index = (this.index - 1 + this.queue.length) % this.queue.length;
      this.onAir = null;
      this.load();
      return;
    }
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.seek(0);
      return;
    }
    this.index--;
    this.load();
  }

  toggle() {
    if (!this.current) return;
    // эфир после паузы — с живого края, а не с места остановки
    if (this.live && this.audio.paused) { this.load(); return; }
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  seek(sec) {
    if (this.live) return;
    if (Number.isFinite(sec)) this.audio.currentTime = Math.max(0, sec);
  }

  /** Кнопка повтора: выкл → плейлист → трек. В волне плейлист бесконечный — там только выкл ↔ трек */
  cycleRepeat() {
    const order = this.mode === 'wave' ? ['off', 'one'] : ['off', 'all', 'one'];
    const i = order.indexOf(this.repeat);
    this.repeat = order[(i + 1) % order.length];
    this.emit('state');
    return this.repeat;
  }

  setVolume(v) {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  async dislike() {
    const t = this.current;
    if (!t || this.live) return;
    if (this.mode === 'wave') api.wave.feedback('dislike', t, Math.round(this.audio.currentTime)).catch(() => {});
    if (this.mode === 'radio') api.radio.feedback('dislike', t, Math.round(this.audio.currentTime)).catch(() => {});
    this.next(true);
  }

  /** Трек, который сейчас звучит в эфире, — как трек Яндекс Музыки (для лайка и «слушать целиком») */
  onAirTrack() {
    const a = this.onAir;
    if (!a || !a.yaId) return null;
    return { id: `ya:${a.yaId}`, source: 'ya', srcId: a.yaId, title: a.title, artist: a.artist, cover: a.cover, duration: 0, available: true };
  }

  async toggleLike(track = this.current) {
    if (track && track.source === 'live') track = this.onAirTrack();
    if (!track) return;
    const on = !this.liked.has(track.id);
    if (on) this.liked.add(track.id);
    else this.liked.delete(track.id);
    this.emit('like');
    try {
      const res = await api.like(track, on);
      // SoundCloud мог не пустить лайк сразу — в Nyao он стоит, а в SoundCloud дойдёт позже
      if (res && res.pending) this.emit('info', 'SoundCloud пока не принял лайк — отправлю позже сам');
      if (this.mode === 'wave' && on) api.wave.feedback('like', track, 0).catch(() => {});
    } catch (e) {
      if (on) this.liked.delete(track.id);
      else this.liked.add(track.id);
      this.emit('like');
      this.emit('error', e.message);
    }
  }

  onError() {
    const t = this.current;
    if (!t || !this.audio.src) return;
    this.errors++;
    if (this.live) {
      // эфир оборвался — переподключаемся к той же станции, после трёх неудач останавливаемся
      const stop = this.errors >= 3;
      api.onair.error().catch(() => '').then((why) => this.emit('error', `Эфир «${t.title}» ${stop ? 'не играет' : 'прервался — переподключаю'}${why ? `: ${why}` : ''}`));
      if (!stop) setTimeout(() => { if (this.current === t) this.load(); }, 2000);
      else this.emit('state');
      return;
    }
    const stop = this.errors >= 3;
    api.streamError(t.id).catch(() => null).then((reason) => {
      const why = reason ? `: ${reason.length > 220 ? reason.slice(0, 220) + '…' : reason}` : '';
      this.emit('error', `Не играет «${t.title}»${why}${stop ? '' : ' — пропускаю'}`);
    });
    // После трёх ошибок подряд останавливаемся, чтобы не пролистать всю очередь
    if (!stop) { const startedAt = this.startedAt; setTimeout(() => { if (this.current === t && this.startedAt === startedAt) this.next(true); }, 1500); }
    else this.emit('state');
  }

  updateSession() {
    const t = this.current;
    if (!t || !('mediaSession' in navigator)) return;
    if (t.source === 'live') {
      const a = this.onAir;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: a ? a.title : t.title,
        artist: a ? a.artist : 'Прямой эфир',
        album: t.title,
        artwork: (a && a.cover) || t.cover ? [{ src: (a && a.cover) || t.cover, sizes: '400x400' }] : []
      });
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album || ({ ya: 'Яндекс Музыка', sc: 'SoundCloud' }[t.source] || 'YouTube Music'),
      artwork: t.cover ? [{ src: t.cover, sizes: '400x400' }] : []
    });
  }
}
