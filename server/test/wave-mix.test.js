import test from 'node:test';
import assert from 'node:assert/strict';
import { waveMixer, recKey } from '../src/wave-mix.js';

const reply = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });

function fakeFetch(calls) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname === 'ws.audioscrobbler.com' && u.searchParams.get('method') === 'track.getsimilar') {
      return reply({ similartracks: { track: [
        { name: 'Song A', match: 0.9, artist: { name: 'Band A' } },
        { name: 'Song A2', match: 0.8, artist: { name: 'Band A' } },
        { name: 'Song A3', match: 0.7, artist: { name: 'Band A' } },
        { name: 'Heard', match: 0.9, artist: { name: 'Band B' } },
        { name: 'Liked', match: 0.9, artist: { name: 'Seed' } }
      ] } });
    }
    if (u.hostname === 'ws.audioscrobbler.com') return reply({});
    if (u.pathname === '/search') return reply({ data: [{ artist: { id: 1 } }] });
    if (u.pathname === '/artist/1/related') return reply({ data: [{ id: 2, name: 'Band C' }] });
    if (u.pathname === '/artist/2/top') return reply({ data: [{ title: 'Song C', artist: { name: 'Band C' } }] });
    if (u.pathname === '/artist/1/top') return reply({ data: [{ title: 'Seed Hit', artist: { name: 'Seed' } }] });
    return reply({});
  };
}

test('своя волна: похожее из Last.fm и Deezer, без повторов, не больше двух треков исполнителя', async () => {
  const calls = [];
  const mix = waveMixer({ lastfmKey: 'k', fetch: fakeFetch(calls) });
  const out = await mix({ seeds: [{ artist: 'Seed', title: 'Liked' }], recent: [recKey('Band B', 'Heard')], size: 10 });
  const keys = out.map((t) => `${t.artist}|${t.title}`);
  assert.ok(keys.includes('Band C|Song C'), 'похожие исполнители из Deezer');
  assert.ok(!keys.includes('Band B|Heard'), 'недавнее не повторяем');
  assert.ok(!keys.includes('Seed|Liked'), 'сам трек-затравку не предлагаем');
  assert.ok(out.filter((t) => t.artist === 'Band A').length <= 2, 'не больше двух от исполнителя');
  assert.ok(out.every((t) => t.reason), 'у каждого трека есть причина');
});

test('своя волна: «незнакомое» без исполнителей из затравки, «любимое» добавляет их популярное', async () => {
  const mix = waveMixer({ lastfmKey: 'k', fetch: fakeFetch([]) });
  const disc = await mix({ seeds: [{ artist: 'Seed', title: 'Liked' }], diversity: 'discover' });
  assert.ok(!disc.some((t) => t.artist === 'Seed'));
  const fav = await mix({ seeds: [{ artist: 'Seed', title: 'Liked' }], diversity: 'favorite', size: 40 });
  assert.ok(fav.some((t) => t.title === 'Seed Hit'));
  assert.deepEqual(await mix({ seeds: [] }), []);
});
