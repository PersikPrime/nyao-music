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
    data = await tryGet(`${base}/api/get?${q}`);
    if (!data && search) {
      const list = await tryGet(`${base}/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`);
      data = Array.isArray(list) ? list.find((l) => l.syncedLyrics) || list[0] : null;
    }
  } catch (e) {
    throw Object.assign(new Error(e.message || 'сеть'), { status: e.status });
  }
  if (!data) return null;
  if (data.syncedLyrics) return { synced: true, lines: parseLrc(data.syncedLyrics), source: name };
  if (data.plainLyrics) return { synced: false, lines: plainLines(data.plainLyrics), source: name };
  return null;
}

function plainLines(text) {
  return String(text).split(/\r?\n/).map((t) => ({ time: null, text: t.trim() }));
}

/**
 * Лучший текст из всех источников: с таймингами лучше, чем без.
 * ya, yt — провайдеры (или null, если сервис недоступен); matchYa(track) → трек Яндекса для трека другого сервиса.
 */
export async function findLyricsChain(track, { fetch = globalThis.fetch, ya = null, yt = null, matchYa = null, log = () => {} } = {}) {
  let plain = null;
  const diag = [];
  const why = (e) => (e && e.status ? `ошибка ${e.status}` : `ошибка: ${String((e && e.message) || e).slice(0, 80)}`);
  const yaName = (p) => (p ? `Яндекс Музыка · ${p}` : 'Яндекс Музыка');
  // 1) Яндекс: сам трек или найденный в Яндексе такой же
  let yaId = track.source === 'ya' ? track.srcId : null;
  if (!ya) diag.push('Яндекс: нет входа');
  if (ya && !yaId && matchYa) {
    const m = await matchYa(track).catch(() => null);
    if (m) yaId = m.srcId;
    else diag.push('Яндекс: такого трека нет');
  }
  if (ya && yaId) {
    try {
      const lrc = await ya.lyrics(yaId, 'LRC');
      const lines = lrc ? parseLrc(lrc.text) : [];
      if (lines.length) return { synced: true, lines, source: yaName(lrc.provider) };
      const txt = await ya.lyrics(yaId, 'TEXT');
      if (txt) plain = { synced: false, lines: plainLines(txt.text), source: yaName(txt.provider) };
      else diag.push('Яндекс: текста нет');
    } catch (e) {
      diag.push(`Яндекс: ${why(e)}`);
      log(`[lyrics] ${track.id} Яндекс: ${e.stack || e.message}`);
    }
  }
  // 2) Nyao LyricLabs — тексты, проверенные специалистами
  const own = await findLyrics(track, fetch, { base: NYAO_LYRICS_API, name: 'Nyao LyricLabs', search: false }).catch((e) => {
    diag.push(`Nyao LyricLabs: ${why(e)}`);
    return null;
  });
  if (own && own.synced) return own;
  if (!plain && own) plain = own;
  // 3) LRCLIB
  let lr = null;
  try {
    lr = await findLyrics(track, fetch);
  } catch (e) {
    diag.push(`LRCLIB: ${why(e)}`);
  }
  if (lr && lr.synced) return lr;
  if (!lr) diag.push('LRCLIB: текста нет');
  if (!plain && lr) plain = lr;
  // 3) YouTube Music (без таймингов)
  if (!plain && yt && track.source === 'yt') {
    const t = await yt.lyrics(track.srcId).catch((e) => {
      diag.push(`YouTube Music: ${why(e)}`);
      return null;
    });
    if (t) plain = { synced: false, lines: plainLines(t), source: 'YouTube Music' };
  }
  if (plain) return plain;
  log(`[lyrics] ${track.id} «${track.artist} — ${track.title}»: ${diag.join(' · ')}`);
  return { synced: false, lines: [], source: null, diag };
}
