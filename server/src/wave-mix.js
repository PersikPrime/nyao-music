// Своя волна Nyao, этап 1: похожее по открытым данным (Last.fm и Deezer) — для любых сервисов сразу.
// Сервер не знает токенов и ничего не играет: он отдаёт список «исполнитель — трек», а приложение находит
// эти треки в сервисах, где у человека есть вход. Аккаунты Last.fm/Deezer у людей не нужны — ключ один, наш.
const DAY = 86_400_000;

export function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*(feat|ft\.|prod|remaster|version|edit|live)[^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const firstArtist = (a) => String(a || '').split(/,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+/i)[0].trim();
export const recKey = (artist, title) => `${norm(firstArtist(artist))}|${norm(title)}`;

function shuffled(a) {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

export function waveMixer({ lastfmKey = '', fetch = globalThis.fetch, log = () => {} } = {}) {
  const cache = new Map();
  const UA = { 'user-agent': 'NyaoMusic/1.0 ( https://music.withnyao.app )', accept: 'application/json' };

  async function json(url, ttl = DAY) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.v;
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(7000) });
      const v = r.ok ? await r.json() : null;
      cache.set(url, { at: Date.now(), v });
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
      return v;
    } catch (e) {
      log(`[wave] ${new URL(url).hostname}: ${e.cause?.code || e.message}`);
      return null;
    }
  }

  /** Last.fm: похожие на трек */
  async function lfmSimilar(artist, title) {
    if (!lastfmKey) return [];
    const u = `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&autocorrect=1&limit=30&format=json&api_key=${encodeURIComponent(lastfmKey)}&artist=${encodeURIComponent(firstArtist(artist))}&track=${encodeURIComponent(title)}`;
    const j = await json(u);
    const list = j && j.similartracks && Array.isArray(j.similartracks.track) ? j.similartracks.track : [];
    return list.map((t) => ({ artist: t.artist && t.artist.name, title: t.name, duration: Number(t.duration) || 0, score: 0.5 + 0.5 * Number(t.match || 0) })).filter((t) => t.artist && t.title);
  }

  /** Last.fm: похожие исполнители и их популярное — запасной путь, если по треку пусто */
  async function lfmArtists(artist) {
    if (!lastfmKey) return [];
    const j = await json(`https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&autocorrect=1&limit=8&format=json&api_key=${encodeURIComponent(lastfmKey)}&artist=${encodeURIComponent(firstArtist(artist))}`);
    const names = (j && j.similarartists && Array.isArray(j.similarartists.artist) ? j.similarartists.artist : []).map((a) => a.name).filter(Boolean);
    const out = [];
    for (const name of shuffled(names).slice(0, 3)) {
      const t = await json(`https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&autocorrect=1&limit=6&format=json&api_key=${encodeURIComponent(lastfmKey)}&artist=${encodeURIComponent(name)}`);
      for (const x of (t && t.toptracks && Array.isArray(t.toptracks.track) ? t.toptracks.track : [])) out.push({ artist: name, title: x.name, score: 0.55, via: firstArtist(artist) });
    }
    return out;
  }

  /** Deezer: исполнитель трека → похожие исполнители → их популярное; плюс популярное самого исполнителя */
  async function deezer(artist, title, { own = false } = {}) {
    const s = await json(`https://api.deezer.com/search?limit=3&q=${encodeURIComponent(`artist:"${firstArtist(artist)}" track:"${title}"`)}`);
    let aid = s && Array.isArray(s.data) && s.data[0] && s.data[0].artist && s.data[0].artist.id;
    if (!aid) {
      const a = await json(`https://api.deezer.com/search/artist?limit=1&q=${encodeURIComponent(firstArtist(artist))}`);
      aid = a && Array.isArray(a.data) && a.data[0] && a.data[0].id;
    }
    if (!aid) return [];
    const out = [];
    if (own) {
      const top = await json(`https://api.deezer.com/artist/${aid}/top?limit=10`);
      for (const t of (top && top.data) || []) out.push({ artist: t.artist && t.artist.name, title: t.title, duration: Number(t.duration) || 0, score: 0.6, own: true });
    }
    const rel = await json(`https://api.deezer.com/artist/${aid}/related?limit=10`);
    for (const r of shuffled((rel && rel.data) || []).slice(0, 3)) {
      const top = await json(`https://api.deezer.com/artist/${r.id}/top?limit=5`);
      for (const t of (top && top.data) || []) out.push({ artist: r.name, title: t.title, duration: Number(t.duration) || 0, score: 0.5, via: firstArtist(artist) });
    }
    return out.filter((t) => t.artist && t.title);
  }

  /**
   * seeds — что человек любит или недавно слушал [{artist, title}], recent — ключи «исполнитель|трек», которые не повторяем.
   * diversity: any | favorite (больше своих исполнителей) | discover (без них) | popular (популярное похожих).
   * → [{artist, title, reason}]
   */
  return async function mix({ seeds = [], recent = [], diversity = 'any', size = 20 } = {}) {
    const clean = seeds.filter((s) => s && s.artist && s.title).slice(0, 40);
    if (!clean.length) return [];
    const picked = shuffled(clean).slice(0, 5);
    const seedArtists = new Set(clean.map((s) => norm(firstArtist(s.artist))));
    const skip = new Set([...recent.map((r) => (r && typeof r === 'object' ? recKey(r.artist, r.title) : String(r))), ...clean.map((s) => recKey(s.artist, s.title))]);
    const lists = await Promise.all(picked.map(async (s) => {
      const [sim, dz] = await Promise.all([
        diversity === 'popular' ? [] : lfmSimilar(s.artist, s.title),
        deezer(s.artist, s.title, { own: diversity === 'favorite' })
      ]);
      const extra = sim.length < 5 ? await lfmArtists(s.artist) : [];
      return [...sim, ...dz, ...extra].map((c) => ({
        ...c,
        reason: c.own ? `Ещё от ${firstArtist(s.artist)}` : c.via ? `Похожие на ${c.via}` : `Похоже на «${s.title}»`
      }));
    }));
    const seen = new Set();
    const perArtist = new Map();
    const out = [];
    const all = lists.flat()
      .map((c) => ({ ...c, w: c.score * (0.6 + Math.random() * 0.8) }))
      .sort((a, b) => b.w - a.w);
    for (const c of all) {
      const key = recKey(c.artist, c.title);
      const a = norm(firstArtist(c.artist));
      if (seen.has(key) || skip.has(key)) continue;
      if (diversity === 'discover' && seedArtists.has(a)) continue;
      if ((perArtist.get(a) || 0) >= 2) continue;
      seen.add(key);
      perArtist.set(a, (perArtist.get(a) || 0) + 1);
      // длительность помогает приложению отличить оригинал от кавера и чужой песни с тем же названием
      out.push({ artist: c.artist, title: c.title, ...(c.duration > 0 ? { duration: c.duration } : {}), reason: c.reason });
      if (out.length >= size) break;
    }
    return out;
  };
}
