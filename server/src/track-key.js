// Ключ трека «исполнитель|название» — те же правила, что в приложении (src/main/spotlight.js) и в nyao-spotlight-ml.
// Нужен серверу, чтобы ролик из Автоматора находился у любого клиента по названию трека из любого сервиса.
const BRACKETS = /[([{][^)\]}]*(feat|ft\.|prod|remaster|version|edit|live)[^)\]}]*[)\]}]/giu;
const FEAT_TAIL = /(?<![\p{L}\p{N}_])(feat|ft)\.?\s.*$/iu;
const NON_WORD = /[^\p{L}\p{N}_]+/gu;
const SPLIT_ARTIST = /,|&|\s+(?:feat|ft)\.?\s+|\s+x\s+/iu;

export function norm(s) {
  let t = String(s ?? '').normalize('NFKD').toLowerCase().replace(/ё/g, 'е');
  t = t.replace(/\p{Mn}/gu, '');
  t = t.replace(BRACKETS, ' ').replace(FEAT_TAIL, ' ').replace(NON_WORD, ' ').replace(/_/g, ' ');
  return t.split(/\s+/).filter(Boolean).join(' ');
}
export const firstArtist = (artist) => String(artist ?? '').split(SPLIT_ARTIST)[0].trim();
export function trackKey(artist, title) {
  const a = norm(firstArtist(artist)), t = norm(title);
  return a && t ? `${a}|${t}` : '';
}
const TR = Object.fromEntries([...'абвгдежзийклмнопрстуфхцчшщъыьэюя'].map((ch, i) => [ch,
  ['a', 'b', 'v', 'g', 'd', 'e', 'zh', 'z', 'i', 'i', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u',
    'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'][i]]));
const SIMPLE = [['ph', 'f'], ['kh', 'h'], ['ck', 'k'], ['w', 'v'], ['x', 'ks'], ['j', 'i'], ['y', 'i'], ['q', 'k'], ['c', 'k']];
/** «Кино» = «Kino», «Киркоров» = «Kirkorov»: латиница без различий в транслитерации */
export function soften(s) {
  let t = [...s].map(ch => TR[ch] ?? ch).join('');
  for (const [a, b] of SIMPLE) t = t.split(a).join(b);
  return t.replace(/([a-z])\1+/g, '$1');
}
export function looseKey(artist, title) {
  const k = trackKey(artist, title);
  if (!k) return '';
  const [a, t] = k.split('|');
  return `${soften(a)}|${soften(t)}`;
}

