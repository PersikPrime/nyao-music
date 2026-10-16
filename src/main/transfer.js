// Перенос плейлиста в другой сервис: каждый трек ищем там (см. match.js) и собираем новый плейлист.
import { findMatch } from './match.js';

export const TARGETS = { mix: 'Nyao-микс', ya: 'Яндекс Музыка', yt: 'YouTube Music' };

/**
 * tracks — что переносим, target — 'mix' | 'ya' | 'yt'.
 * search(source, query) → треки в сервисе; create(target, title, tracks) → id нового плейлиста.
 * onProgress({ done, total, found })
 */
export async function transferPlaylist({ tracks, title, target, search, create, onProgress = () => {}, concurrency = 4 }) {
  if (!TARGETS[target]) throw new Error('Сюда переносить пока нельзя');
  const list = (tracks || []).filter((t) => t && t.id);
  const out = new Array(list.length).fill(null);
  let done = 0;
  let found = 0;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const k = i++;
      const t = list[k];
      if (target === 'mix' || t.source === target) {
        out[k] = t; // в миксе живут треки любых сервисов, а «свои» треки искать не нужно
      } else {
        const m = await findMatch(t, (q) => search(target, q));
        if (m) out[k] = m.track;
      }
      done++;
      if (out[k]) found++;
      onProgress({ done, total: list.length, found });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, worker));
  const matched = [];
  const seen = new Set();
  for (const t of out) if (t && !seen.has(t.id)) {
    seen.add(t.id);
    matched.push(t);
  }
  const missing = list.filter((_, k) => !out[k]).map((t) => ({ title: t.title, artist: t.artist, source: t.source }));
  if (!matched.length) return { target, title, total: list.length, found: 0, missing, playlistId: null };
  const playlistId = await create(target, title, matched);
  return { target, title, total: list.length, found: matched.length, missing, playlistId };
}
