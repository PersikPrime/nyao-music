// Unified wave: all services supply candidates, one policy owns the resulting queue.
import { recencyPick } from './freshness.js';
import { WavePolicy, artistKey, sameRecording, recentAffinity } from './wave-policy.js';

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
export class WaveMixer {
  constructor({ ya, yt, sc, vk = null, sp = null, getSettings, getRecent = async () => new Set(), getHistory = () => [], getFavorites = async () => [], profile = null, isDown = () => false }) {
    Object.assign(this, { ya, yt, sc, vk, sp, getSettings, getRecent, getHistory, getFavorites, profile, isDown });
    this.generation = 0;
    this.session = null;
    try { this.state = profile?.get() || {}; } catch { this.state = {}; }
    this.state.played ||= []; this.state.disliked ||= []; this.state.libraries ||= {}; this.state.taste = Object.assign(Object.create(null), this.state.taste || {});
    this.libraryCache = new Map();
  }
  sources() { return [['ya', this.ya], ['yt', this.yt], ['sc', this.sc], ['vk', this.vk], ['sp', this.sp]].filter(([id, p]) => p?.loggedIn && !p.regionBlocked && !this.isDown(id)); }
  opts() { const s = this.getSettings(); return { diversity: s.waveDiversity || 'any', mood: s.waveMood, fresh: s.waveFresh ?? 60, share: Math.max(0, Math.min(100, s.ytmShare ?? 30)) }; }
  save() { try { this.profile?.set(this.state); } catch { /* The wave can run if disk is unavailable. */ } }
  invalidateLikes() { this.libraryCache.clear(); if (this.yt) this.yt.likedCache = null; if (this.session) this.session.hydrated = false; }
  async start(queueIds = []) {
    const generation = ++this.generation;
    const policy = new WavePolicy(); this.state.disliked.forEach(t => policy.block(t));
    const s = { generation, policy, candidates: [], libraries: [], recent: new Set(), history: [], loads: 0, loading: null, hydrated: false, excludedIds: new Set(queueIds), seedHistory: [] };
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
      if (!cached || now - cached.at > 120000) {
        const tracks = await bounded(() => p.likedTracks(300));
        this.ensure(s);
        // Never cache a failed request as an empty library for the next two minutes.
        if (tracks.length) { cached = { at: now, tracks }; this.libraryCache.set(id, cached); }
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
      const old = s.candidates.find(x => x.track.id === c.track.id);
      if (old) { if (c.liked) Object.assign(old, c); }
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
      if (id === 'ya') tasks.push(bounded(() => first ? p.waveStart(opts) : p.waveMore(s.policy.selected.map(t => t.id))));
      else if (id === 'vk') tasks.push(bounded(() => p.recommendations()));
      else if (seed?.source === id && id === 'yt') tasks.push(bounded(() => p.radio(seed.srcId)));
      else if (seed?.source === id && id === 'sc') tasks.push(bounded(() => p.related(seed.srcId)));
      if (seed?.source === 'ya' && id === 'ya') tasks.push(bounded(() => p.similarTracks(seed.srcId)));
      // Cross-service taste transfer uses public metadata, not unavailable recommendation endpoints.
      if (seed && artistKey(seed)) tasks.push(bounded(async () => (await p.search(String(seed.artist).split(/,| feat\.? /i)[0])).filter(t => artistKey(t) === artistKey(seed))));
      if (!tasks.length && id === 'yt') tasks.push(bounded(async () => (await p.home()).flatMap(section => section.tracks || [])));
      const tracks = (await Promise.all(tasks)).flat();
      return tracks.map(track => {
        const liked = s.libraries.filter(c => sameRecording(c.track, track));
        const affinity = (seed && artistKey(track) === artistKey(seed) ? 0.8 : 0.2) + (favoriteNames.has(artistKey(track)) ? 0.2 : 0) + (this.state.taste[artistKey(track)] || 0) / 5;
        return { track, liked: !!liked.length, recency: Math.max(0, ...liked.map(c => c.recency)), affinity,
          reason: seed && artistKey(track) === artistKey(seed) ? `Исполнитель из твоих лайков: ${seed.artist}` : 'Рекомендация сервиса' };
      });
    }));
    this.ensure(s); this.add(s, lists.flat()); s.loads++;
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
      let result = s.policy.select(s.candidates, { ...this.opts(), recentIds: s.recent, history: s.history });
      if (!result.length) {
        await this.recommendations(s, false);
        result = s.policy.select(s.candidates, { ...this.opts(), recentIds: s.recent, history: s.history });
      }
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
  }
}
