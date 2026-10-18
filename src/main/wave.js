// Общая «Моя волна»: основа — поток Яндекса, в него подмешиваются треки YouTube Music.
// Доля YTM задаётся в процентах; если войти только в один сервис, волна строится из него одного.
// Недавно звучавшие треки (история всех устройств) волна пропускает, а начало каждый раз новое.

import { recencyPick, boostShare } from './freshness.js';

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
  constructor({ ya, yt, sc, vk = null, getSettings, getRecent = async () => new Set(), getFavorites = async () => [], memory = null, isDown = () => false }) {
    this.getFavorites = getFavorites; // любимые исполнители (лайк на странице исполнителя)
    this.boost = []; // подмес: треки любимых исполнителей и похожее на свежие лайки
    this.boosting = null;
    this.favCount = 0;
    this.likedCache = {};
    this.isDown = isDown; // сервис временно лежит (статус с сервера Nyao) — его пропускаем
    this.ya = ya;
    this.yt = yt;
    this.sc = sc;
    this.vk = vk;
    this.getSettings = getSettings;
    this.getRecent = getRecent;
    this.memory = memory;
    this.pool = [];
    this.seen = new Set();
    this.recent = new Set();
    this.last = [];
    this.refilling = null;
  }

  /** Яндекс подключён и не лежит */
  get yaUp() {
    return this.ya.loggedIn && !this.isDown('ya');
  }

  opts() {
    const s = this.getSettings();
    return { diversity: s.waveDiversity, mood: s.waveMood, share: s.ytmShare, fresh: s.waveFresh == null ? 60 : Number(s.waveFresh) };
  }

  /** «Дополнительные» сервисы волны: YouTube Music и SoundCloud — что подключено */
  get extras() {
    return [[this.yt, 'yt'], [this.sc, 'sc'], [this.vk, 'vk']].filter(([p, id]) => p && p.loggedIn && !this.isDown(id)).map(([p]) => p);
  }

  async refillPool() {
    const extras = this.extras;
    if (!extras.length) return;
    if (this.refilling) return this.refilling;
    const { diversity, fresh } = this.opts();
    const exclude = new Set([...this.seen, ...this.recent]);
    this.refilling = Promise.all(extras.map((p) => p.wavePool({ diversity, exclude, fresh }).catch(() => [])))
      .then((raw) => {
        // сервис дал только недавно звучавшее — лучше пара повторов, чем пропасть из волны
        const lists = raw.map((l) => {
          const fresh = l.filter((t) => !exclude.has(t.id));
          return fresh.length ? fresh : l.filter((t) => !this.seen.has(t.id)).slice(0, 2);
        });
        // чередуем сервисы, чтобы YouTube и SoundCloud шли вперемешку
        const mixed = [];
        for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
        for (const t of mixed) if (!this.seen.has(t.id) && !this.pool.some((p) => p.id === t.id)) this.pool.push(t);
      })
      .catch(() => {})
      .finally(() => {
        this.refilling = null;
      });
    return this.refilling;
  }

  /** Лайки сервиса за эту волну — один раз (они тяжёлые), новые сверху */
  liked(id, provider, limit) {
    if (!this.likedCache[id]) this.likedCache[id] = Promise.resolve(provider.likedTracks(limit)).catch(() => []);
    return this.likedCache[id];
  }

  /** Популярное исполнителя по ссылке ya:/yt: */
  async artistTop(ref) {
    const [src, id] = [String(ref).slice(0, 2), String(ref).slice(3)];
    if (src === 'ya' && this.yaUp) return this.ya.artistTracks(id, 30);
    if (src === 'yt' && this.yt && !this.isDown('yt')) return ((await this.yt.artist(id)) || {}).popular || [];
    return [];
  }

  /**
   * Подмес волны: 1) треки любимых исполнителей; 2) свежие лайки и похожее на них —
   * чтобы волна была про то, что слушаешь сейчас, а не про прошлогоднее.
   */
  refillBoost() {
    if (this.boosting) return this.boosting;
    this.boosting = (async () => {
      const { fresh } = this.opts();
      const favs = await Promise.resolve(this.getFavorites()).catch(() => []);
      this.favCount = (favs || []).length;
      const exclude = new Set([...this.seen, ...this.recent]);
      const ok = (t) => t && t.available !== false && !t.preview && !exclude.has(t.id);
      const found = [];
      for (const a of recencyPick(favs || [], 2, 40)) {
        const list = await this.artistTop((a.refs && (a.refs.ya || a.refs.yt)) || a.ref).catch(() => []);
        found.push(...shuffle(list.slice(0, 25).filter(ok)).slice(0, 3));
      }
      if (fresh > 0) {
        const sources = [];
        if (this.yaUp) sources.push(['ya', this.ya, 80, (t) => this.ya.similarTracks(t.srcId)]);
        if (this.yt && this.yt.loggedIn && !this.isDown('yt')) sources.push(['yt', this.yt, undefined, (t) => this.yt.radio(t.srcId)]);
        for (const [id, p, limit, similar] of sources) {
          const liked = await this.liked(id, p, limit);
          for (const seed of recencyPick(liked, 1, fresh)) {
            if (ok(seed) && fresh >= 50) found.push(seed); // сам свежий лайк тоже к месту
            found.push(...shuffle(((await similar(seed).catch(() => [])) || []).filter(ok)).slice(0, 3));
          }
        }
      }
      for (const t of shuffle(found)) if (!this.seen.has(t.id) && !this.boost.some((b) => b.id === t.id)) this.boost.push(t);
    })()
      .catch(() => {})
      .finally(() => {
        this.boosting = null;
      });
    return this.boosting;
  }

  /** Подмешать подмес в готовую пачку */
  withBoost(out) {
    const { fresh } = this.opts();
    const share = boostShare(fresh, this.favCount);
    if (!this.boost.length || share <= 0 || !out.length) return out;
    const fresh2 = this.boost.filter((t) => !this.seen.has(t.id) && !out.some((x) => x.id === t.id));
    const mixed = interleave(out, fresh2, share);
    const used = fresh2.slice(0, mixed.usedExtra);
    this.boost = this.boost.filter((t) => !used.includes(t));
    used.forEach((t) => {
      this.seen.add(t.id);
      this.remember(t.id);
    });
    if (this.boost.length < 4) this.refillBoost();
    return mixed.out;
  }

  /**
   * Новое из пачки Яндекса. Ступени, чтобы волна не обрывалась:
   * 1) не звучало ни в этом запуске, ни недавно; 2) недавно звучало, но не в этом запуске;
   * 3) повтор из этого запуска, но не из последних 30 треков.
   */
  pickFresh(list, strict) {
    const a = list.filter((t) => t && !this.seen.has(t.id) && !this.recent.has(t.id));
    if (a.length || strict) return a;
    const b = list.filter((t) => t && !this.seen.has(t.id));
    if (b.length) return b.slice(0, 4);
    return list.filter((t) => t && !this.last.includes(t.id)).slice(0, 3);
  }

  remember(id) {
    this.last.push(id);
    if (this.last.length > 30) this.last.shift();
  }

  async batch(yaPromise, retryPromise = yaPromise) {
    const { share } = this.opts();
    const useYt = this.extras.length > 0 && share > 0;
    if (useYt && this.pool.length < 6) await this.refillPool();
    let base = [];
    let gotAny = false;
    let lastList = [];
    if (this.yaUp && share < 100) {
      // Яндекс прислал только уже звучавшее — просим следующую пачку, а не сдаёмся
      for (let attempt = 0; attempt < 4; attempt++) {
        let list;
        try {
          list = await (attempt === 0 ? yaPromise() : retryPromise());
        } catch (e) {
          if (!useYt && attempt === 0) throw e;
          break;
        }
        if (list && list.length) {
          gotAny = true;
          lastList = [...lastList, ...list.filter((t) => t && !lastList.some((x) => x.id === t.id))];
        }
        base = this.pickFresh(list || [], attempt < 2);
        if (base.length) break;
      }
      // новых пачек не дали — лучше повтор из всего полученного, чем тишина
      if (!base.length && lastList.length) base = this.pickFresh(lastList, false);
    }
    base.forEach((t) => {
      this.seen.add(t.id);
      this.remember(t.id);
    });
    let extraSource = useYt ? this.pool : [];
    if (!base.length && useYt) extraSource = this.pool.slice(0, 6); // волна только из YT
    const { out, usedExtra } = interleave(base, extraSource, base.length ? share : 100);
    const usedTracks = extraSource.slice(0, usedExtra);
    this.pool = this.pool.filter((t) => !usedTracks.includes(t));
    usedTracks.forEach((t) => {
      this.seen.add(t.id);
      this.remember(t.id);
    });
    if (useYt && this.pool.length < 6) this.refillPool();
    if (out.length) return this.withBoost(out);
    {
      if (this.yaUp || this.extras.length) throw new Error(gotAny ? 'Сервисы прислали только уже сыгранное — нажми ещё раз, попробую снова' : 'Сервисы не прислали треков — проверь интернет и попробуй ещё раз');
      throw new Error('Волна пустая: войди хотя бы в один сервис в настройках');
    }
    return out;
  }

  async start() {
    this.pool = [];
    this.seen = new Set();
    this.last = [];
    this.boost = [];
    this.likedCache = {};
    try {
      this.recent = await this.getRecent();
    } catch {
      this.recent = new Set();
    }
    const { diversity, mood } = this.opts();
    // подмес готовим параллельно, но ждём не дольше пары секунд — первый трек важнее
    await Promise.race([this.refillBoost(), new Promise((r) => setTimeout(r, 2500))]);
    const tracks = this.freshStart(await this.batch(() => this.ya.waveStart({ diversity, mood }), () => this.ya.waveMore([...this.seen])));
    if (this.ya.loggedIn) this.ya.waveFeedback('radioStarted', { source: 'ya' });
    return tracks;
  }

  /**
   * Начало волны не должно быть одинаковым: перемешиваем первые треки и не ставим первым тот,
   * с которого волна уже начиналась в последние запуски (привет, Кобзон).
   */
  freshStart(tracks) {
    if (tracks.length < 2) return tracks;
    const head = shuffle(tracks.slice(0, Math.min(12, tracks.length)));
    const out = [...head, ...tracks.slice(head.length)];
    const firsts = (this.memory && this.memory.get()) || [];
    const i = out.findIndex((t) => !firsts.includes(t.id));
    if (i > 0) out.unshift(...out.splice(i, 1));
    if (this.memory) this.memory.set([out[0].id, ...firsts.filter((id) => id !== out[0].id)].slice(0, 40));
    return out;
  }

  async more(queueIds) {
    return this.batch(() => this.ya.waveMore(queueIds), () => this.ya.waveMore([...queueIds, ...[...this.seen].slice(-10)]));
  }

  async feedback(type, track, played) {
    if (track && track.source === 'ya') await this.ya.waveFeedback(type, track, played);
  }
}
