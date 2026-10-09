// Тексты песен из открытой базы LRCLIB (lrclib.net) — одинаково для треков обоих сервисов.

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
  if (data.syncedLyrics) return { synced: true, lines: parseLrc(data.syncedLyrics) };
  if (data.plainLyrics) return { synced: false, lines: data.plainLyrics.split(/\r?\n/).map((text) => ({ time: null, text })) };
  return null;
}
