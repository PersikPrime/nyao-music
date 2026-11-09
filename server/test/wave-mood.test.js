import test from 'node:test';
import assert from 'node:assert/strict';
import { moodTagger, scoreTags, pickMood } from '../src/wave-mood.js';

const reply = (v) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });

test('настроение: уверенный победитель или null', () => {
  assert.equal(pickMood(scoreTags([{ name: 'chill', count: 100 }, { name: 'Ambient', count: 60 }, { name: 'sad', count: 20 }])), 'calm');
  assert.equal(pickMood(scoreTags([{ name: 'chill', count: 100 }, { name: 'sad', count: 90 }])), null);
  assert.equal(pickMood(scoreTags([{ name: 'rock', count: 100 }])), null);
});

test('настроение: теги трека, при нехватке — исполнителя; одинаковое спрашиваем один раз; без ключа — null', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const m = u.searchParams.get('method');
    if (m === 'track.gettoptags' && u.searchParams.get('track') === 'Calm') return reply({ toptags: { tag: [{ name: 'chill', count: 100 }, { name: 'mellow', count: 50 }] } });
    if (m === 'track.gettoptags') return reply({ toptags: { tag: [] } });
    if (m === 'artist.gettoptags') return reply({ toptags: { tag: [{ name: 'metal', count: 100 }, { name: 'energetic', count: 40 }] } });
    return reply({});
  };
  const tag = moodTagger({ lastfmKey: 'k', fetch });
  const r = await tag([{ artist: 'A', title: 'Calm' }, { artist: 'B feat. C', title: 'Loud' }, { artist: 'A', title: 'Calm' }]);
  assert.deepEqual(r, ['calm', 'active', 'calm']);
  assert.equal(calls.filter((u) => u.includes('track=Calm')).length, 1);
  assert.ok(calls.some((u) => new URL(u).searchParams.get('method') === 'artist.gettoptags' && new URL(u).searchParams.get('artist') === 'B'));
  assert.deepEqual(await moodTagger({ fetch }) ([{ artist: 'A', title: 'Calm' }]), [null]);
});
