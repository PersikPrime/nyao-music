// Общая обвязка тестов Admin API: сервер на pg-mem, вход через поддельный Telegram
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { migrate } from '../src/db.js';
import { TelegramOIDC } from '../src/telegram.js';
import { createApp } from '../src/app.js';
import { StatusFile } from '../src/status.js';
import { LogBuffer } from '../src/logbuf.js';
import { GitHub } from '../src/github.js';
import { parseAdminIds, ROLES, cleanParams } from '../src/admin.js';

export async function setupAdmin({ admins = '777:owner', github = null, push = null } = {}) {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  await migrate(pool);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  // кто входит — меняется между входами (profile.id)
  const profile = { id: 777, name: 'Takko', username: 'takko' };
  const fakeFetch = async () => {
    const idToken = await new SignJWT({ id: profile.id, name: profile.name, preferred_username: profile.username, picture: null })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer('https://oauth.telegram.org').setAudience('1')
      .setSubject(String(profile.id)).setIssuedAt().setExpirationTime('1h').sign(privateKey);
    return new Response(JSON.stringify({ access_token: 'x', id_token: idToken }), { status: 200 });
  };
  const tg = new TelegramOIDC({ clientId: '1', clientSecret: 'sec', redirectUri: 'https://api.test/auth/telegram/callback', fetch: fakeFetch, keys: createLocalJWKSet({ keys: [jwk] }) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyao-status-'));
  const status = new StatusFile(path.join(dir, 'status.json'), 0);
  const logs = new LogBuffer(100);
  const mirror = { latest: () => ({ tag_name: 'v0.8.94', mirrored: true, assets: [] }), file: () => null, release: null, channels: {}, ready: new Set(), sync: async () => {}, dir };
  const app = createApp({ db: pool, tg, mirror, status, logs, push, log: (t) => logs.push('info', t), adminIds: parseAdminIds(admins), github, dataDir: dir });
  await app.admin.init();
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, token, build } = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(build ? { 'X-Nyao-Build': String(build) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, buf, headers: res.headers };
  };
  const login = async (id, { name = 'Юзер', username = `u${id}`, platform = 'win32', device = 'ПК' } = {}) => {
    Object.assign(profile, { id, name, username });
    const start = await call('POST', '/auth/start', { body: { device, platform } });
    const u = new URL(start.json.url);
    const cb = await call('GET', `/auth/telegram/callback?code=abc&state=${u.searchParams.get('state')}`);
    const poll = await call('GET', `/auth/poll?id=${start.json.id}`);
    return { ...poll.json, page: cb.text };
  };
  // сырое тело (файл) — как его шлёт Автоматор
  const raw = async (method, p, buf, token) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` }, body: buf });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
  return { server, call, raw, login, pool, status, logs, app, dir };
}

