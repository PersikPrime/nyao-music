// Настроение трека по тегам Last.fm — чтобы под «Спокойное», «Бодрое» и т.д. подходили треки всех сервисов,
// а не только «Моя волна» Яндекса. Сервер видит лишь «исполнитель — трек», токенов не знает.
// Теги трека (track.getTopTags), если их мало — теги исполнителя (artist.getTopTags, с меньшим весом).
import { norm } from './wave-mix.js';

const DAY = 86_400_000;
export const MOODS = ['active', 'fun', 'calm', 'sad'];

// слово-тег → настроение (теги Last.fm в нижнем регистре; совпадение целиком или по началу «chill…»)
const TAGS = {
  active: ['energetic', 'energy', 'upbeat', 'workout', 'gym', 'running', 'dance', 'edm', 'electro house', 'drum and bass', 'dnb', 'hardstyle', 'hard rock', 'metal', 'heavy metal', 'metalcore', 'punk', 'aggressive', 'hype', 'party', 'trap', 'phonk', 'drive', 'driving', 'powerful', 'techno', 'hardcore', 'speedcore'],
  fun: ['happy', 'fun', 'feel good', 'feelgood', 'cheerful', 'summer', 'uplifting', 'catchy', 'joyful', 'positive', 'sunny', 'funky', 'funk', 'disco', 'groovy', 'party', 'good vibes', 'love song', 'cute', 'bubblegum pop', 'j-pop', 'k-pop'],
  calm: ['chill', 'chillout', 'chill out', 'calm', 'relax', 'relaxing', 'ambient', 'mellow', 'lo-fi', 'lofi', 'acoustic', 'soft', 'sleep', 'downtempo', 'peaceful', 'dreamy', 'dream pop', 'easy listening', 'chillwave', 'smooth', 'soothing', 'piano', 'instrumental', 'jazz', 'bossa nova', 'atmospheric', 'study'],
  sad: ['sad', 'melancholy', 'melancholic', 'depressing', 'depressive', 'heartbreak', 'breakup', 'emotional', 'lonely', 'loneliness', 'sorrow', 'tearjerker', 'crying', 'dark', 'gloomy', 'grief', 'nostalgic', 'nostalgia', 'emo', 'sadcore', 'slowcore', 'doom'],
};
const LOOKUP = new Map();
for (const [mood, words] of Object.entries(TAGS)) for (const w of words) LOOKUP.set(w, [...(LOOKUP.get(w) || []), mood]);

/** Теги [{name, count}] → {active, fun, calm, sad} — сумма весов (count Last.fm 0..100) */
export function scoreTags(tags, weight = 1) {
  const score = { active: 0, fun: 0, calm: 0, sad: 0 };
  for (const t of tags || []) {
    const name = String(t && t.name || '').toLowerCase().trim();
    const count = Math.max(1, Math.min(100, Number(t && t.count) || 1));
    for (const mood of LOOKUP.get(name) || []) score[mood] += count * weight;
  }
  return score;
}

/** Победитель, если он заметен и уверенно впереди второго; иначе null («непонятно» — в волну с настроением не идёт) */
export function pickMood(score) {
  const sorted = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [[best, a], [, b]] = sorted;
  if (a < 30) return null;
  if (b > a * 0.7) return null;
  return best;
}

export function moodTagger({ lastfmKey = '', fetch = globalThis.fetch, log = () => {} } = {}) {
  const cache = new Map(); // url → {at, v}
  const UA = { 'user-agent': 'NyaoMusic/1.0 ( https://music.withnyao.app )', accept: 'application/json' };
  const firstArtist = (a) => String(a || '').split(/,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+/i)[0].trim();

  async function tags(params) {
    const url = `https://ws.audioscrobbler.com/2.0/?format=json&autocorrect=1&api_key=${encodeURIComponent(lastfmKey)}&${new URLSearchParams(params)}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 7 * DAY) return hit.v;
    let v = [];
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(6000) });
      const j = r.ok ? await r.json() : null;
      v = (j && j.toptags && Array.isArray(j.toptags.tag) ? j.toptags.tag : []).slice(0, 25).map((t) => ({ name: t.name, count: Number(t.count) || 0 }));
    } catch (e) {
      log(`[mood] last.fm: ${e.cause?.code || e.message}`);
      return []; // сбой не кэшируем
    }
    cache.set(url, { at: Date.now(), v });
    if (cache.size > 20000) cache.delete(cache.keys().next().value);
    return v;
  }

  async function one({ artist, title }) {
    if (!artist || !title) return null;
    const a = firstArtist(artist);
    const own = scoreTags(await tags({ method: 'track.gettoptags', artist: a, track: title }));
    const total = Object.values(own).reduce((x, y) => x + y, 0);
    if (total >= 60) return pickMood(own);
    const art = scoreTags(await tags({ method: 'artist.gettoptags', artist: a }), 0.6);
    return pickMood({ active: own.active + art.active, fun: own.fun + art.fun, calm: own.calm + art.calm, sad: own.sad + art.sad });
  }

  /** [{artist, title}] → ['calm' | 'sad' | … | null] в том же порядке; одинаковые треки спрашиваем один раз */
  return async function tag(tracks = []) {
    if (!lastfmKey) return tracks.map(() => null);
    const keys = tracks.map((t) => `${norm(firstArtist(t && t.artist))}|${norm(t && t.title)}`);
    const unique = [...new Map(tracks.map((t, i) => [keys[i], t])).entries()];
    const result = new Map();
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const [key, t] = unique[next++];
        result.set(key, await one(t).catch(() => null));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return keys.map((k) => result.get(k) ?? null);
  };
}
