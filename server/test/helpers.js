import assert from 'node:assert/strict';
import http from 'node:http';
import { newDb } from 'pg-mem';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { migrate } from '../src/db.js';
import { TelegramOIDC } from '../src/telegram.js';
import { createApp } from '../src/app.js';

export async function setup() {
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

export async function login(call, device) {
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

