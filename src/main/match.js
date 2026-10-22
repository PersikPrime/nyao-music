// Поиск «того же трека» в другом сервисе: для «Слушать вместе» (у гостя может не быть сервиса хоста)
// и для переноса плейлистов. Сравниваем очищенные названия, исполнителей и длительность.

const NOISE = /\b(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|official( music)? (video|audio)|lyrics?( video)?|audio|hd|hq|mv|clip|клип|explicit|radio edit|original mix)\b/g;

/** Нормализация: нижний регистр, ё→е, без скобок с «feat./remaster», без пунктуации */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*(feat|ft\.|prod|remaster|official|lyric|video|audio|explicit|версия|version|live|edit)[^)\]}]*[)\]}]/g, ' ')
    .replace(/\s[-–—]\s.*(remaster|version|edit|mix).*$/g, ' ')
    .replace(/\b(feat|ft)\.?\s.*$/g, ' ')
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function artistList(a) {
  return String(a || '')
    .split(/,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+|\s+и\s+|\s+and\s+/i)
    .map(norm)
    .filter(Boolean);
}

function tokens(s) {
  return new Set(norm(s).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/**
 * Насколько cand похож на src: 0…1.
 * YouTube часто кладёт «Исполнитель - Название» в название ролика, а «канал» — в исполнителя: это тоже учитываем.
 */
export function recordingVersion(title) {
  const s = String(title || '').toLowerCase();
  return ['live', 'remix', 'acoustic', 'instrumental', 'karaoke', 'cover', 'slowed', 'sped up']
    .filter(word => new RegExp('(?:^|[^a-z])' + word + '(?:$|[^a-z])').test(s)).join(',');
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
/** Кириллица латиницей: «Кино» → «kino» — один и тот же трек в разных сервисах бывает записан разной азбукой */
export function translit(s) {
  return String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? c);
}

export function similarity(src, cand) {
  const base = similarityRaw(src, cand);
  // разная азбука: сравниваем ещё и в латинице, берём лучшее
  const cyr = /[а-яё]/i;
  if (base >= 0.85 || !(cyr.test(src.title + src.artist) || cyr.test(cand.title + cand.artist))) return base;
  const lat = (t) => ({ ...t, title: translit(t.title), artist: translit(t.artist) });
  return Math.max(base, similarityRaw(lat(src), lat(cand)));
}

function similarityRaw(src, cand) {
  if (recordingVersion(src.title) !== recordingVersion(cand.title)) return 0;
  const st = norm(src.title);
  const ct = norm(cand.title);
  let title = st && st === ct ? 1 : jaccard(tokens(src.title), tokens(cand.title));
  const sa = artistList(src.artist);
  const ca = artistList(cand.artist);
  let artist = sa.some((x) => ca.includes(x)) ? 1 : jaccard(new Set(sa.join(' ').split(' ')), new Set(ca.join(' ').split(' ')));
  if (artist < 1 && sa[0] && (' ' + ct + ' ').includes(' ' + sa[0] + ' ')) {
    // «Artist - Title» целиком в названии
    artist = Math.max(artist, 0.8);
    title = Math.max(title, jaccard(tokens(src.title), new Set([...tokens(cand.title)].filter((x) => !sa[0].split(' ').includes(x)))));
  }
  let score = title * 0.6 + artist * 0.4;
  if (src.duration > 0 && cand.duration > 0) {
    const d = Math.abs(src.duration - cand.duration);
    if (d <= 3) score += 0.08;
    else if (d > 20) score -= Math.min(0.3, d / 200);
  }
  if (cand.available === false || cand.preview) score -= 0.4;
  return Math.max(0, Math.min(1, score));
}

/** Строка для поиска: основной исполнитель + очищенное название */
export function searchQuery(t) {
  const a = artistList(t.artist)[0] || '';
  return `${a} ${norm(t.title)}`.trim();
}

/**
 * Ищет трек через search(query) → [tracks]. Возвращает { track, score } или null.
 * minScore 0.62 — достаточно, чтобы «Song (Remastered)» нашлась, а чужая песня с тем же словом — нет.
 */
export async function findMatch(track, search, { minScore = 0.62 } = {}) {
  const queries = [searchQuery(track)];
  if (norm(track.title) !== track.title.toLowerCase()) queries.push(`${track.artist} ${track.title}`);
  let best = null;
  for (const q of queries) {
    let list = [];
    try {
      list = (await search(q)) || [];
    } catch {
      list = [];
    }
    for (const c of list.slice(0, 15)) {
      if (c.available === false || c.preview) continue;
      const score = similarity(track, c);
      if (!best || score > best.score) best = { track: c, score };
    }
    if (best && best.score >= 0.85) break;
  }
  return best && best.score >= minScore ? best : null;
}
