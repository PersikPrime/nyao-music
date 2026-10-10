import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { migrate } from '../src/db.js';
import { TelegramOIDC } from '../src/telegram.js';
import { createApp } from '../src/app.js';

async function setup() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  let lastTokenReq = null;
  const fakeFetch = async (url, opts) => {
    lastTokenReq = { url, opts };
    const idToken = await new SignJWT({ id: 777, name: 'Takko', preferred_username: 'takko', picture: 'https://t.me/i/userpic/1.jpg' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://oauth.telegram.org').setAudience('8853157969')
      .setSubject('777').setIssuedAt().setExpirationTime('1h').sign(privateKey);
    return new Response(JSON.stringify({ access_token: 'x', id_token: idToken }), { status: 200 });
  };
  const tg = new TelegramOIDC({ clientId: '8853157969', clientSecret: 'sec', redirectUri: 'https://api.test/auth/telegram/callback', fetch: fakeFetch, keys: createLocalJWKSet({ keys: [jwk] }) });
  const mirror = { latest: () => ({ tag_name: 'v0.4.1', assets: [] }), file: () => null };
  const server = http.createServer(createApp({ db: pool, tg, mirror, log: () => {} }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, token } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
  return { server, call, last: () => lastTokenReq };
}

async function login(call, device) {
  const start = await call('POST', '/auth/start', { body: { device, platform: 'win32' } });
  assert.equal(start.status, 200);
  const u = new URL(start.json.url);
  assert.equal(u.origin + u.pathname, 'https://oauth.telegram.org/auth');
  assert.equal(u.searchParams.get('client_id'), '8853157969');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal((await call('GET', `/auth/poll?id=${start.json.id}`)).json.status, 'pending');
  const cb = await call('GET', `/auth/telegram/callback?code=abc&state=${u.searchParams.get('state')}`);
  assert.match(cb.text, /Привет, Takko/);
  const poll = await call('GET', `/auth/poll?id=${start.json.id}`);
  assert.equal(poll.json.status, 'done');
  assert.equal((await call('GET', `/auth/poll?id=${start.json.id}`)).status, 410, 'токен отдаётся один раз');
  return poll.json;
}

test('вход, синхронизация, история, продолжение', async () => {
  const { server, call, last } = await setup();
  try {
    assert.equal((await call('GET', '/me')).status, 401);
    const a = await login(call, 'ПК');
    assert.equal(a.user.name, 'Takko');
    assert.match(last().opts.headers.Authorization, /^Basic /);
    assert.match(last().opts.body, /code_verifier=/);
    const b = await login(call, 'Pixel');
    assert.equal(b.user.id, a.user.id, 'тот же аккаунт');

    const me = await call('GET', '/me', { token: a.token });
    assert.equal(me.json.devices.length, 2);

    // state: побеждает свежая запись
    await call('PUT', '/state/mixes', { token: a.token, body: { data: [{ id: 'mix:1' }], updatedAt: 2000 } });
    const stale = await call('PUT', '/state/mixes', { token: b.token, body: { data: [], updatedAt: 1000 } });
    assert.equal(stale.json.stale, true);
    const st = await call('GET', '/state', { token: b.token });
    assert.deepEqual(st.json.mixes.data, [{ id: 'mix:1' }]);
    assert.equal((await call('PUT', '/state/BAD KEY', { token: a.token, body: { data: 1 } })).status, 400);

    // history
    await call('POST', '/history', { token: a.token, body: { plays: [{ trackId: 'ya:1', source: 'ya', title: 'Пачка сигарет', artist: 'Кино', playedAt: Date.now() - 1000, listened: 200 }, { trackId: 'sc:5', skipped: true }] } });
    const h = await call('GET', '/history?days=3', { token: b.token });
    assert.equal(h.json.plays.length, 2);
    assert.ok(h.json.plays.some((p) => p.trackId === 'ya:1' && p.artist === 'Кино'));

    // now playing: телефон видит ПК, но не себя
    await call('PUT', '/now', { token: a.token, body: { track: { id: 'ya:1', source: 'ya', srcId: '1', title: 'Пачка сигарет', artist: 'Кино', duration: 270 }, position: 133, playing: true } });
    const nowB = await call('GET', '/now', { token: b.token });
    assert.equal(nowB.json.devices.length, 1);
    assert.equal(nowB.json.devices[0].device, 'ПК');
    assert.equal(nowB.json.devices[0].position, 133);
    assert.equal((await call('GET', '/now', { token: a.token })).json.devices.length, 0);

    // выход с одного устройства
    await call('POST', '/auth/logout', { token: b.token });
    assert.equal((await call('GET', '/me', { token: b.token })).status, 401);
    assert.equal((await call('GET', '/me', { token: a.token })).status, 200);
    assert.equal((await call('GET', '/updates/latest')).json.tag_name, 'v0.4.1');
  } finally {
    server.close();
  }
});

test('устаревший state отклоняется', async () => {
  const { server, call } = await setup();
  try {
    const cb = await call('GET', '/auth/telegram/callback?code=abc&state=nope');
    assert.match(cb.text, /Ссылка устарела/);
  } finally {
    server.close();
  }
});
