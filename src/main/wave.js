// Общая «Моя волна»: основа — поток Яндекса, в него подмешиваются треки YouTube Music.
// Доля YTM задаётся в процентах; если войти только в один сервис, волна строится из него одного.

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

export class WaveMixer {
  constructor({ ya, yt, getSettings }) {
    this.ya = ya;
    this.yt = yt;
    this.getSettings = getSettings;
    this.pool = [];
    this.seen = new Set();
    this.refilling = null;
  }

  opts() {
    const s = this.getSettings();
    return { diversity: s.waveDiversity, mood: s.waveMood, share: s.ytmShare };
  }

  async refillPool() {
    if (!this.yt.loggedIn) return;
    if (this.refilling) return this.refilling;
    const { diversity } = this.opts();
    this.refilling = this.yt
      .wavePool({ diversity, exclude: this.seen })
      .then((tracks) => {
        for (const t of tracks) if (!this.seen.has(t.id)) this.pool.push(t);
      })
      .catch(() => {})
      .finally(() => {
        this.refilling = null;
      });
    return this.refilling;
  }

  take(list) {
    const fresh = list.filter((t) => t && !this.seen.has(t.id));
    fresh.forEach((t) => this.seen.add(t.id));
    return fresh;
  }

  async batch(yaPromise) {
    const { share } = this.opts();
    const useYt = this.yt.loggedIn && share > 0;
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
    const { diversity, mood } = this.opts();
    const tracks = await this.batch(() => this.ya.waveStart({ diversity, mood }));
    if (this.ya.loggedIn) this.ya.waveFeedback('radioStarted', { source: 'ya' });
    return tracks;
  }

  async more(queueIds) {
    return this.batch(() => this.ya.waveMore(queueIds));
  }

  async feedback(type, track, played) {
    if (track && track.source === 'ya') await this.ya.waveFeedback(type, track, played);
  }
}
