// Связка плеера Nyao ↔ устройство Spotify на ПК (тот же принцип, что SpotifySync.kt на Android).
// В <audio> трек Spotify — тишина той же длины: очередь, переходы, перемотка, медиаклавиши и трей
// работают как у остальных сервисов, а здесь всё повторяется на устройстве Spotify,
// и позиция <audio> подстраивается под настоящую позицию Spotify.

import { spMode } from './sp-mode.js';

// трек Spotify, который играет сам Spotify (а не копия из другого сервиса)
// (копии существуют только пока fallback включён — app.js держит это правило)
const isSp = (t) => !!t && t.source === 'sp' && !spMode.fallback;

export class SpotifySync {
  constructor(player, api, { onMessage } = {}) {
    this.player = player;
    this.api = api;
    this.msg = onMessage || (() => {});
    this.loaded = null; // id трека, который Spotify должен играть
    this.confirmed = false; // Spotify сообщил, что играет наш трек
    this.lastCommand = 0;
    this.spList = []; // треки, отданные Spotify одним списком (он подгружает следующие заранее)
    this.startPos = 0; // откуда начинать: пока Spotify грузит, ползунок стоит здесь
    this.autoWaitUntil = 0;
    this.snap = null;
    this.status = { state: 'idle' };
    this.modesSet = false;
    this.starting = 0;
    this.pendingSince = 0;
  }

  start() {
    if (!this.api) return;
    const p = this.player;
    p.addEventListener('track', () => this.onTrack());
    p.audio.addEventListener('play', () => this.reconcile());
    p.audio.addEventListener('pause', () => this.reconcile());
    p.audio.addEventListener('seeked', () => this.onSeeked());
    p.audio.addEventListener('volumechange', () => {
      if (this.loaded) this.api.volume(p.audio.muted ? 0 : p.audio.volume).catch(() => {});
    });
    this.api.onState((st) => {
      if (st.status) this.status = st.status;
      if ('snapshot' in st) this.snap = st.snapshot;
      if (st.error && isSp(p.current)) {
        // нет Premium или плеер не запустился — дальше треки Spotify играют копиями из других сервисов
        if (st.error.kind === 'account' || st.error.kind === 'init') {
          this.toCopy(st.error.kind === 'account' ? 'Spotify без Premium — играю те же треки из других сервисов' : 'Плеер Spotify не запустился — играю те же треки из других сервисов');
          return;
        }
        this.msg(st.error.message);
        if (['auth', 'engine'].includes(st.error.kind)) this.stopSp();
        else if (st.error.kind === 'playback') this.skipSp();
      }
    });
    setInterval(() => {
      try {
        this.tick();
      } catch {
        // сверка не критична
      }
    }, 500);
    // плеер Spotify запускаем заранее — первый трек не ждёт загрузки SDK
    this.api.prewarm().catch(() => {});
  }

  get audio() {
    return this.player.audio;
  }

  isTrack(snap, id) {
    return !!snap && (snap.uri === `spotify:track:${id}` || snap.linked === `spotify:track:${id}`);
  }

  posNow(snap) {
    if (!snap) return 0;
    if (snap.paused) return snap.position;
    const p = snap.position + (Date.now() - snap.at);
    return snap.duration > 0 ? Math.min(p, snap.duration) : p;
  }

  /** Текущий трек и идущие за ним подряд треки Spotify, до 20 */
  upcoming() {
    const q = this.player.queue;
    const out = [];
    for (let i = this.player.index; i >= 0 && i < q.length && out.length < 20; i++) {
      if (!isSp(q[i])) break;
      out.push(q[i].srcId);
    }
    return out;
  }

  command(fn) {
    this.lastCommand = Date.now();
    Promise.resolve().then(fn).catch(() => {});
  }

  onTrack() {
    const cur = this.player.current;
    // тот же трек заново (повтор, дважды подряд) — включаем в Spotify с начала
    if (isSp(cur) && this.loaded === cur.srcId) this.loaded = null;
    this.reconcile(true);
  }

  onSeeked() {
    const cur = this.player.current;
    if (!isSp(cur) || cur.srcId !== this.loaded) return;
    const ms = this.audio.currentTime * 1000;
    if (!this.confirmed) {
      // перемотали, пока Spotify грузится — начнём с нового места
      this.startPos = ms;
      return;
    }
    // свою подстройку под позицию Spotify обратно в Spotify не шлём
    if (this.snap && this.isTrack(this.snap, this.loaded) && Math.abs(this.posNow(this.snap) - ms) < 1200) return;
    this.command(() => this.api.seek(ms));
  }

  reconcile(fromTrack = false) {
    const cur = this.player.current;
    const auto = fromTrack && this.player.lastAuto;
    if (fromTrack) this.player.lastAuto = false;
    if (!isSp(cur)) {
      if (this.loaded) {
        this.loaded = null;
        this.starting++;
        this.command(() => this.api.pause());
      }
      return;
    }
    const id = cur.srcId;
    const wantPlay = !this.audio.paused;
    if (!wantPlay) {
      // на паузе: глушим Spotify; если трек сменили на паузе — включим его, когда нажмут «играть»
      if (this.loaded === id && this.confirmed) this.command(() => this.api.pause());
      return;
    }
    if (this.loaded === id) {
      if (this.confirmed) this.command(() => this.api.resume());
      else this.pendingSince = Date.now();
      return;
    }
    const prev = this.loaded;
    const snap = this.snap;
    // Spotify сам уже перешёл на этот трек по общему списку
    if (prev && this.spList.includes(id) && this.isTrack(snap, id) && !snap.paused) {
      this.loaded = id;
      this.confirmed = true;
      return;
    }
    // следующий по списку: Spotify его уже подгрузил
    const pi = prev ? this.spList.indexOf(prev) : -1;
    if (prev && this.confirmed && pi >= 0 && this.spList[pi + 1] === id && this.audio.currentTime < 1.5) {
      this.loaded = id;
      this.confirmed = false;
      this.pendingSince = Date.now();
      this.startPos = 0;
      if (auto) this.autoWaitUntil = Date.now() + 3000; // доиграл сам — Spotify перейдёт без команды
      else this.command(() => this.api.next());
      return;
    }
    this.autoWaitUntil = 0;
    this.loaded = id;
    this.confirmed = false;
    this.pendingSince = Date.now();
    this.startPos = this.audio.currentTime * 1000;
    this.spList = this.upcoming();
    if (!this.spList.length) this.spList = [id];
    const uris = this.spList.map((x) => `spotify:track:${x}`);
    const token = ++this.starting;
    this.lastCommand = Date.now();
    this.api.play(uris, this.startPos).then(() => {
      // пока шёл запрос, трек успели пропустить — Spotify не должен заиграть поверх
      if (token !== this.starting || this.loaded !== id) this.api.pause().catch(() => {});
      else this.api.volume(this.audio.muted ? 0 : this.audio.volume).catch(() => {});
    }).catch((e) => {
      if (token !== this.starting || this.loaded !== id) return;
      this.loaded = null;
      this.msg(e.message || 'Spotify не включил трек');
      this.stopSp();
    });
  }

  tick() {
    const cur = this.player.current;
    const snap = this.snap;
    const now = Date.now();
    const id = this.loaded;
    if (!isSp(cur) || !id || cur.srcId !== id) {
      // в Nyao сейчас не трек Spotify, а Spotify играет (догрузился уже пропущенный) — глушим
      if (snap && !snap.paused && now - this.lastCommand > 800 && this.status.state === 'ready') this.command(() => this.api.pause());
      return;
    }
    const playing = !this.audio.paused;
    if (!this.confirmed && playing && now - this.pendingSince > 45_000) {
      this.msg('Spotify не подтвердил запуск — нажми «играть», чтобы повторить');
      this.stopSp();
      return;
    }
    if (this.isTrack(snap, id)) {
      if (!this.confirmed && !snap.paused) {
        this.confirmed = true;
        if (!this.modesSet) {
          this.modesSet = true;
          this.api.modes().catch(() => {});
        }
      }
      if (!this.confirmed) return this.holdStart();
      if (!snap.paused && !playing) {
        if (now - this.lastCommand > 1000) this.command(() => this.api.pause());
      } else if (!snap.paused) {
        // только по свежему состоянию: после перемотки Spotify сообщает новое место не сразу
        if (snap.at > this.lastCommand) {
          const d = this.posNow(snap) - this.audio.currentTime * 1000;
          if (Math.abs(d) > 1500) this.audio.currentTime = this.posNow(snap) / 1000;
        }
      } else if (playing && now - this.lastCommand > 2500 && snap.at > this.lastCommand) {
        // поставили на паузу из самого Spotify
        const nearEnd = snap.duration > 0 && snap.duration - snap.position < 1500;
        if (!nearEnd) this.audio.pause();
      }
    } else if (!this.confirmed) {
      this.holdStart();
      if (this.autoWaitUntil && now > this.autoWaitUntil) {
        this.autoWaitUntil = 0;
        this.loaded = null;
        this.reconcile();
      }
    } else if (playing && now - this.lastCommand > 4000) {
      // Spotify перешёл к следующему треку списка чуть раньше Nyao — это не «другое устройство»
      const next = this.spList[this.spList.indexOf(id) + 1];
      if (next && this.isTrack(snap, next)) return;
      this.loaded = null;
      this.confirmed = false;
      this.audio.pause();
      this.msg('Spotify играет на другом устройстве — поставил Nyao на паузу');
    }
  }

  /** Пока Spotify грузит трек, ползунок Nyao не убегает вперёд */
  holdStart() {
    if (!this.audio.paused && this.audio.currentTime * 1000 - this.startPos > 800) this.audio.currentTime = this.startPos / 1000;
  }

  /** Не играет один трек — переходим к следующему (волна не должна вставать из-за одного трека) */
  skipSp() {
    this.loaded = null;
    this.confirmed = false;
    this.starting++;
    this.command(() => this.api.pause());
    this.player.next(true);
  }

  /** Переключить текущий трек Spotify на копию из другого сервиса, с того же места */
  toCopy(note) {
    spMode.fallback = true;
    this.loaded = null;
    this.confirmed = false;
    this.starting++;
    this.command(() => this.api.pause());
    if (note) this.msg(note);
    if (this.player.current) this.player.reload();
  }

  stopSp() {
    this.loaded = null;
    this.confirmed = false;
    this.starting++;
    this.audio.pause();
    this.command(() => this.api.pause());
  }
}
