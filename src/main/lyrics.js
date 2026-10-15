// Тексты песен. Цепочка источников: Яндекс Музыка (лицензированные, по строкам) → LRCLIB (открытая база) → YouTube Music.

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

/** Только LRCLIB */
export async function findLyrics(track, fetch = globalThis.fetch) {
  const headers = { 'User-Agent': 'NyaoMusic/0.1 (https://github.com/)' };
  const artist = String(track.artist).split(',')[0].trim();
  const title = cleanTitle(track.title);
  const tryGet = async (url) => {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  };
  let data = null;
  try {
    const q = new URLSearchParams({ track_name: title, artist_name: artist });
    if (track.duration) q.set('duration', String(track.duration));
    data = await tryGet(`https://lrclib.net/api/get?${q}`);
    if (!data) {
      const list = await tryGet(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`);
      data = Array.isArray(list) ? list.find((l) => l.syncedLyrics) || list[0] : null;
    }
  } catch {
    return null;
  }
  if (!data) return null;
  if (data.syncedLyrics) return { synced: true, lines: parseLrc(data.syncedLyrics), source: 'LRCLIB' };
  if (data.plainLyrics) return { synced: false, lines: plainLines(data.plainLyrics), source: 'LRCLIB' };
  return null;
}

function plainLines(text) {
  return String(text).split(/\r?\n/).map((t) => ({ time: null, text: t.trim() }));
}

/**
 * Лучший текст из всех источников: с таймингами лучше, чем без.
 * ya, yt — провайдеры (или null, если сервис недоступен); matchYa(track) → трек Яндекса для трека другого сервиса.
 */
export async function findLyricsChain(track, { fetch = globalThis.fetch, ya = null, yt = null, matchYa = null } = {}) {
  let plain = null;
  const yaName = (p) => (p ? `Яндекс Музыка · ${p}` : 'Яндекс Музыка');
  // 1) Яндекс: сам трек или найденный в Яндексе такой же
  let yaId = track.source === 'ya' ? track.srcId : null;
  if (ya && !yaId && matchYa) {
    const m = await matchYa(track).catch(() => null);
    if (m) yaId = m.srcId;
  }
  if (ya && yaId) {
    const lrc = await ya.lyrics(yaId, 'LRC').catch(() => null);
    const lines = lrc ? parseLrc(lrc.text) : [];
    if (lines.length) return { synced: true, lines, source: yaName(lrc.provider) };
    const txt = await ya.lyrics(yaId, 'TEXT').catch(() => null);
    if (txt) plain = { synced: false, lines: plainLines(txt.text), source: yaName(txt.provider) };
  }
  // 2) LRCLIB
  const lr = await findLyrics(track, fetch).catch(() => null);
  if (lr && lr.synced) return lr;
  if (!plain && lr) plain = lr;
  // 3) YouTube Music (без таймингов)
  if (!plain && yt && track.source === 'yt') {
    const t = await yt.lyrics(track.srcId).catch(() => null);
    if (t) plain = { synced: false, lines: plainLines(t), source: 'YouTube Music' };
  }
  return plain;
}
