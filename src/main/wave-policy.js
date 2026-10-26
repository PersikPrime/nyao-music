// Shared wave policy. Providers supply candidates; this code owns taste, quotas and repetition.
export function normal(s) {
  return String(s || '').normalize('NFKD').toLowerCase().replace(/ё/g, 'е').replace(/\p{M}/gu, '')
    .replace(/\b(official\s*(music\s*)?(video|audio)|lyrics?\s*(video)?|hd|hq)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const artistCache = new WeakMap(), titleCache = new WeakMap();
export function artistKey(t) {
  if (!artistCache.has(t)) artistCache.set(t, normal(String(t.artist || '').split(/,|\s+feat\.?\s+|\s+ft\.?\s+/i)[0]));
  return artistCache.get(t);
}
export function titleKey(t) {
  if (!titleCache.has(t)) { const a = artistKey(t), title = normal(t.title); titleCache.set(t, a && title.startsWith(a + ' ') ? title.slice(a.length + 1) : title); }
  return titleCache.get(t);
}
export function recordingKey(t) { return `${artistKey(t)}|${titleKey(t)}`; }
export function sameRecording(a, b) {
  if (a.id === b.id) return true;
  if (a.isrc && b.isrc && a.isrc === b.isrc) return true;
  return !!artistKey(a) && !!titleKey(a) && recordingKey(a) === recordingKey(b) &&
    a.duration > 0 && b.duration > 0 && Math.abs(a.duration - b.duration) <= 5;
}
function trackIndex(tracks) {
  const ids = new Set(), isrc = new Set(), keys = new Map();
  const add = t => {
    ids.add(t.id); if (t.isrc) isrc.add(t.isrc);
    const key = recordingKey(t); if (!keys.has(key)) keys.set(key, []); keys.get(key).push(t);
  };
  tracks.forEach(add);
  return { add, has: t => ids.has(t.id) || (t.isrc && isrc.has(t.isrc)) || (keys.get(recordingKey(t)) || []).some(other => sameRecording(other, t)) };
}
export function recentAffinity(track, index, size, now = Date.now()) {
  // Keep the ORIGINAL library rank, never re-index after filtering recently played tracks.
  if (track.likedAt > 0 && track.likedAt <= now) return Math.exp(-(now - track.likedAt) / (30 * 86400000));
  return Math.exp(-index / Math.max(5, Math.min(30, size * 0.1)));
}
export function waveTargets(diversity, fresh) {
  const f = Math.max(0, Math.min(100, fresh || 0)) / 100;
  if (diversity === 'discover') return { recent: 0, library: 0, related: 1 };
  if (diversity === 'popular') return { recent: 0.1 * f, library: 0.1, related: 0.9 - 0.1 * f };
  const liked = diversity === 'favorite' ? 0.9 : 0.55;
  const recent = liked * f * (diversity === 'favorite' ? 7 / 9 : 0.8);
  return { recent, library: liked - recent, related: 1 - liked };
}
export class WavePolicy {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.selected = [];
    this.kinds = { recent: 0, library: 0, related: 0 };
    this.sources = {};
    this.total = 0;
    this.blocked = [];
  }
  block(track) { this.blocked.push(track); }
  select(candidates, { diversity = 'any', fresh = 60, share = 30, size = 8, recentIds = new Set(), history = [] } = {}) {
    const out = [], targets = waveTargets(diversity, fresh);
    const selected = trackIndex(this.selected), blocked = trackIndex(this.blocked), heard = trackIndex(history);
    const liked = trackIndex(candidates.filter(c => c.liked).map(c => c.track));
    for (let slot = 0; slot < size; slot++) {
      let options = candidates.filter(c => c.track?.available !== false && !c.track?.preview && c.track?.id &&
        !selected.has(c.track) && !blocked.has(c.track) &&
        !(diversity === 'discover' && liked.has(c.track)));
      if (!options.length) break;
      // Recent listening is a preference, but never silently repeat within this wave.

      // Group versions before computing source quotas. Same song on five services counts once.
      const groups = [], byKey = new Map(), byIsrc = new Map();
      for (const c of options) {
        const key = recordingKey(c.track);
        let group = (c.track.isrc && byIsrc.get(c.track.isrc)) || (byKey.get(key) || []).find(g => sameRecording(g[0].track, c.track));
        if (!group) { group = []; groups.push(group); if (!byKey.has(key)) byKey.set(key, []); byKey.get(key).push(group); }
        group.push(c); if (c.track.isrc) byIsrc.set(c.track.isrc, group);
      }
      const kindOf = group => group.some(c => c.liked) ? (Math.max(...group.map(c => c.recency || 0)) >= 0.5 ? 'recent' : 'library') : 'related';
      const cooled = group => !group.some(c => recentIds.has(c.track.id) || heard.has(c.track));
      // Cooldown competes WITHIN a category. Otherwise old unheard tracks erase the freshness target.
      const freshKinds = new Set(groups.filter(cooled).map(kindOf));
      const cooledGroups = groups.filter(g => cooled(g) || !freshKinds.has(kindOf(g)));
      const recentArtists = this.selected.slice(-3).map(artistKey).filter(Boolean);
      const diverse = cooledGroups.filter(g => !recentArtists.includes(artistKey(g[0].track)));
      const choices = diverse.length ? diverse : cooledGroups;
      const sources = [...new Set(choices.flat().map(c => c.track.source))];
      const extras = sources.filter(s => s !== 'ya');
      const weights = Object.fromEntries(sources.map(s => [s, sources.includes('ya') && extras.length ?
        (s === 'ya' ? 1 - share / 100 : share / 100 / extras.length) : 1 / sources.length]));
      // Quotas accumulate for the entire session, not separately for every provider batch.
      const kinds = choices.map(group => group.some(c => c.liked) ? (Math.max(...group.map(c => c.recency || 0)) >= 0.5 ? 'recent' : 'library') : 'related');
      const effective = { ...targets };
      if (!kinds.includes('recent')) { effective.library += effective.recent; effective.recent = 0; }
      if (!kinds.includes('library')) { effective.recent += effective.library; effective.library = 0; }
      if (!kinds.includes('related')) {
        const sum = effective.recent + effective.library;
        if (sum) { effective.recent /= sum; effective.library /= sum; }
        effective.related = 0;
      }
      const scored = [];
      for (const group of choices) {
        const liked = group.some(c => c.liked);
        const recency = Math.max(...group.map(c => c.recency || 0));
        const kind = liked ? (recency >= 0.5 ? 'recent' : 'library') : 'related';
        const deficit = effective[kind] * (this.total + 1) - this.kinds[kind];
        for (const c of group) {
          const sourceDeficit = (weights[c.track.source] || 0) * (this.total + 1) - (this.sources[c.track.source] || 0);
          // Gumbel noise avoids a fixed playlist without letting randomness override category deficits.
          const noise = -Math.log(-Math.log(Math.max(1e-8, Math.min(1 - 1e-8, this.random()))));
          const score = 5 * deficit + 1.5 * sourceDeficit +
            (kind === 'recent' ? recency * fresh / 100 : 0) + (c.affinity || 0) * 0.7 + noise * 0.35;
          scored.push({ c, kind, score });
        }
      }
      const best = scored.sort((a, b) => b.score - a.score)[0];
      if (!best) break;
      const track = { ...best.c.track, waveReason: best.kind === 'recent' ? 'Недавний лайк' : best.kind === 'library' ? 'Из любимого' : (best.c.reason || 'По твоим интересам') };
      out.push(track); this.selected.push(track); selected.add(track); this.total++;
      this.kinds[best.kind]++; this.sources[track.source] = (this.sources[track.source] || 0) + 1;
    }
    return out;
  }
}
