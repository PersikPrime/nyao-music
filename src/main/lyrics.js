// Тексты песен. Цепочка источников: Яндекс Музыка (лицензированные, по строкам) → Nyao LyricLabs (проверенные специалистами)
// → LRCLIB (открытая база) → YouTube Music.

/** Свой сервис текстов (lyrics.withnyao.app), API совместим с LRCLIB */
export const NYAO_LYRICS_API = 'https://api.corrode5-15.withnyao.app';

export function parseLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const textPart = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push({ time: Number(s[1]) * 60 + Number(s[2]), text: textPart });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Пословное время (Enhanced LRC из Nyao LyricLabs): «[00:12.30] <00:12.30>слово <00:12.85>слово <00:13.40>».
 * → строки { time, text, words?: [{ time, end, text }] }. Конец слова — начало следующего; у последнего —
 * конечная метка, иначе оценка по длине слова (но не позже следующей строки).
 */
export function parseWordLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(raw.trim());
    if (!m) continue;
    const time = Number(m[1]) * 60 + Number(m[2]);
    const parts = m[3].split(/<(\d+):(\d+(?:\.\d+)?)>/);
    if (parts.length < 4) {
      lines.push({ time, text: m[3].trim() });
      continue;
    }
    const words = [];
    let end = null;
    for (let k = 1; k < parts.length; k += 3) {
      const t = Number(parts[k]) * 60 + Number(parts[k + 1]);
      const w = String(parts[k + 2] || '').trim();
      if (w) words.push({ time: t, text: w });
      else if (k + 3 >= parts.length) end = t;
    }
    lines.push(words.length ? { time, text: words.map((w) => w.text).join(' '), words, wend: end } : { time, text: '' });
  }
  lines.sort((a, b) => a.time - b.time);
  lines.forEach((l, i) => {
    if (!l.words) return;
    const next = lines.slice(i + 1).find((x) => x.time > l.time);
    const limit = next ? next.time : Infinity;
    l.words.forEach((w, j) => {
      const nx = l.words[j + 1];
      if (nx) w.end = Math.max(w.time + 0.05, nx.time);
      else {
        const guess = w.time + Math.min(2.5, Math.max(0.45, 0.2 + w.text.length * 0.11));
        w.end = Math.max(w.time + 0.05, Math.min(l.wend != null && l.wend > w.time ? l.wend : guess, limit));
      }
    });
    delete l.wend;
  });
  return lines;
}

function cleanTitle(title) {
  return String(title)
    .replace(/\s*[\(\[][^\)\]]*(official|video|audio|lyric|ost|mv|клип)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s+-\s+.*(ost|soundtrack).*$/i, '')
    .trim();
}

/** LRCLIB или совместимый с ним сервис (Nyao LyricLabs: только точное совпадение, без поиска) */
export async function findLyrics(track, fetch = globalThis.fetch, { base = 'https://lrclib.net', name = 'LRCLIB', search = true } = {}) {
  const headers = { 'User-Agent': 'NyaoMusic/0.1 (https://github.com/)' };
  const artist = String(track.artist).split(',')[0].trim();
  const title = cleanTitle(track.title);
  const tryGet = async (url) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return res.json();
  };
  let data = null;
  try {
    const q = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.duration) q.set('duration', String(track.duration));
    // свой сервис понимает id трека Яндекса — точное совпадение без путаницы одинаковых названий
    if (!search && track.source === 'ya' && /^\d+$/.test(String(track.srcId))) q.set('ya_id', String(track.srcId));
    // ISRC (у треков Spotify) — та же запись в любом сервисе
    if (!search && track.isrc) q.set('isrc', String(track.isrc));
    data = await tryGet(`${base}/api/get?${q}`);
    if (!data && search) {
      const list = await tryGet(`${base}/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`);
      data = Array.isArray(list) ? list.find((l) => l.syncedLyrics) || list[0] : null;
    }
  } catch (e) {
    throw Object.assign(new Error(e.message || 'сеть'), { status: e.status });
  }
  if (!data) return null;
  // расширение Nyao LyricLabs: время каждого слова — для караоке
  if (data.wordSyncedLyrics) {
    const lines = parseWordLrc(data.wordSyncedLyrics);
    if (lines.some((l) => l.words)) return { synced: true, words: true, lines, source: name };
  }
  if (data.syncedLyrics) return { synced: true, lines: parseLrc(data.syncedLyrics), source: name };
  if (data.plainLyrics) return { synced: false, lines: plainLines(data.plainLyrics), source: name };
  return null;
}

function plainLines(text) {
  return String(text).split(/\r?\n/).map((t) => ({ time: null, text: t.trim() }));
}

/** Провайдеры текстов по умолчанию — в этом порядке их и спрашиваем */
export const LYRICS_PROVIDERS = ['ya', 'nyao', 'lrclib', 'ytm'];

/**
 * Порядок из настроек → полный список [{ id, on }]: неизвестное выкидываем, недостающее (новые провайдеры) — в конец, включённым.
 */
export function lyricsOrder(saved) {
  const out = [];
  for (const x of Array.isArray(saved) ? saved : []) {
    const id = typeof x === 'string' ? x : x && x.id;
    if (LYRICS_PROVIDERS.includes(id) && !out.some((o) => o.id === id)) out.push({ id, on: !(x && x.on === false) });
  }
  for (const id of LYRICS_PROVIDERS) if (!out.some((o) => o.id === id)) out.push({ id, on: true });
  return out;
}

/**
 * Лучший текст из источников в порядке order (как порядок загрузки дисков): первый с таймингами; если таких нет —
 * первый без таймингов. wordsFirst — разметка по словам из Nyao LyricLabs (караоке) важнее порядка.
 * ya, yt — провайдеры (или null, если сервис недоступен); matchYa(track) → трек Яндекса для трека другого сервиса.
 */
export async function findLyricsChain(track, { fetch = globalThis.fetch, ya = null, yt = null, matchYa = null, log = () => {}, order = null, wordsFirst = true, exclude = [] } = {}) {
  // exclude — «попробовать другой источник»: эти провайдеры в этот раз пропускаем
  const list = lyricsOrder(order).filter((p) => p.on && !exclude.includes(p.id)).map((p) => p.id);
  let plain = null;
  const diag = [];
  const why = (e) => (e && e.status ? `ошибка ${e.status}` : `ошибка: ${String((e && e.message) || e).slice(0, 80)}`);
  const yaName = (p) => (p ? `Яндекс Музыка · ${p}` : 'Яндекс Музыка');
  const nyaoOn = list.includes('nyao');
  // Nyao LyricLabs спрашиваем сразу, параллельно с остальными: если там слова размечены по времени (караоке),
  // берём его даже при тексте из источника выше — там только строки
  const ownP = nyaoOn
    ? findLyrics(track, fetch, { base: NYAO_LYRICS_API, name: 'Nyao LyricLabs', search: false }).catch((e) => {
      diag.push(`Nyao LyricLabs: ${why(e)}`);
      return null;
    })
    : Promise.resolve(null);
  const ownWords = () => (wordsFirst && nyaoOn
    ? Promise.race([ownP, new Promise((r) => { const tm = setTimeout(() => r(null), 2500); if (tm.unref) tm.unref(); })]).then((o) => (o && o.words ? o : null))
    : Promise.resolve(null));

  const get = {
    // Яндекс: сам трек или найденный в Яндексе такой же
    async ya() {
      let yaId = track.source === 'ya' ? track.srcId : null;
      if (!ya) {
        diag.push('Яндекс: нет входа');
        return null;
      }
      if (!yaId && matchYa) {
        const m = await matchYa(track).catch(() => null);
        if (m) yaId = m.srcId;
        else diag.push('Яндекс: такого трека нет');
      }
      if (!yaId) return null;
      try {
        const lrc = await ya.lyrics(yaId, 'LRC');
        const lines = lrc ? parseLrc(lrc.text) : [];
        if (lines.length) return { synced: true, lines, source: yaName(lrc.provider) };
        const txt = await ya.lyrics(yaId, 'TEXT');
        if (txt) return { synced: false, lines: plainLines(txt.text), source: yaName(txt.provider) };
        diag.push('Яндекс: текста нет');
      } catch (e) {
        diag.push(`Яндекс: ${why(e)}`);
        log(`[lyrics] ${track.id} Яндекс: ${e.stack || e.message}`);
      }
      return null;
    },
    // Nyao LyricLabs — тексты, проверенные специалистами
    nyao: () => ownP,
    async lrclib() {
      try {
        const lr = await findLyrics(track, fetch);
        if (!lr) diag.push('LRCLIB: текста нет');
        return lr;
      } catch (e) {
        diag.push(`LRCLIB: ${why(e)}`);
        return null;
      }
    },
    // YouTube Music — только текст без таймингов и только для своих треков
    async ytm() {
      if (!yt || track.source !== 'yt') return null;
      const t = await yt.lyrics(track.srcId).catch((e) => {
        diag.push(`YouTube Music: ${why(e)}`);
        return null;
      });
      return t ? { synced: false, lines: plainLines(t), source: 'YouTube Music' } : null;
    }
  };

  const tag = (res, id) => (res ? { ...res, provider: res.provider || id } : res);
  for (const id of list) {
    const res = tag(await get[id](), id);
    if (res && res.synced) return tag(id !== 'nyao' && !res.words && (await ownWords()), 'nyao') || res;
    if (res && !plain) plain = res;
  }
  if (plain) return tag(await ownWords(), 'nyao') || plain;
  log(`[lyrics] ${track.id} «${track.artist} — ${track.title}»: ${diag.join(' · ') || 'все источники выключены'}`);
  return { synced: false, lines: [], source: null, diag };
}
