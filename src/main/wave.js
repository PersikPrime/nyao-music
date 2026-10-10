// Общая «Моя волна»: основа — поток Яндекса, в него подмешиваются треки YouTube Music.
// Доля YTM задаётся в процентах; если войти только в один сервис, волна строится из него одного.
// Недавно звучавшие треки (история всех устройств) волна пропускает, а начало каждый раз новое.

export function interleave(base, extra, sharePercent) {
  const share = Math.max(0, Math.min(100, sharePercent)) / 100;
  if (!base.length || share >= 1) return { out: [...extra], usedExtra: extra.length };
  if (share <= 0 || !extra.length) return { out: [...base], usedExtra: 0 };
  const perBase = share / (1 - share); // сколько YT-треков на один трек Яндекса
  const out = [];
  let credit = 0;
  let used = 0;
  for (const t of base) {
    out.push(t);
    credit += perBase;
    while (credit >= 1 && used < extra.length) {
      out.push(extra[used++]);
      credit -= 1;
    }
  }
  return { out, usedExtra: used };
}

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class WaveMixer {
  /**
   * getRecent — async () => Set id треков, звучавших недавно (на всех устройствах), чтобы волна не повторялась.
   * memory — { get(), set(v) }: что волна помнит между запусками (какими треками она начиналась).
   */
  constructor({ ya, yt, sc, getSettings, getRecent = async () => new Set(), memory = null }) {
    this.ya = ya;
    this.yt = yt;
    this.sc = sc;
    this.getSettings = getSettings;
    this.getRecent = getRecent;
    this.memory = memory;
    this.pool = [];
    this.seen = new Set();
    this.recent = new Set();
    this.refilling = null;
  }

  opts() {
    const s = this.getSettings();
    return { diversity: s.waveDiversity, mood: s.waveMood, share: s.ytmShare };
  }

  /** «Дополнительные» сервисы волны: YouTube Music и SoundCloud — что подключено */
  get extras() {
    return [this.yt, this.sc].filter((p) => p && p.loggedIn);
  }

  async refillPool() {
    const extras = this.extras;
    if (!extras.length) return;
    if (this.refilling) return this.refilling;
    const { diversity } = this.opts();
    const exclude = new Set([...this.seen, ...this.recent]);
    this.refilling = Promise.all(extras.map((p) => p.wavePool({ diversity, exclude }).catch(() => [])))
      .then((lists) => {
        // чередуем сервисы, чтобы YouTube и SoundCloud шли вперемешку
        const mixed = [];
        for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
        for (const t of mixed) if (!exclude.has(t.id) && !this.seen.has(t.id) && !this.pool.some((p) => p.id === t.id)) this.pool.push(t);
      })
      .catch(() => {})
      .finally(() => {
        this.refilling = null;
      });
    return this.refilling;
  }

  take(list) {
    let fresh = list.filter((t) => t && !this.seen.has(t.id) && !this.recent.has(t.id));
    // всё в пачке уже звучало недавно — лучше повтор, чем тишина: берём пару треков
    if (!fresh.length) fresh = list.filter((t) => t && !this.seen.has(t.id)).slice(0, 2);
    fresh.forEach((t) => this.seen.add(t.id));
    return fresh;
  }

  async batch(yaPromise) {
    const { share } = this.opts();
    const useYt = this.extras.length > 0 && share > 0;
    if (useYt && this.pool.length < 6) await this.refillPool();
    let base = [];
    if (this.ya.loggedIn && share < 100) {
      try {
        base = await yaPromise();
      } catch (e) {
        if (!useYt) throw e;
      }
    }
    base = this.take(base);
    let extraSource = useYt ? this.pool : [];
    if (!base.length && useYt) extraSource = this.pool.slice(0, 6); // волна только из YT
    const { out, usedExtra } = interleave(base, extraSource, base.length ? share : 100);
    const usedTracks = extraSource.slice(0, usedExtra);
    this.pool = this.pool.filter((t) => !usedTracks.includes(t));
    usedTracks.forEach((t) => this.seen.add(t.id));
    if (useYt && this.pool.length < 6) this.refillPool();
    if (!out.length) throw new Error('Волна пустая: войди хотя бы в один сервис в настройках');
    return out;
  }

  async start() {
    this.pool = [];
    this.seen = new Set();
    try {
      this.recent = await this.getRecent();
    } catch {
      this.recent = new Set();
    }
    const { diversity, mood } = this.opts();
    const tracks = this.freshStart(await this.batch(() => this.ya.waveStart({ diversity, mood })));
    if (this.ya.loggedIn) this.ya.waveFeedback('radioStarted', { source: 'ya' });
    return tracks;
  }

  /**
   * Начало волны не должно быть одинаковым: перемешиваем первые треки и не ставим первым тот,
   * с которого волна уже начиналась в последние запуски (привет, Кобзон).
   */
  freshStart(tracks) {
    if (tracks.length < 2) return tracks;
    const head = shuffle(tracks.slice(0, Math.min(5, tracks.length)));
    const out = [...head, ...tracks.slice(head.length)];
    const firsts = (this.memory && this.memory.get()) || [];
    const i = out.findIndex((t) => !firsts.includes(t.id));
    if (i > 0) out.unshift(...out.splice(i, 1));
    if (this.memory) this.memory.set([out[0].id, ...firsts.filter((id) => id !== out[0].id)].slice(0, 15));
    return out;
  }

  async more(queueIds) {
    return this.batch(() => this.ya.waveMore(queueIds));
  }

  async feedback(type, track, played) {
    if (track && track.source === 'ya') await this.ya.waveFeedback(type, track, played);
  }
}
