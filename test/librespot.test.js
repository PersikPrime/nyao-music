import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { LibrespotEngine } from '../src/main/spotify/librespot-engine.js';
import { SpotifyExperiment } from '../src/main/spotify/experiment.js';
import { librespotCard } from '../src/renderer/librespot-ui.js';
import { compatOf } from '../src/main/hot.js';
import { SpotifyProvider, SP_REDIRECT } from '../src/main/providers/spotify.js';
import { SpotifySync } from '../src/renderer/spotify-sync.js';
import { spMode } from '../src/renderer/sp-mode.js';

const uri = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC';
function fixture() {
  let permitted = true;
  const workers = [], commands = [], options = [], events = [];
  const engine = new LibrespotEngine({
    api: { accessToken: async () => 'PRIVATE_TOKEN' }, binary: fileURLToPath(import.meta.url),
    deviceId: 'local-device', allowed: () => permitted, onChange: e => events.push(e),
    spawnFn: (binary, args, opts) => {
      options.push({ binary, args, opts });
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(data, _, done) {
        const c = JSON.parse(data.toString()); commands.push(c);
        queueMicrotask(() => child.stdout.write(JSON.stringify({
          id: c.id, ok: true, data: c.command === 'ping' ? { protocol: 1 } : c.command === 'connect' ? { username: 'local-user' } : null,
        }) + '\n'));
        done();
      } });
      child.kill = () => { child.killed = true; };
      workers.push(child); return child;
    },
  });
  return { engine, workers, commands, options, events, revoke: () => { permitted = false; } };
}

test('librespot: disabled flag cannot start a worker or fetch credentials', async () => {
  const f = fixture(); f.revoke();
  await assert.rejects(f.engine.awaitReady(), /выключен/);
  assert.equal(f.workers.length, 0);
});
test('librespot: private IPC, transport, generation and cleanup', async () => {
  const f = fixture(), e = f.engine;
  try {
    await e.playUris([uri], 5000);
    assert.equal(f.options.length, 1);
    assert.ok(!JSON.stringify(f.options).includes('PRIVATE_TOKEN'));
    assert.ok(!JSON.stringify(f.events).includes('PRIVATE_TOKEN'));
    assert.equal(f.commands.find(c => c.command === 'connect').accessToken, 'PRIVATE_TOKEN');
    const generation = f.commands.find(c => c.command === 'play').generation;
    e.receive({ event: 'state', generation: generation - 1, snapshot: { uri, position: 99 } });
    assert.equal(e.snapshot, null);
    await e.pause(); await e.resume(); await e.seek(12000); await e.setVolume(0.2);
    e.receive({ event: 'state', generation, snapshot: { uri, position: 12000, duration: 200000, paused: false } });
    assert.equal(e.snapshot.position, 12000, 'pause does not discard subsequent state');
    assert.equal(e.snapshot.paused, false);
    assert.equal(f.commands.find(c => c.command === 'seek').positionMs, 12000);
    e.release();
    assert.equal(f.workers[0].killed, true); assert.equal(e.calls.size, 0);
    assert.equal(e.snapshot, null);
  } finally { e.release(); }
});
test('librespot: newest startup request wins, pause cancels pending play', async () => {
  const f = fixture(), e = f.engine;
  try {
    await Promise.all([e.playUris([uri], 1), e.playUris([uri], 2)]);
    assert.deepEqual(f.commands.filter(c => c.command === 'play').map(c => c.positionMs), [2]);
    e.release(); f.commands.length = 0;
    const pending = e.playUris([uri]); await e.pause(); await pending;
    assert.equal(f.commands.some(c => c.command === 'play'), false);
  } finally { e.release(); }
});
test('librespot: crash and playback failure retire the old worker before retry', async () => {
  const f = fixture(), e = f.engine;
  try {
    await e.playUris([uri]);
    e.receive({ event: 'error', generation: e.intent, kind: 'playback', code: 'unavailable' });
    await e.playUris([uri], 3);
    assert.equal(f.workers.length, 2); assert.ok(f.workers[0].killed);
    f.workers[1].emit('exit', 1);
    assert.equal(e.status.state, 'failed'); assert.equal(e.started, false);
    await e.playUris([uri]); assert.equal(f.workers.length, 3);
    await assert.rejects(e.playUris(['file:///etc/passwd']), /Некорректная/);
  } finally { e.release(); }
});
test('librespot: loader refusal stops playback and preserves only safe stage codes', async () => {
  const f = fixture(), e = f.engine;
  try {
    await e.playUris([uri]);
    e.receive({ event: 'error', generation: e.intent - 1, code: 'audio_key_rejected', diagnostics: ['metadata_failed'] });
    assert.equal(e.status.state, 'ready');
    e.receive({ event: 'error', generation: e.intent, kind: 'playback', code: 'audio_key_rejected',
      diagnostics: ['audio_key_rejected', 'decoder_failed', 'Bearer PRIVATE_TOKEN', '__proto__', { token: 'PRIVATE_TOKEN' }] });
    assert.equal(e.status.kind, 'engine', 'renderer stops instead of skipping the entire queue');
    assert.deepEqual(e.diagnostics, ['audio_key_rejected', 'decoder_failed']);
    assert.match(e.debugText(), /audio_key_rejected/);
    assert.ok(!e.debugText().includes('PRIVATE_TOKEN'));
    assert.ok(!e.debugText().includes('__proto__'));
    assert.ok(!JSON.stringify(f.events).includes('PRIVATE_TOKEN'));
    assert.equal(f.commands.filter(c => c.command === 'play').length, 1);
    e.receive({ event: 'error', generation: e.intent, kind: 'playback', code: 'unavailable' });
    assert.equal(e.status.kind, 'engine', 'older workers stop too');
    assert.doesNotMatch(e.status.message, /Этот трек недоступен/);
  } finally { e.release(); }
});
test('experiment: flag and role gate both provider and engine, SDK account stays intact', () => {
  const data = { experimentalLibrespot: false, librespotActive: false };
  let allowed = true, nativeStops = 0, sdkStops = 0;
  const standardApi = { loggedIn: true, search: () => 'sdk' }, nativeApi = { loggedIn: true, search: () => 'native' };
  const x = new SpotifyExperiment({ standardApi, nativeApi, allowed: () => allowed,
    standardEngine: { release: () => sdkStops++ },
    nativeEngine: { available: true, release: () => nativeStops++ },
    settings: { get: () => data, set: patch => Object.assign(data, patch) },
  });
  assert.equal(x.api.search(), 'sdk');
  data.experimentalLibrespot = true;
  x.select(false); assert.equal(sdkStops, 0, 'editing native account preserves SDK playback');
  x.select(true); assert.equal(sdkStops, 1);
  assert.equal(x.api.search(), 'native');
  allowed = false; assert.equal(x.api.search(), 'sdk');
  allowed = true; x.disable();
  assert.equal(x.active, false); assert.equal(x.visible, false); assert.ok(nativeStops >= 2);
  assert.equal(standardApi.loggedIn, true); assert.equal(nativeApi.loggedIn, true);
});
test('native card is hidden by default, separate OAuth callback and installer compatibility', () => {
  assert.equal(librespotCard({ permitted: false, flag: true }), '');
  assert.equal(librespotCard({ permitted: true, flag: false }), '');
  const card = librespotCard({ permitted: true, flag: true, available: true }, String);
  assert.match(card, /Spotify \(librespot\)/); assert.match(card, /data-action="native-login"/);
  const store = { get: () => null, set: () => {} };
  assert.equal(new SpotifyProvider({ store }).redirectUri, SP_REDIRECT);
  assert.equal(new SpotifyProvider({ store, redirectUri: 'http://127.0.0.1:43820/spotify-callback' }).redirectUri, 'http://127.0.0.1:43820/spotify-callback');
  assert.notEqual(compatOf({}), compatOf({ nyaoNativeAbi: 1 }), 'old installers cannot accept a code-only update needing the native worker');
});
test('Spotify sync: completion of an old play cannot pause the newer Spotify track', async () => {
  const oldMode = spMode.fallback; spMode.fallback = false;
  let pauses = 0; const completions = [];
  const a = { source: 'sp', srcId: 'a' }, b = { source: 'sp', srcId: 'b' };
  const player = { current: a, queue: [a], index: 0, audio: { paused: false, currentTime: 0, volume: 1 } };
  const api = { play: () => new Promise(r => completions.push(r)), pause: async () => { pauses++; }, volume: async () => {} };
  try {
    const sync = new SpotifySync(player, api);
    sync.reconcile();
    player.current = b; player.queue = [b]; sync.reconcile();
    completions[0](); await Promise.resolve();
    assert.equal(pauses, 0);
    completions[1](); await Promise.resolve();
  } finally { spMode.fallback = oldMode; }
});
test('Spotify sync: backend switch preserves the position before HTML audio reloads', async () => {
  const oldMode = spMode.fallback; spMode.fallback = false;
  const t = { source: 'sp', srcId: 'a' }, positions = [];
  const player = { current: t, queue: [t], index: 0, audio: { paused: false, currentTime: 45, volume: 1 } };
  const api = { play: async (_uris, position) => { positions.push(position); }, volume: async () => {} };
  try {
    const sync = new SpotifySync(player, api);
    sync.resetBackend(); player.audio.currentTime = 0;
    sync.reconcile(); await Promise.resolve();
    assert.deepEqual(positions, [45000]);
  } finally { spMode.fallback = oldMode; }
});
