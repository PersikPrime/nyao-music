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
    this.repeat = false;
    this.liked = new Set();
    this.loadingMore = false;
    this.errors = 0;
    this.startedAt = 0;

    audio.addEventListener('ended', () => this.next(false));
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
    this.emit('loading', true);
    try {
      const tracks = await api.wave.start();
      this.mode = 'wave';
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
    this.queue.splice(this.index + 1, 0, track);
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

  async maybeMore() {
    if (this.mode !== 'wave' || this.loadingMore) return;
    if (this.queue.length - this.index > 3) return;
    this.loadingMore = true;
    try {
      const more = await api.wave.more(this.queue.map((t) => t.id));
      const have = new Set(this.queue.map((t) => t.id));
      this.queue.push(...more.filter((t) => !have.has(t.id)));
      this.emit('queue');
    } catch (e) {
      this.emit('error', e.message);
    } finally {
      this.loadingMore = false;
    }
  }

  reportLeave(skipped) {
    const t = this.current;
    if (this.mode !== 'wave' || !t) return;
    const played = Math.round(this.audio.currentTime || 0);
    api.wave.feedback(skipped ? 'skip' : 'trackFinished', t, played).catch(() => {});
  }

  async next(skipped = true) {
    if (!this.current) return;
    this.reportLeave(skipped);
    if (this.index + 1 >= this.queue.length) {
      if (this.mode === 'wave') {
        await this.maybeMore();
        if (this.index + 1 >= this.queue.length) return;
      } else if (this.repeat) {
        this.index = -1;
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
      await api.like(track, on);
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
      album: t.album || (t.source === 'ya' ? 'Яндекс Музыка' : 'YouTube Music'),
      artwork: t.cover ? [{ src: t.cover, sizes: '400x400' }] : []
    });
  }
}
