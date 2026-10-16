// Плеер: очередь, режимы «волна» и «список», перемотка, Media Session (медиаклавиши Windows).
const api = window.nyao;

export class Player extends EventTarget {
  constructor(audio) {
    super();
    this.audio = audio;
    this.queue = [];
    this.index = -1;
    this.mode = null; // 'wave' | 'list'
    this.label = '';
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' (плейлист) | 'one' (трек)
    this.liked = new Set();
    this.loadingMore = false;
    this.errors = 0;
    this.startedAt = 0;
    this.continueSimilar = true; // список доиграл — продолжать похожим
    this.forceContinue = false; // трек из поиска в режиме «дальше похожее»

    audio.addEventListener('ended', () => {
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

  get playing() {
    return !this.audio.paused && !this.audio.ended;
  }

  async startWave() {
    this.reportLeave(true);
    this.emit('loading', true);
    try {
      const tracks = await api.wave.start();
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
    const tracks = await api.wave.start();
    const cur = this.current;
    this.queue = cur ? [cur, ...tracks.filter((t) => t.id !== cur.id)] : tracks;
    this.index = 0;
    if (!cur) this.load();
    this.emit('queue');
  }

  playList(tracks, startIndex = 0, label = '') {
    const playable = tracks.filter((t) => t.available !== false);
    if (!playable.length) return;
    this.reportLeave(true);
    this.forceContinue = false;
    const start = Math.max(0, playable.indexOf(tracks[startIndex]));
    this.mode = 'list';
    this.label = label;
    if (this.shuffle) {
      const first = playable[start];
      const rest = playable.filter((t) => t !== first).sort(() => Math.random() - 0.5);
      this.queue = [first, ...rest];
      this.index = 0;
    } else {
      this.queue = playable;
      this.index = start;
    }
    this.load();
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

  load() {
    const t = this.current;
    if (!t) return;
    this.audio.src = `nyao://stream/${encodeURIComponent(t.id)}`;
    this.audio.play().catch(() => {});
    this.startedAt = Date.now();
    if (this.mode === 'wave') api.wave.feedback('trackStarted', t, 0).catch(() => {});
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
    this.reportLeave(true);
    this.emit('loading', true);
    try {
      const tracks = await api.radio.start(track);
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
    try {
      const ids = this.queue.map((t) => t.id);
      const more = this.mode === 'radio' ? await api.radio.more(ids) : await api.wave.more(ids);
      const have = new Set(this.queue.map((t) => t.id));
      this.queue.push(...more.filter((t) => !have.has(t.id)));
      this.emit('queue');
    } catch (e) {
      this.emit('error', e.message);
    } finally {
      this.loadingMore = false;
    }
  }

  /** Трек закончился или его переключили: отчёт волне Яндекса и запись в историю (для волны без повторов) */
  reportLeave(skipped) {
    const t = this.current;
    if (!t || this.reported === this.startedAt) return;
    this.reported = this.startedAt;
    const played = Math.round(this.audio.currentTime || 0);
    // «пропущен» — только если переключили в первые полминуты, а не на последних секундах
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : t.duration || 0;
    const skip = skipped && played < Math.min(30, dur * 0.5);
    if (played >= 5 || skip) api.cloud && api.cloud.play({ track: t, listened: played, skipped: skip }).catch(() => {});
    if (this.mode === 'wave') api.wave.feedback(skipped ? 'skip' : 'trackFinished', t, played).catch(() => {});
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
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.seek(0);
      return;
    }
    this.index--;
    this.load();
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  seek(sec) {
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
    if (!t) return;
    if (this.mode === 'wave') api.wave.feedback('dislike', t, Math.round(this.audio.currentTime)).catch(() => {});
    this.next(true);
  }

  async toggleLike(track = this.current) {
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
    const stop = this.errors >= 3;
    api.streamError(t.id).catch(() => null).then((reason) => {
      const why = reason ? `: ${reason.length > 220 ? reason.slice(0, 220) + '…' : reason}` : '';
      this.emit('error', `Не играет «${t.title}»${why}${stop ? '' : ' — пропускаю'}`);
    });
    // После трёх ошибок подряд останавливаемся, чтобы не пролистать всю очередь
    if (!stop) setTimeout(() => this.next(true), 1500);
    else this.emit('state');
  }

  updateSession() {
    const t = this.current;
    if (!t || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      album: t.album || ({ ya: 'Яндекс Музыка', sc: 'SoundCloud' }[t.source] || 'YouTube Music'),
      artwork: t.cover ? [{ src: t.cover, sizes: '400x400' }] : []
    });
  }
}
