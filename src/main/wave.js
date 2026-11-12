// Unified wave: all services supply candidates, one policy owns the resulting queue.
import { recencyPick } from './freshness.js';
import { WavePolicy, artistKey, sameRecording, recentAffinity } from './wave-policy.js';
import { findMatch } from './match.js';

export function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Retained for callers/tests outside the wave. WavePolicy uses session-wide quotas instead.
export function interleave(base, extra, percent) {
  const share = Math.max(0, Math.min(100, percent)) / 100;
  if (!base.length || share >= 1) return { out: [...extra], usedExtra: extra.length };
  if (!extra.length || share <= 0) return { out: [...base], usedExtra: 0 };
  const out = []; let credit = 0, usedExtra = 0;
  for (const t of base) { out.push(t); credit += share / (1 - share); while (credit >= 1 && usedExtra < extra.length) { out.push(extra[usedExtra++]); credit--; } }
  return { out, usedExtra };
}
const bounded = async (work, fallback = [], timeout = 8000) => {
  let timer;
  try { return await Promise.race([Promise.resolve().then(work), new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeout); })]); }
  catch { return fallback; }
  finally { clearTimeout(timer); }
};
const DAY = 86400000;
const LIKES_LIMIT = 300;
// своя волна находит треки поиском: строгий порог и сверка длительности, иначе в волну попадают каверы и однофамильцы
const OWN_MATCH = 0.8;
const tooFar = (want, got) => want.duration > 0 && got.duration > 0 && Math.abs(want.duration - got.duration) > 15;
// Версии, которые почти никогда не хочется услышать вместо оригинала, если их нет в лайках
const ODD_VERSION = /(^|[\s([\-–—])(karaoke|караоке|instrumental|инструментал|минус(овка)?|nightcore|sped[ -]?up|speed[ -]?up|slowed|reverb|8d( audio)?|tribute|in the style of|tiktok remix|бас буст|bass ?boost(ed)?)(?=$|[\s)\]\-–—,.])/i;
// «кавер» — только как пометка версии: «(Cover)», «- кавер», «cover by…». Песню «Cover Me Up» не трогаем
const COVER = /([([\-–—][^)\]]*(?<!\p{L})(cover|кавер)(?!\p{L})|(?<!\p{L})(cover|кавер)\s+(version|by|версия|от)(?!\p{L}))/iu;
export const oddVersion = (t) => { const s = `${t?.title || ''} ${t?.album || ''}`; return ODD_VERSION.test(s) || COVER.test(s); };
const TWIN_EVENTS = new Set(['trackStarted', 'trackFinished', 'skip', 'dislike', 'like']);
const LIKED_REASONS = new Set(['Недавний лайк', 'Из любимого']);
const normalTitle = (t) => String(t || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
const newStats = (startMs) => ({ startMs, retuneMs: 0, started: 0, fromLikes: 0, skipped: 0, liked: 0, artistRepeats: 0, lastArtists: [], by: {} });
export class WaveMixer {
  constructor({ ya, yt, sc, vk = null, sp = null, getSettings, getRecent = async () => new Set(), getHistory = () => [], getFavorites = async () => [], profile = null, isDown = () => false, nyao = null }) {
    Object.assign(this, { ya, yt, sc, vk, sp, getSettings, getRecent, getHistory, getFavorites, profile, isDown, nyao });
    this.generation = 0;
    this.session = null;
    try { this.state = profile?.get() || {}; } catch { this.state = {}; }
    this.state.played ||= []; this.state.disliked ||= []; this.state.libraries ||= {}; this.state.taste = Object.assign(Object.create(null), this.state.taste || {});
    this.libraryCache = new Map();
  }
  sources() { return [['ya', this.ya], ['yt', this.yt], ['sc', this.sc], ['vk', this.vk], ['sp', this.sp]].filter(([id, p]) => p?.loggedIn && !p.regionBlocked && !this.isDown(id)); }
  opts() { const s = this.getSettings(); return { diversity: s.waveDiversity || 'any', mood: s.waveMood, fresh: s.waveFresh ?? 60, share: Math.max(0, Math.min(100, s.ytmShare ?? 30)), nyao: s.waveNyao !== false }; }
  save() { try { this.profile?.set(this.state); } catch { /* The wave can run if disk is unavailable. */ } }
  invalidateLikes() { this.libraryCache.clear(); if (this.yt) this.yt.likedCache = null; if (this.session) this.session.hydrated = false; }
  async start(queueIds = []) {
    const t0 = Date.now();
    const out = await this.startFresh(queueIds);
    this.stats = newStats(Date.now() - t0);
    return out;
  }
  /**
   * Настройки волны поменялись. «Свежесть» и «баланс» только пересортировывают уже собранный пул — без новых запросов,
   * поэтому очередь меняется почти мгновенно. Новый «характер» или настроение меняют саму «Мою волну» Яндекса — тогда заново.
   */
  async retune(queueIds = []) {
    const old = this.session;
    const opts = this.opts();
    if (!old || !old.hydrated || !old.opts || old.opts.mood !== opts.mood || old.opts.diversity !== opts.diversity || !!old.opts.nyao !== !!opts.nyao) return this.start(queueIds);
    const t0 = Date.now();
    const generation = ++this.generation;
    const policy = new WavePolicy(); this.state.disliked.forEach(t => policy.block(t));
    const s = { ...old, generation, policy, loading: null, ownLoading: null, opts, excludedIds: new Set(queueIds), loads: 1 };
    s.candidates = old.candidates.filter(c => !queueIds.includes(c.track.id));
    // уже сыгранное в этой волне не повторяем и после перенастройки
    s.history = [...old.history, ...old.policy.selected];
    this.session = s;
    const out = await this.batch(s);
    if (this.stats) this.stats.retuneMs = Date.now() - t0;
    return out;
  }
  async startFresh(queueIds = []) {
    const generation = ++this.generation;
    const policy = new WavePolicy(); this.state.disliked.forEach(t => policy.block(t));
    const s = { generation, policy, candidates: [], libraries: [], recent: new Set(), history: [], loads: 0, loading: null, hydrated: false, excludedIds: new Set(queueIds), seedHistory: [], rotorIds: new Set(), moodChecked: new Set(), opts: this.opts() };
    this.session = s;
    s.recent = await bounded(() => this.getRecent(), new Set());
    this.ensure(s);
    const now = Date.now();
    s.history = [...this.getHistory().filter(p => now - p.playedAt < (p.skipped ? 30 : 14) * DAY).map(p => ({ ...p, id: p.trackId || p.id })),
      ...this.state.played.filter(p => now - p.at < (p.skipped ? 30 : 14) * DAY).map(p => p.track)];
    return this.batch(s, true);
  }
  ensure(s) { if (this.session !== s || s.generation !== this.generation) throw new Error('Настройки волны изменились — предыдущий подбор отменён'); }
  async libraries(s) {
    const now = Date.now();
    const lists = await Promise.all(this.sources().map(async ([id, p]) => {
      let cached = this.libraryCache.get(id);
      if (!cached) {
        const tracks = await bounded(() => p.likedTracks(LIKES_LIMIT));
        this.ensure(s);
        // Never cache a failed request as an empty library for the next two minutes.
        if (tracks.length) { cached = { at: now, tracks }; this.libraryCache.set(id, cached); }
      } else if (now - cached.at > 120000 && !cached.refreshing) {
        // кэш устарел — волна стартует на нём сразу, свежие лайки подтянутся в фоне к следующему подбору
        cached.refreshing = true;
        bounded(() => p.likedTracks(LIKES_LIMIT), [], 30000).then((tracks) => {
          if (tracks.length && this.libraryCache.get(id) === cached) this.libraryCache.set(id, { at: Date.now(), tracks });
          else cached.refreshing = false;
        });
      }
      const tracks = cached?.tracks || [];
      const previous = this.state.libraries[id];
      const observed = {};
      const candidates = tracks.map((track, index) => {
        const likedAt = track.likedAt || previous?.[track.id] || (previous && !(track.id in previous) ? now : 0);
        observed[track.id] = likedAt;
        const t = likedAt ? { ...track, likedAt } : track;
        return { track: t, liked: true, recency: recentAffinity(t, index, tracks.length, now), affinity: 1 + (this.state.taste[artistKey(t)] || 0) / 5 };
      });
      if (tracks.length) this.state.libraries[id] = observed;
      return candidates;
    }));
    this.ensure(s); this.save();
    s.libraries = lists.flat();
    // A recent ID from another device also suppresses equivalent versions in other catalogs.
    s.history.push(...s.libraries.filter(c => s.recent.has(c.track.id)).map(c => c.track));
    s.candidates = s.candidates.filter(c => !c.liked);
    s.policy.selected.push(...s.libraries.filter(c => s.excludedIds.has(c.track.id)).map(c => c.track));
    this.add(s, s.libraries);
  }
  add(s, candidates) {
    this.ensure(s);
    for (const c of candidates) {
      if (!c.track?.id || s.excludedIds.has(c.track.id) || c.track.available === false || c.track.preview) continue;
      if (!c.liked && oddVersion(c.track)) continue;
      const old = s.candidates.find(x => x.track.id === c.track.id);
      if (old) { if (c.liked) Object.assign(old, c); if (c.moodOk) old.moodOk = true; }
      else s.candidates.push(c);
    }
    // Remove selected candidates, but keep unplayed library candidates and provenance.
    s.candidates = s.candidates.filter(c => !s.policy.selected.some(t => sameRecording(t, c.track))).slice(-1600);
  }
  async recommendations(s, first) {
    const opts = this.opts(), sources = this.sources();
    const seeds = s.libraries.filter(c => c.track.available !== false).sort((a, b) => b.recency - a.recency);
    const availableSeeds = seeds.filter(c => !s.seedHistory.some(t => sameRecording(t, c.track)));
    const seed = recencyPick((availableSeeds.length ? availableSeeds : seeds).slice(0, 100), 1, opts.fresh)[0]?.track;
    if (seed) s.seedHistory = [...s.seedHistory.slice(-4), seed];
    const favorites = await bounded(() => this.getFavorites());
    const favoriteNames = new Set(favorites.map(a => artistKey({ artist: a.name })));
    const lists = await Promise.all(sources.map(async ([id, p]) => {
      const tasks = [];
      // «Моя волна» Яндекса — единственный источник, который знает настроение. В неё отправляем только её же
      // треки: иначе подмешанное (лайки, похожее) уводит её от выбранного настроения
      if (id === 'ya') tasks.push(bounded(async () => (await (first ? p.waveStart(opts) : p.waveMore(s.policy.selected.filter(t => s.rotorIds.has(t.id)).map(t => t.id)))).map(t => { s.rotorIds.add(t.id); return t; })));
      if (id === 'vk') tasks.push(bounded(() => p.recommendations()));
      else if (seed?.source === id && id === 'yt') tasks.push(bounded(() => p.radio(seed.srcId)));
      else if (seed?.source === id && id === 'sc') tasks.push(bounded(() => p.related(seed.srcId)));
      if (seed?.source === 'ya' && id === 'ya') tasks.push(bounded(() => p.similarTracks(seed.srcId)));
      // Cross-service taste transfer uses public metadata, not unavailable recommendation endpoints.
      // «Ещё от исполнителя» — не больше двух треков с сервиса: иначе один автор заполняет волну
      if (seed && artistKey(seed)) tasks.push(bounded(async () => shuffle((await p.search(String(seed.artist).split(/,| feat\.? /i)[0])).filter(t => artistKey(t) === artistKey(seed))).slice(0, 2)));
      if (!tasks.length && id === 'yt') tasks.push(bounded(async () => (await p.home()).flatMap(section => section.tracks || [])));
      const tracks = (await Promise.all(tasks)).flat();
      return tracks.map(track => {
        const liked = s.libraries.filter(c => sameRecording(c.track, track));
        const affinity = 0.3 + (favoriteNames.has(artistKey(track)) ? 0.2 : 0) + (this.state.taste[artistKey(track)] || 0) / 5;
        // «Моя волна» Яндекса сама подбирает под настроение — её треки подходят сразу, остальные проверим по тегам
        const rotor = !!opts.mood && s.rotorIds.has(track.id);
        return { track, liked: !!liked.length, recency: Math.max(0, ...liked.map(c => c.recency)), affinity, ...(rotor ? { moodOk: true } : {}),
          reason: rotor ? 'Моя волна Яндекса · по настроению' : seed && artistKey(track) === artistKey(seed) ? `Исполнитель из твоих лайков: ${seed.artist}` : 'Рекомендация сервиса' };
      });
    }));
    this.ensure(s); this.add(s, lists.flat()); s.loads++;
    // своя волна Nyao: похожее по открытым данным (Last.fm, Deezer). Ищется дольше всего — не ждём её:
    // первые треки играют сразу, найденное добавится к следующему подбору
    if (this.nyao && this.getSettings().waveNyao !== false && !s.ownLoading) {
      s.ownLoading = bounded(() => this.nyaoCandidates(s, sources, opts), [], 25000)
        .then((own) => { if (this.session === s && s.generation === this.generation) this.add(s, own); })
        .catch(() => {})
        .finally(() => { s.ownLoading = null; });
    }
  }
  /**
   * Настроение для треков всех сервисов: сервер Nyao смотрит теги Last.fm («chill», «sad», «energetic»…)
   * и говорит, какое у трека настроение. Подходящие получают moodOk и могут попасть в волну. Каждый трек — один раз.
   */
  async tagMoods(s, mood) {
    if (!this.nyao?.mood) return;
    const todo = s.candidates.filter(c => !c.moodOk && !s.moodChecked.has(c.track.id) && c.track.artist && c.track.title)
      .sort((a, b) => (b.liked - a.liked) || (b.recency - a.recency) || (b.affinity - a.affinity)).slice(0, 80);
    if (!todo.length) return;
    todo.forEach(c => s.moodChecked.add(c.track.id));
    const res = await bounded(() => this.nyao.mood({ tracks: todo.map(c => ({ artist: c.track.artist, title: c.track.title })) }), null, 12000);
    const moods = (res && Array.isArray(res.moods)) ? res.moods : [];
    this.ensure(s);
    todo.forEach((c, i) => { if (moods[i] === mood) { c.moodOk = true; if (!c.liked) c.reason = 'По настроению · теги Last.fm'; } });
  }
  /** Затравка — свежие лайки и дослушанное, ответ сервера — «исполнитель — трек», ищем их в подключённых сервисах */
  async nyaoCandidates(s, sources, opts) {
    const liked = s.libraries.filter(c => c.track.available !== false).sort((a, b) => b.recency - a.recency).map(c => c.track);
    const heard = (s.history || []).filter(t => t && t.artist && t.title && !t.skipped);
    const seeds = [...recencyPick(liked.slice(0, 120).map(track => ({ track })), 14, opts.fresh).map(x => x.track), ...heard.slice(0, 8)]
      .map(t => ({ artist: t.artist, title: t.title }));
    if (!seeds.length) return [];
    const recent = [...(s.history || []), ...s.policy.selected].slice(-400).map(t => ({ artist: t.artist, title: t.title }));
    const res = await this.nyao.mix({ seeds, recent, diversity: opts.diversity === 'any' ? 'any' : opts.diversity, size: 14 });
    const wanted = (res && res.tracks) || [];
    // где искать: сначала Яндекс и VK (полные треки), потом SoundCloud и YouTube Music; Spotify — нет
    const order = ['ya', 'vk', 'sc', 'yt'].map(id => sources.find(([x]) => x === id)).filter(Boolean);
    if (!order.length) return [];
    const out = [];
    let i = 0;
    const worker = async () => {
      while (i < wanted.length) {
        const w = wanted[i++];
        for (const [, p] of order) {
          const m = await bounded(() => findMatch({ artist: w.artist, title: w.title, duration: w.duration || 0 }, (q) => p.search(q), { minScore: OWN_MATCH }), null, 6000);
          if (m && m.track && !tooFar(w, m.track)) {
            const t = m.track;
            out.push({ track: t, liked: s.libraries.some(c => sameRecording(c.track, t)), recency: 0,
              affinity: 0.5 + (this.state.taste[artistKey(t)] || 0) / 5, reason: w.reason || 'Своя волна Nyao' });
            break;
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }
  /**
   * Волна иссякла (всё подходящее уже сыграно): берём то, что играло последним, и ищем максимально похожее —
   * те же исполнители во всех сервисах, «похожие треки» Яндекса, радио YouTube, related SoundCloud, своя волна Nyao.
   * Настройки баланса и характера тут вторичны: лучше похожее, чем тишина.
   */
  async similarToRecent(s) {
    const anchors = [...s.policy.selected].reverse().filter(t => t && t.artist).slice(0, 3);
    if (!anchors.length) return;
    const sources = this.sources();
    const artists = [...new Map(anchors.map(t => [artistKey(t), String(t.artist).split(/,| feat\.? /i)[0].trim()])).entries()];
    const lists = await Promise.all(sources.map(async ([id, p]) => {
      const tasks = artists.map(([key, name]) => bounded(async () => (await p.search(name)).filter(t => artistKey(t) === key)));
      for (const a of anchors.filter(t => t.source === id)) {
        if (id === 'ya' && p.similarTracks) tasks.push(bounded(() => p.similarTracks(a.srcId)));
        if (id === 'yt' && p.radio) tasks.push(bounded(() => p.radio(a.srcId)));
        if (id === 'sc' && p.related) tasks.push(bounded(() => p.related(a.srcId)));
      }
      return (await Promise.all(tasks)).flat();
    }));
    const anchorKeys = new Set(artists.map(([k]) => k));
    const found = lists.flat().map(track => ({ track, liked: s.libraries.some(c => sameRecording(c.track, track)), recency: 0,
      affinity: anchorKeys.has(artistKey(track)) ? 0.9 : 0.6,
      reason: anchorKeys.has(artistKey(track)) ? `Ещё от ${track.artist}` : `Похоже на «${anchors[0].title}»` }));
    let own = [];
    if (this.nyao && this.getSettings().waveNyao !== false) {
      own = await bounded(async () => {
        const res = await this.nyao.mix({ seeds: anchors.map(t => ({ artist: t.artist, title: t.title })), recent: s.policy.selected.slice(-200).map(t => ({ artist: t.artist, title: t.title })), diversity: 'any', size: 14 });
        const order = ['ya', 'vk', 'sc', 'yt'].map(id => sources.find(([x]) => x === id)).filter(Boolean);
        const out = [];
        for (const w of ((res && res.tracks) || []).slice(0, 10)) {
          for (const [, p] of order) {
            const m = await bounded(() => findMatch({ artist: w.artist, title: w.title, duration: w.duration || 0 }, (q) => p.search(q), { minScore: OWN_MATCH }), null, 6000);
            if (m && m.track && !tooFar(w, m.track)) { out.push({ track: m.track, liked: false, recency: 0, affinity: 0.6, reason: w.reason || 'Своя волна Nyao' }); break; }
          }
        }
        return out;
      }, [], 20000);
    }
    this.ensure(s); this.add(s, [...found, ...own]);
  }
  async batch(s, first = false) {
    if (s.loading) return s.loading;
    s.loading = (async () => {
      this.ensure(s);
      if (!s.hydrated) { await this.libraries(s); s.hydrated = true; }
      // Refresh candidate diversity before selecting, not after returning an all-Yandex batch.
      if (first || s.candidates.filter(c => !c.liked).length < 12 || s.loads % 3 === 0) await this.recommendations(s, first);
      this.ensure(s);
      const connected = new Set(this.sources().map(([id]) => id));
      s.candidates = s.candidates.filter(c => connected.has(c.track.source));
      // настроение: в волну идут только треки, подобранные под него — «Моя волна» Яндекса и размеченные по тегам Last.fm
      const mood = this.opts().mood;
      const pool = () => (mood ? s.candidates.filter(c => c.moodOk) : s.candidates);
      const pick = async () => { if (mood) await this.tagMoods(s, mood); return s.policy.select(pool(), { ...this.opts(), recentIds: s.recent, history: s.history }); };
      let result = await pick();
      if (!result.length) {
        await this.recommendations(s, false);
        result = await pick();
      }
      // всё подходящее уже сыграно — максимально похожее на последние треки и те же исполнители
      if (!result.length) {
        await this.similarToRecent(s);
        result = await pick();
      }
      // и это кончилось — разрешаем вернуться трекам, сыгранным давно (кроме последних 40): лучше повтор, чем тишина
      if (!result.length && s.policy.selected.length > 40) {
        s.policy.selected = s.policy.selected.slice(-40);
        result = s.policy.select(pool(), { ...this.opts(), recentIds: s.recent, history: s.history });
      }
      if (!result.length && mood) throw new Error('Под это настроение пока ничего не нашлось — попробуй другое или выключи настроение');
      if (!result.length) throw new Error(this.sources().length ? 'Новых подходящих треков пока нет. Измени настройки волны или добавь лайки.' : 'Войди хотя бы в один сервис для волны');
      this.add(s, []);
      if (first && this.ya?.loggedIn) bounded(() => this.ya.waveFeedback('radioStarted', { source: 'ya' }));
      return result;
    })();
    try { return await s.loading; } finally { s.loading = null; }
  }
  async more(queueIds = []) {
    if (!this.session) {
      return this.start(queueIds);
    }
    const s = this.session;
    queueIds.forEach(id => s.excludedIds.add(id));
    // Restored queue IDs must not be re-enqueued, even before feedback/history arrives.
    s.candidates = s.candidates.filter(c => !queueIds.includes(c.track.id));
    return this.batch(s);
  }
  async feedback(type, track, played) {
    if (!track) return;
    const now = Date.now();
    this.count(type, track, played);
    if (type === 'dislike') {
      this.state.disliked = [track, ...this.state.disliked.filter(t => !sameRecording(t, track))].slice(0, 500);
      this.session?.policy.block(track);
    }
    if (['trackStarted', 'trackFinished', 'skip', 'dislike'].includes(type)) {
      this.state.played = [{ track, at: now, skipped: type === 'dislike' || (type === 'skip' && played < 30) },
        ...this.state.played.filter(p => !sameRecording(p.track, track))].slice(0, 1500);
    }
    const artist = artistKey(track);
    const delta = type === 'dislike' ? -3 : type === 'like' ? 2 : type === 'skip' && played < 30 ? -1 : type === 'trackFinished' && played >= 30 ? 1 : 0;
    if (artist && delta) this.state.taste[artist] = Math.max(-5, Math.min(5, (this.state.taste[artist] || 0) * 0.95 + delta));
    if (Object.keys(this.state.taste).length > 1500) delete this.state.taste[Object.keys(this.state.taste)[0]];
    if (type === 'like') this.invalidateLikes();
    this.save();
    if (track.source === 'ya') await bounded(() => this.ya.waveFeedback(type, track, played));
    else if (TWIN_EVENTS.has(type)) this.twinFeedback(type, track, played);
  }
  /**
   * «Моя волна» Яндекса учится на реакциях. Треки из YouTube, VK, SoundCloud и Spotify она не видит — поэтому находим
   * такой же трек в Яндексе и сообщаем реакцию на него: так Яндекс учится на всём, что человек слушает в Nyao.
   * Только если «Моя волна» Яндекса сейчас открыта; найденные пары запоминаются.
   */
  async twinFeedback(type, track, played) {
    const ya = this.ya;
    if (!ya?.loggedIn || !ya.wave || !ya.search || !track.artist || !track.title) return;
    const key = `${artistKey(track)}|${normalTitle(track.title)}`;
    if (!this.twins) this.twins = new Map();
    let twin = this.twins.get(key);
    if (twin === undefined) {
      const m = await bounded(() => findMatch(track, (q) => ya.search(q), { minScore: 0.85 }), null, 6000);
      twin = m && m.track && m.track.source === 'ya' && !(track.duration > 0 && m.track.duration > 0 && Math.abs(track.duration - m.track.duration) > 10) ? m.track : null;
      this.twins.set(key, twin);
      if (this.twins.size > 3000) this.twins.delete(this.twins.keys().next().value);
    }
    if (twin) await bounded(() => ya.waveFeedback(type, twin, played));
  }
  /** Счётчики текущей волны — для отладки в Nyao Music Red: что играет, откуда и что скипают */
  count(type, track, played) {
    const st = this.stats;
    if (!st) return;
    const src = track.source || '?';
    const why = track.waveReason || '';
    const bucket = LIKED_REASONS.has(why) ? 'likes' : /исполнител|Ещё от/i.test(why) ? 'artist' : /Nyao/i.test(why) || /Похож/i.test(why) ? 'nyao' : /Яндекс/i.test(why) ? 'rotor' : 'other';
    const by = (st.by[`${src}:${bucket}`] ||= { started: 0, skipped: 0 });
    if (type === 'trackStarted') {
      st.started++; by.started++;
      if (LIKED_REASONS.has(why)) st.fromLikes++;
      const a = artistKey(track);
      if (a && st.lastArtists.includes(a)) st.artistRepeats++;
      st.lastArtists = [...st.lastArtists.slice(-9), a];
    }
    if (type === 'skip' && played < 30) { st.skipped++; by.skipped++; }
    if (type === 'like') st.liked++;
  }
}
