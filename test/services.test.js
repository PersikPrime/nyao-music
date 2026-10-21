import test from 'node:test';
import assert from 'node:assert/strict';
import { PendingLikes } from '../src/main/pending-likes.js';
import { safeDiagnostic } from '../src/main/diagnostics.js';
import { VKProvider } from '../src/main/providers/vk.js';
import { YTMusicProvider, STREAM_CLIENTS } from '../src/main/providers/ytmusic.js';
import { YandexProvider } from '../src/main/providers/yandex.js';
import { SoundCloudProvider } from '../src/main/providers/soundcloud.js';
import { findMatch, similarity } from '../src/main/match.js';
import { SpotifySync } from '../src/renderer/spotify-sync.js';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function outbox(send = async () => {}) {
  let data = [], account = 'one';
  const box = new PendingLikes({ read: () => data, write: x => { data = x; }, account: () => account, send });
  return { box, data: () => data, account: x => { account = x; } };
}

test('outbox: toggle while sending preserves latest intent and serializes writes', async () => {
  const gate = deferred(), entered = deferred(), sent = [];
  const x = outbox(async item => { sent.push(item.on); if (sent.length === 1) { entered.resolve(); await gate.promise; } });
  x.box.enqueue({ srcId: '42' }, true);
  const flushing = x.box.flush();
  await entered.promise;
  x.box.enqueue({ srcId: '42' }, false);
  assert.equal(x.box.flush(), flushing);
  gate.resolve();
  assert.equal((await flushing).left, 0);
  assert.deepEqual(sent, [true, false]);
});

test('outbox: failures survive restart and never go to another account', async () => {
  const x = outbox(async () => { throw new Error('403'); });
  x.box.enqueue({ srcId: '42' }, true);
  assert.equal((await x.box.flush()).left, 1);
  x.account('two');
  assert.equal((await x.box.flush()).sent, 0);
  assert.equal(x.data().length, 1);
  x.box.enqueue({ srcId: '43' }, false);
  assert.deepEqual(x.box.list().map(i => i.srcId), ['43']);
});

test('outbox: a hopeless like (track gone) is dropped and does not block the rest', async () => {
  const sent = [];
  const x = outbox(async item => { if (item.srcId === 'gone') throw Object.assign(new Error('HTTP 404'), { status: 404 }); sent.push(item.srcId); });
  x.box.enqueue({ srcId: 'gone' }, true); x.box.enqueue({ srcId: 'ok' }, true);
  const r = await x.box.flush();
  assert.deepEqual(sent, ['ok']);
  assert.equal(r.dropped, 1);
  assert.equal(r.left, 0);
});

test('SoundCloud: stream link 404 is retried with a fresh track', async () => {
  let n = 0, tracks = 0;
  const track = () => ({ id: 5, title: 'x', track_authorization: 'auth' + (++tracks), media: { transcodings: [{ url: 'https://api-v2.soundcloud.com/media/5/hls', format: { protocol: 'hls', mime_type: 'audio/mpeg' } }] } });
  const res = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body) });
  const sc = new SoundCloudProvider({ fetch: async url => {
    if (url.includes('/media/5/hls')) { n++; return n < 3 ? res(404, {}) : res(200, { url: 'https://cdn/ok.m3u8?' + new URL(url).searchParams.get('track_authorization') }); }
    if (url.includes('/tracks')) return res(200, [track()]);
    throw new Error(url);
  } });
  sc.clientId = 'c'.repeat(32);
  sc.getClientId = async () => sc.clientId;
  const s = await sc.streamUrl('5');
  assert.equal(n, 3);
  assert.match(s.url, /ok\.m3u8\?auth3/);
});

test('outbox: account switch during sending stops further old operations', async () => {
  const gate = deferred(), entered = deferred(), ids = [];
  const x = outbox(async item => { ids.push(item.srcId); entered.resolve(); await gate.promise; });
  x.box.enqueue({ srcId: '1' }, true); x.box.enqueue({ srcId: '2' }, true);
  const running = x.box.flush(); await entered.promise;
  x.account('two'); gate.resolve(); await running;
  assert.deepEqual(ids, ['1']);
  assert.equal(x.data().length, 1);
});

test('diagnostics omit credentials and signed addresses', () => {
  for (const sample of ['Authorization: Bearer SECRET', 'Cookie: oauth_token=SECRET; datadome=SECRET', '{"access_token":"SECRET"}', 'failure https://cdn.test/SECRET?token=SECRET']) {
    assert.ok(!safeDiagnostic(sample).includes('SECRET'));
  }
  assert.ok(safeDiagnostic('HTTP 403').includes('403'));
});

const reply = code => new Response(JSON.stringify({ payload: [code, ['ok']] }));
test('VK: concurrent expired requests share one renewal and retry', async () => {
  let renewed = false, refreshes = 0;
  const gate = deferred(), entered = deferred();
  const vk = new VKProvider({ getUserId: async () => 7, fetch: async () => reply(renewed ? '0' : '3'),
    refreshSession: async () => { refreshes++; entered.resolve(); await gate.promise; renewed = true; return true; } });
  await vk.refresh();
  const a = vk.post('test'), b = vk.post('test');
  await entered.promise; gate.resolve();
  assert.deepEqual(await Promise.all([a, b]), [['ok'], ['ok']]);
  assert.equal(refreshes, 1);
  assert.ok(vk.loggedIn);
});

test('VK: network failure during renewal retains login', async () => {
  const vk = new VKProvider({ getUserId: async () => 7, fetch: async () => reply('3'), refreshSession: async () => null });
  await assert.rejects(vk.post('test'), /попробуй позже/);
  assert.ok(vk.loggedIn);
});

test('VK: a second explicit session rejection stops retrying', async () => {
  let calls = 0;
  const vk = new VKProvider({ getUserId: async () => 7, fetch: async () => { calls++; return reply('3'); }, refreshSession: async () => true });
  await assert.rejects(vk.post('test'), /войди заново/);
  assert.equal(calls, 2);
  assert.equal(vk.loggedIn, false);
});

test('VK: malformed responses are not copied into logs', async () => {
  const messages = [];
  const vk = new VKProvider({ getUserId: async () => 7, fetch: async () => new Response('SECRET web_token=sensitive'), debug: s => messages.push(s) });
  await assert.rejects(vk.post('test'));
  assert.ok(messages.length);
  assert.ok(!messages.join().includes('SECRET'));
});

test('YouTube: track cooldown survives session reset, expires, and leaves other songs alone', () => {
  const yt = new YTMusicProvider({});
  yt.reportBlocked(STREAM_CLIENTS[0], 'song');
  yt.resetStreamSession();
  assert.ok(!yt.clientOrder([], 'song').includes(STREAM_CLIENTS[0]));
  assert.ok(yt.clientOrder([], 'other').includes(STREAM_CLIENTS[0]));
  yt.blocked.set('song:' + STREAM_CLIENTS[0], Date.now() - 1);
  assert.ok(yt.clientOrder([], 'song').includes(STREAM_CLIENTS[0]));
});

test('YouTube: all rejected clients stay on cooldown without an immediate new round', async () => {
  const yt = new YTMusicProvider({});
  let calls = 0;
  yt.streamClient = async () => ({ session: { player: {} }, getBasicInfo: async () => {
    calls++; return { playability_status: { status: 'OK' }, chooseFormat: () => ({ decipher: async () => 'https://cdn.test/audio?expire=9999999999' }) };
  } });
  await assert.rejects(yt.streamUrl('song', async () => 403));
  assert.equal(calls, STREAM_CLIENTS.length);
});

test('SoundCloud: account change while reading /me cannot poison the new account cache', async () => {
  const gate = deferred(), entered = deferred();
  const sc = new SoundCloudProvider({ token: 'one', fetch: async () => { entered.resolve(); await gate.promise; return new Response(JSON.stringify({ id: 1 })); } });
  sc.clientId = 'id';
  const call = sc.getAccount(); await entered.promise; sc.setToken('two'); gate.resolve();
  await assert.rejects(call, /Аккаунт/);
  assert.equal(sc.account, null);
});

test('Yandex radio sends dislike to radio session without changing wave', async () => {
  const ya = new YandexProvider({});
  ya.radio = { sessionId: 'radio', batchId: 'batch' }; ya.wave = { sessionId: 'wave' };
  const calls = []; ya.request = async (...args) => { calls.push(args); };
  await ya.radioFeedback('dislike', { source: 'ya', srcId: '12', albumId: '34' }, 11);
  assert.equal(calls[0][1], '/rotor/session/radio/feedback');
  assert.equal(calls[0][2].json.event.trackId, '12:34');
  assert.equal(calls[0][2].json.event.totalPlayedSeconds, 11);
  assert.equal(ya.wave.sessionId, 'wave');
  await ya.radioFeedback('dislike', { source: 'yt' });
  assert.equal(calls.length, 1);
});

const song = { source: 'sp', srcId: '1', title: 'Song', artist: 'Artist', duration: 180 };
test('matching refuses live/remix substitutions and preview tracks', async () => {
  for (const title of ['Song (Live)', 'Song (Remix)', 'Song (Acoustic)', 'Song (Slowed)']) assert.equal(similarity(song, { ...song, title }), 0);
  assert.equal(await findMatch(song, async () => [{ ...song, preview: true }]), null);
  assert.equal((await findMatch(song, async () => [song])).score, 1);
});

test('Spotify: unconfirmed playback pauses instead of holding silence forever or consuming queue', () => {
  let pauses = 0, skips = 0;
  const player = { current: song, next: () => { skips++; }, audio: { paused: false, currentTime: 0, pause() { this.paused = true; } } };
  const sync = new SpotifySync(player, { pause: async () => { pauses++; } });
  sync.loaded = song.srcId; sync.pendingSince = Date.now() - 46_000;
  sync.tick();
  assert.equal(player.audio.paused, true);
  assert.equal(skips, 0);
  assert.equal(sync.loaded, null);
});

test('all shipped desktop JavaScript parses in Node', () => {
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(dir + '/' + x.name) : [dir + '/' + x.name]);
  for (const path of walk('src').filter(p => /\.(js|cjs)$/.test(p))) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, path + ': ' + result.stderr);
  }
});


// Isolate the production class from Electron's native host for lifecycle tests.
function engineClass() {
  const source = readFileSync('src/main/spotify/spotify-engine.js', 'utf8');
  const start = source.indexOf('export class SpotifyEngine');
  const end = source.indexOf('/** «', start);
  return new Function('safeDiagnostic', source.slice(start, end).replace('export class', 'class') + '\nreturn SpotifyEngine;')(safeDiagnostic);
}
test('Spotify readiness deadline includes a stalled engine start and removes its waiter', async () => {
  const Engine = engineClass();
  const engine = new Engine({ sp: {}, widevine: Promise.resolve({ ok: true }) });
  engine.open = () => new Promise(() => {});
  await assert.rejects(engine.awaitReady(20), /не ответил/);
  assert.equal(engine.readyWaiters.length, 0);
});

test('Spotify concurrent readiness requests share startup and release rejects pending waiters', async () => {
  const Engine = engineClass();
  const engine = new Engine({ sp: {}, widevine: Promise.resolve({ ok: true }) });
  let starts = 0;
  engine.open = () => { starts++; return new Promise(() => {}); };
  const a = engine.awaitReady(1000), b = engine.awaitReady(1000);
  engine.setStatus({ state: 'ready', deviceId: 'device' });
  assert.deepEqual(await Promise.all([a, b]), ['device', 'device']);
  assert.equal(starts, 1);
  assert.equal(engine.readyWaiters.length, 0);
  engine.setStatus({ state: 'loading' });
  const pending = engine.awaitReady(1000);
  engine.release();
  await assert.rejects(pending, /остановлен/);
  assert.equal(engine.readyWaiters.length, 0);
});
