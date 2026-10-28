import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordLrc, findLyricsChain } from '../src/main/lyrics.js';

test('караоке: пословное время из Nyao LyricLabs', () => {
  const lines = parseWordLrc('[00:10.00] <00:10.00>Раз <00:10.50>два <00:11.20>\n[00:12.00] Без разметки\n[00:20.00] <00:20.00>аааааааааа');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0].words.map((w) => [w.text, w.time, w.end]), [['Раз', 10, 10.5], ['два', 10.5, 11.2]], 'конец слова — следующее слово или конечная метка');
  assert.equal(lines[0].text, 'Раз два');
  assert.equal(lines[1].words, undefined, 'строка без угловых меток — обычная');
  assert.equal(lines[1].text, 'Без разметки');
  const long = lines[2].words[0];
  assert.ok(long.end - long.time > 1, 'длинное слово тянется дольше короткого');
  // последнее слово без конечной метки не залезает на следующую строку
  const tight = parseWordLrc('[00:01.00] <00:01.00>длинноеслово\n[00:01.40] дальше');
  assert.equal(tight[0].words[0].end, 1.4);
});

test('караоке: при тексте из Яндекса берём Nyao LyricLabs, если там размечены слова', async () => {
  const track = { id: 'ya:1', source: 'ya', srcId: '1', title: 'Песня', artist: 'Группа', duration: 100 };
  const ya = { lyrics: async () => ({ text: '[00:01.00] Раз два', provider: 'LyricFind' }) };
  const reply = (body) => async (url) => (String(url).includes('corrode5-15') ? { ok: !!body, json: async () => body } : { ok: false, json: async () => null });
  const withWords = await findLyricsChain(track, { ya, fetch: reply({ syncedLyrics: '[00:01.00] Раз два', wordSyncedLyrics: '[00:01.00] <00:01.00>Раз <00:01.40>два' }) });
  assert.equal(withWords.source, 'Nyao LyricLabs');
  assert.equal(withWords.words, true);
  const lineOnly = await findLyricsChain(track, { ya, fetch: reply({ syncedLyrics: '[00:01.00] Раз два' }) });
  assert.match(lineOnly.source, /^Яндекс Музыка/, 'без пословной разметки — по-прежнему Яндекс');
  const none = await findLyricsChain(track, { ya, fetch: reply(null) });
  assert.match(none.source, /^Яндекс Музыка/);
});

test('порядок провайдеров: первый с таймингами, выключенные пропускаются, exclude', async () => {
  const { lyricsOrder } = await import('../src/main/lyrics.js');
  assert.deepEqual(lyricsOrder([{ id: 'lrclib', on: true }, { id: 'zzz' }, { id: 'ya', on: false }]).map((p) => `${p.id}:${p.on}`), ['lrclib:true', 'ya:false', 'nyao:true', 'ytm:true']);
  const track = { id: 'ya:1', source: 'ya', srcId: '1', title: 'Т', artist: 'А', duration: 100 };
  const ya = { lyrics: async (id, fmt) => (fmt === 'LRC' ? { text: '[00:01.00] из Яндекса', provider: 'P' } : null) };
  const fetch = async (url) => new Response(JSON.stringify(url.includes('lrclib') ? { syncedLyrics: '[00:01.00] из LRCLIB' } : null), { status: url.includes('lrclib') ? 200 : 404 });
  const first = await findLyricsChain(track, { ya, fetch, order: [{ id: 'lrclib' }, { id: 'ya' }] });
  assert.equal(first.lines[0].text, 'из LRCLIB');
  assert.equal(first.provider, 'lrclib');
  const yaFirst = await findLyricsChain(track, { ya, fetch });
  assert.equal(yaFirst.provider, 'ya');
  const other = await findLyricsChain(track, { ya, fetch, exclude: ['ya'] });
  assert.equal(other.provider, 'lrclib');
  const off = await findLyricsChain(track, { ya, fetch, order: [{ id: 'ya', on: false }, { id: 'lrclib', on: false }, { id: 'nyao', on: false }, { id: 'ytm', on: false }] });
  assert.equal(off.lines.length, 0);
});

test('проверка одного источника: остальные не подмешиваются', async () => {
  const { LYRICS_PROVIDERS } = await import('../src/main/lyrics.js');
  const track = { id: 'ya:1', source: 'ya', srcId: '1', title: 'Т', artist: 'А', duration: 100 };
  const ya = { lyrics: async () => null };
  const fetch = async (url) => new Response(JSON.stringify(url.includes('lrclib') ? { plainLyrics: 'из LRCLIB' } : null), { status: url.includes('lrclib') ? 200 : 404 });
  const only = (id) => LYRICS_PROVIDERS.map((p) => ({ id: p, on: p === id }));
  const yaOnly = await findLyricsChain(track, { ya, fetch, order: only('ya'), wordsFirst: false });
  assert.equal(yaOnly.lines.length, 0, 'Яндекс ничего не нашёл — LRCLIB не подставляется');
  const lr = await findLyricsChain(track, { ya, fetch, order: only('lrclib'), wordsFirst: false });
  assert.equal(lr.provider, 'lrclib');
});
