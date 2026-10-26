import test from 'node:test';
import assert from 'node:assert/strict';
import { WavePolicy, sameRecording, recentAffinity } from '../src/main/wave-policy.js';
import { WaveMixer } from '../src/main/wave.js';
import { recencyPick } from '../src/main/freshness.js';
const track = (i, source = 'ya', extra = {}) => ({ id: `${source}:${i}`, source, srcId: String(i), title: `Song ${i}`, artist: `Artist ${i}`, duration: 200, available: true, ...extra });
const candidates = (n, kind, source = 'ya') => Array.from({ length: n }, (_, i) => ({ track: track(`${kind}${i}`, source), liked: kind !== 'related', recency: kind === 'recent' ? 0.9 : 0.05 }));
function seeded(seed = 1) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
test('maximum freshness in favorite mode makes recent likes the majority of the WHOLE wave', () => {
  const p = new WavePolicy({ random: seeded() });
  const input = [...candidates(100, 'recent'), ...candidates(100, 'library'), ...candidates(100, 'related')];
  const out = p.select(input, { diversity: 'favorite', fresh: 100, size: 100 });
  assert.equal(out.length, 100);
  assert.ok(p.kinds.recent >= 65 && p.kinds.recent <= 75, JSON.stringify(p.kinds));
  assert.ok(p.kinds.library >= 15); assert.ok(p.kinds.related <= 15);
});
test('one-item batches retain session category and provider quotas', () => {
  const p = new WavePolicy({ random: seeded() });
  const input = ['ya', 'yt', 'sc', 'vk', 'sp'].flatMap(s => candidates(100, 'library', s).map((c, i) => ({ ...c, track: track(`${s}${i}`, s) })));
  for (let i = 0; i < 100; i++) p.select(input, { diversity: 'favorite', fresh: 0, share: 40, size: 1 });
  assert.ok(Math.abs(p.sources.ya - 60) <= 5, JSON.stringify(p.sources));
  for (const s of ['yt', 'sc', 'vk', 'sp']) assert.ok(p.sources[s] >= 5, JSON.stringify(p.sources));
});
test('recording duplicate across catalogs plays once; live/remix/different duration stay distinct', () => {
  const a = track('a');
  const b = { ...a, id: 'yt:b', source: 'yt', duration: 202 };
  assert.ok(sameRecording(a, b));
  assert.ok(!sameRecording(a, { ...b, title: a.title + ' (Live)' }));
  assert.ok(!sameRecording(a, { ...b, title: a.title + ' (Remix)' }));
  assert.ok(!sameRecording(a, { ...b, duration: 250 }));
  const out = new WavePolicy().select([{ track: a }, { track: b }]);
  assert.equal(out.length, 1);
});
test('recent history and dislikes apply across services', () => {
  const a = track('a'); const b = { ...a, id: 'yt:b', source: 'yt' }; const c = track('c');
  const p = new WavePolicy();
  assert.equal(p.select([{ track: b }, { track: c }], { history: [a], size: 1 })[0].id, c.id);
  p.block(a);
  assert.equal(p.select([{ track: b }]).length, 0);
});
test('no repeats in a session, even after exhausting recent-history exclusions', () => {
  const p = new WavePolicy(); const input = candidates(10, 'library');
  assert.equal(p.select(input, { size: 10 }).length, 10);
  assert.equal(p.select(input).length, 0);
});
test('discover excludes liked recordings and artist repetition is avoided when alternatives exist', () => {
  const p = new WavePolicy({ random: seeded() });
  const input = [...candidates(8, 'library'), ...candidates(10, 'related')];
  const out = p.select(input, { diversity: 'discover', size: 8 });
  assert.ok(out.every(t => t.id.includes('related')));
  assert.equal(new Set(out.slice(0, 4).map(t => t.artist)).size, 4);
});
test('recency follows actual like date, otherwise original rank; release date is irrelevant', () => {
  const now = Date.now();
  assert.ok(recentAffinity(track('a', 'ya', { likedAt: now - 86400000 }), 200, 300, now) > 0.9);
  assert.ok(recentAffinity(track('b', 'ya', { likedAt: now - 365 * 86400000 }), 0, 300, now) < 0.01);
  assert.ok(recentAffinity(track('c'), 200, 300, now) < 0.01);
});
test('weighted sampling stays random beyond the underflow boundary', () => {
  const input = Array.from({ length: 400 }, (_, i) => ({ id: i }));
  const picked = recencyPick(input, 400, 100, seeded());
  assert.equal(new Set(picked).size, 400);
  assert.notDeepEqual(picked.slice(-20), input.slice(-20));
});
function provider(source, likes) {
  return { loggedIn: true, likedTracks: async () => likes, search: async () => [], waveStart: async () => [], waveMore: async () => [], waveFeedback: async () => {}, recommendations: async () => [], radio: async () => [], related: async () => [], home: async () => [] };
}
test('Spotify-only wave starts and produces likes without Yandex or recommendation endpoint', async () => {
  const sp = provider('sp', candidates(20, 'recent', 'sp').map(c => c.track));
  const m = new WaveMixer({ sp, getSettings: () => ({ waveDiversity: 'favorite', waveFresh: 100 }) });
  const out = await m.start();
  assert.ok(out.length); assert.ok(out.every(t => t.source === 'sp'));
});
test('a fresh Yandex like drives artist candidates in SoundCloud', async () => {
  const liked = track('seed', 'ya', { artist: 'Cross Artist', likedAt: Date.now() });
  const ya = provider('ya', [liked]); const sc = provider('sc', []); let query;
  sc.search = async q => { query = q; return [track('new', 'sc', { artist: 'Cross Artist' })]; };
  const m = new WaveMixer({ ya, sc, getSettings: () => ({ waveDiversity: 'any', waveFresh: 100, ytmShare: 50 }) });
  const out = await m.start();
  assert.equal(query, 'Cross Artist'); assert.ok(out.some(t => t.source === 'sc'));
});
test('slow old wave cannot overwrite new settings or profile', async () => {
  let resolveOld; let calls = 0;
  const ya = provider('ya', []);
  ya.likedTracks = () => ++calls === 1 ? new Promise(r => { resolveOld = r; }) : Promise.resolve([track('new')]);
  const m = new WaveMixer({ ya, getSettings: () => ({ waveDiversity: 'favorite' }) });
  const old = m.start();
  await new Promise(r => setImmediate(r));
  const current = await m.start();
  resolveOld([track('old')]);
  await assert.rejects(old, /отменён/);
  assert.ok(current.every(t => !t.id.includes('old')));
});

test('recently heard recent likes are not replaced wholesale by unheard ancient likes', () => {
  const recent = candidates(100, 'recent');
  const p = new WavePolicy({ random: seeded() });
  p.select([...recent, ...candidates(100, 'library'), ...candidates(100, 'related')], {
    diversity: 'favorite', fresh: 100, size: 100, recentIds: new Set(recent.map(c => c.track.id))
  });
  assert.ok(p.kinds.recent >= 65, JSON.stringify(p.kinds));
});
test('discovery cannot admit an unliked catalog copy of a liked recording', () => {
  const a = track('a'); const copy = { ...a, source: 'yt', id: 'yt:copy' };
  assert.equal(new WavePolicy().select([{ track: a, liked: true }, { track: copy }], { diversity: 'discover' }).length, 0);
});

test('restored wave does not enqueue its existing song again', async () => {
  const ya = provider('ya', [track('old'), track('new')]);
  const m = new WaveMixer({ ya, getSettings: () => ({ waveDiversity: 'favorite' }) });
  const result = await m.more(['ya:old']);
  assert.ok(result.length); assert.ok(result.every(t => t.id !== 'ya:old'));
});
test('dislike survives mixer restart and applies to a different catalog copy', async () => {
  let value = {}; const profile = { get: () => value, set: state => { value = JSON.parse(JSON.stringify(state)); } };
  const a = track('a');
  const m = new WaveMixer({ getSettings: () => ({}), profile });
  await m.feedback('dislike', a, 3);
  const sp = provider('sp', [{ ...a, id: 'sp:copy', source: 'sp' }, track('other', 'sp')]);
  const restarted = new WaveMixer({ sp, getSettings: () => ({ waveDiversity: 'favorite' }), profile });
  assert.ok((await restarted.start()).every(t => t.id !== 'sp:copy'));
});
test('failed source does not prevent wave from another source', async () => {
  const ya = provider('ya', []); ya.likedTracks = async () => { throw new Error('offline'); };
  ya.waveStart = async () => { throw new Error('offline'); };
  const sp = provider('sp', [track('good', 'sp')]);
  const m = new WaveMixer({ ya, sp, getSettings: () => ({ waveDiversity: 'favorite' }) });
  assert.equal((await m.start())[0].id, 'sp:good');
});

test('desktop and Android share a deterministic selection fixture', () => {
  let seed=42; const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const sources=['ya','yt','sc','vk','sp'];
  const input=Array.from({length:120},(_,i)=>({track:track(i,sources[i%5],{artist:'Артист '+i%8}),liked:i<80,recency:i<40?0.9:0.05,affinity:0}));
  assert.deepEqual(new WavePolicy({random}).select(input,{diversity:'favorite',fresh:100,share:40,size:20}).map(t=>t.id),["sp:9","ya:5","ya:75","vk:23","ya:0","yt:81","ya:30","sc:2","ya:40","ya:15","sc:22","ya:35","yt:66","ya:25","ya:20","ya:80","sp:19","vk:18","ya:45","vk:38"]);
});
