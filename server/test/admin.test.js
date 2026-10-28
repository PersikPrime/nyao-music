// Admin API для Nyao Automator: без входа — 401, без права — 403 с записью «попытка» в журнал, с правом — работает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
import { zipFiles, unzip } from '../src/zip.js';

async function setup({ admins = '777:owner', github = null, push = null } = {}) {
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
  return { server, call, login, pool, status, logs, app, dir };
}

test('роли и права: разбор ADMIN_IDS, запасной вариант через DEV_IDS, чистка секретов', () => {
  const m = parseAdminIds('111:owner, 222:lyrics,bad:owner,333:nope');
  assert.deepEqual([...m], [['111', 'owner'], ['222', 'lyrics']]);
  assert.deepEqual([...parseAdminIds('', ['444', 'x'])], [['444', 'owner']]);
  assert.ok(ROLES.admin.includes('users.ban') && !ROLES.admin.includes('ops.deploy') && !ROLES.admin.includes('lyrics.roles'));
  assert.ok(ROLES.viewer.every((p) => p.endsWith('.read') || p === 'audit.all'));
  assert.ok(ROLES.support.includes('users.sessions') && !ROLES.support.includes('users.ban'));
  assert.deepEqual(cleanParams({ reason: 'x', token: 'secret', nested: { password: '1', ok: 2 } }), { reason: 'x', nested: { ok: 2 } });
});

test('zip: собрать и разобрать', () => {
  const z = zipFiles([{ name: 'a.txt', data: 'привет' }, { name: 'dir/b.bin', data: Buffer.from([1, 2, 3]) }]);
  const f = unzip(z);
  assert.deepEqual(f.map((x) => x.name), ['a.txt', 'dir/b.bin']);
  assert.equal(f[0].data.toString(), 'привет');
});

test('без входа 401, чужому 403 с записью «попытка», владельцу — /admin/me с правами', async () => {
  const { server, call, login, pool } = await setup();
  try {
    assert.equal((await call('GET', '/admin/me')).status, 401);
    const guest = await login(100);
    const denied = await call('GET', '/admin/me', { token: guest.token });
    assert.equal(denied.status, 403);
    const att = await pool.query(`SELECT * FROM admin_audit WHERE action = 'attempt'`);
    assert.equal(att.rows.length, 1);
    assert.equal(att.rows[0].admin_tg, '100');

    const owner = await login(777, { name: 'Takko', username: 'takko', platform: 'automator', device: 'Automator' });
    const me = await call('GET', '/admin/me', { token: owner.token });
    assert.equal(me.status, 200);
    assert.equal(me.json.role, 'owner');
    assert.ok(me.json.permissions.includes('users.ban'));
    // сессия Automator видна в устройствах владельца
    const dev = await call('GET', '/me', { token: owner.token });
    assert.ok(dev.json.devices.some((d) => d.platform === 'automator'));
  } finally {
    server.close();
  }
});

test('viewer читает, но не меняет; попытка — в журнале', async () => {
  const { server, call, login, pool } = await setup({ admins: '777:viewer' });
  try {
    const v = await login(777);
    assert.equal((await call('GET', '/admin/users', { token: v.token })).status, 200);
    assert.equal((await call('GET', '/admin/status', { token: v.token })).status, 200);
    const w = await call('PUT', '/admin/status', { token: v.token, body: { maintenance: { active: true } } });
    assert.equal(w.status, 403);
    assert.match(w.json.error, /status\.write/);
    const att = await pool.query(`SELECT * FROM admin_audit WHERE action = 'attempt' AND target_id = 'status.write'`);
    assert.equal(att.rows.length, 1);
    assert.equal(att.rows[0].role, 'viewer');
  } finally {
    server.close();
  }
});

test('пользователи: список с отбором, карточка, завершение сессий, блокировка не пускает', async () => {
  const { server, call, login, pool } = await setup({ admins: '777:owner,555:support' });
  try {
    const owner = await login(777);
    const bob = await login(200, { name: 'Боб', username: 'bob', platform: 'android', device: 'Телефон' });
    await call('GET', '/me', { token: bob.token, build: 90 });
    const bobPc = await login(200, { name: 'Боб', username: 'bob', platform: 'win32' });
    await call('GET', '/me', { token: bobPc.token, build: 94 });
    await call('POST', '/history', { token: bob.token, build: 90, body: { plays: [{ trackId: 'ya:1', source: 'ya', title: 'T', artist: 'A', duration: 100, listened: 90, playedAt: new Date().toISOString() }] } });

    const list = await call('GET', '/admin/users?q=bob', { token: owner.token });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 1);
    const b = list.json.items[0];
    assert.equal(b.tgId, '200');
    assert.deepEqual(b.platforms.sort(), ['android', 'win32']);
    assert.equal(b.build, 94);
    assert.equal(b.plays30, 1);
    assert.equal((await call('GET', '/admin/users?platform=android', { token: owner.token })).json.total, 1);
    assert.equal((await call('GET', '/admin/users?build_lt=95', { token: owner.token })).json.total, 1);
    assert.equal((await call('GET', '/admin/users?build_lt=94', { token: owner.token })).json.total, 0);

    const card = await call('GET', `/admin/users/${b.id}`, { token: owner.token });
    assert.equal(card.status, 200);
    assert.equal(card.json.sessions.length, 2);
    assert.equal(card.json.plays.count, 1);
    assert.equal(card.json.plays.topArtists[0].artist, 'A');

    // support может завершить сессии, но не блокировать
    const sup = await login(555, { name: 'Саппорт' });
    const rev = await call('POST', `/admin/users/${b.id}/sessions/revoke`, { token: sup.token, body: { sessionId: card.json.sessions[1].id } });
    assert.equal(rev.status, 200);
    assert.equal((await call('GET', `/admin/users/${b.id}`, { token: owner.token })).json.sessions.length, 1);
    assert.equal((await call('POST', `/admin/users/${b.id}/ban`, { token: sup.token, body: { reason: 'спам' } })).status, 403);

    assert.equal((await call('POST', `/admin/users/${b.id}/ban`, { token: owner.token, body: {} })).status, 400);
    const ban = await call('POST', `/admin/users/${b.id}/ban`, { token: owner.token, body: { reason: 'спам' } });
    assert.equal(ban.status, 200);
    // сессии завершены, старый токен не работает
    assert.equal((await call('GET', '/me', { token: bobPc.token })).status, 401);
    // новый вход не проходит
    const again = await login(200);
    assert.match(again.page, /заблокирован/);
    assert.equal(again.token, undefined);
    assert.equal((await call('GET', '/admin/users?banned=1', { token: owner.token })).json.total, 1);
    // журнал по пользователю
    const card2 = await call('GET', `/admin/users/${b.id}`, { token: owner.token });
    assert.equal(card2.json.banned.reason, 'спам');
    assert.ok(card2.json.audit.some((a) => a.action === 'users.ban' && a.params.reason === 'спам'));
    await call('POST', `/admin/users/${b.id}/unban`, { token: owner.token });
    const back = await login(200);
    assert.ok(back.token);
    // журнал владельцу виден весь, саппорту — только свой
    const all = await call('GET', '/admin/audit', { token: owner.token });
    assert.ok(all.json.total >= 4);
    const mine = await call('GET', '/admin/audit', { token: sup.token });
    assert.ok(mine.json.items.every((a) => a.admin.tgId === '555'));
    const n = await pool.query('SELECT count(*) AS n FROM admin_audit');
    assert.ok(Number(n.rows[0].n) >= 4);
  } finally {
    server.close();
  }
});

test('статус: применить, история, минимальная сборка на лету, расписание', async () => {
    const { server, call, login, status, app } = await setup();
  try {
    const owner = await login(777);
    const put = await call('PUT', '/admin/status', { token: owner.token, body: { maintenance: { active: true, title: 'Чиним', until: 'до 18:00' }, outages: ['ya', 'bogus'], minBuild: 90 } });
    assert.equal(put.status, 200);
    assert.equal(put.json.status.maintenance.active, true);
    assert.deepEqual(put.json.status.outages, ['ya']);
    const pub = await call('GET', '/status');
    assert.equal(pub.json.maintenance.title, 'Чиним');
    assert.equal((await call('GET', '/health')).json.minBuild, 90);
    // старая сборка Music теперь получает 426, а Automator — нет
    assert.equal((await call('GET', '/me', { token: owner.token, build: 80 })).status, 426);
    assert.equal((await call('GET', '/admin/me', { token: owner.token, build: 80 })).status, 200);
    assert.equal((await call('POST', '/auth/logout', { token: (await login(778)).token })).status, 200, 'выход работает без заголовка сборки');
    const hist = await call('GET', '/admin/status/history', { token: owner.token });
    assert.equal(hist.json.items.length, 1);
    assert.equal(hist.json.items[0].by.name, 'Юзер');
    await call('PUT', '/admin/status', { token: owner.token, body: { maintenance: { active: false } } });
    assert.equal(status.get().maintenance.active, false);

    // расписание: включить «в прошлом» на 1 минуту → tick включает, tick через 2 минуты выключает
    const at = new Date(Date.now() - 1000);
    const sch = await call('POST', '/admin/status/schedule', { token: owner.token, body: { at: at.toISOString(), durationMin: 1, maintenance: { title: 'Плановые' } } });
    assert.equal(sch.status, 200);
    assert.equal(sch.json.item.state, 'planned');
    await app.admin.tick(new Date());
    assert.equal(status.get().maintenance.active, true);
    assert.equal(status.get().maintenance.title, 'Плановые');
    await app.admin.tick(new Date(Date.now() + 120_000));
    assert.equal(status.get().maintenance.active, false);
    const after = await call('GET', '/admin/status', { token: owner.token });
    assert.equal(after.json.schedule.length, 0);
    assert.equal((await call('GET', '/admin/status/history', { token: owner.token })).json.items.length, 4);
    const del = await call('POST', '/admin/status/schedule', { token: owner.token, body: { at: new Date(Date.now() + 3_600_000).toISOString(), durationMin: 30 } });
    assert.equal((await call('DELETE', `/admin/status/schedule/${del.json.item.id}`, { token: owner.token })).status, 200);
  } finally {
    server.close();
  }
});

test('лейбл: без префикса кодов нет; коды не повторяются при гонке; релизы и треки', async () => {
  const { server, call, login } = await setup({ admins: '777:label' });
  try {
    const me = await login(777);
    assert.equal((await call('POST', '/admin/label/isrc/next', { token: me.token, body: { trackTitle: 'x' } })).status, 409);
    assert.equal((await call('PUT', '/admin/label/settings', { token: me.token, body: { prefix: 'bad' } })).status, 400);
    const st = await call('PUT', '/admin/label/settings', { token: me.token, body: { prefix: 'ru-a1b' } });
    assert.equal(st.json.prefix, 'RU-A1B');
    const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
    assert.equal((await call('GET', '/admin/label/settings', { token: me.token })).json.next, `RUA1B${yy}00001`);
    const codes = await Promise.all(Array.from({ length: 6 }, (_, i) => call('POST', '/admin/label/isrc/next', { token: me.token, body: { trackTitle: `Трек ${i}` } })));
    assert.ok(codes.every((c) => c.status === 200), codes.map((c) => c.status).join());
    assert.equal(new Set(codes.map((c) => c.json.code)).size, 6, 'все коды разные');
    // лейбл не лезет в пользователей
    assert.equal((await call('GET', '/admin/users', { token: me.token })).status, 403);

    const rel = await call('POST', '/admin/label/releases', { token: me.token, body: { title: 'Сингл', artists: 'Takko', status: 'preparing', upc: '123' } });
    assert.equal(rel.status, 200);
    const id = rel.json.item.id;
    const tr = await call('POST', `/admin/label/releases/${id}/tracks`, { token: me.token, body: { title: 'Песня', duration: 200 } });
    assert.equal(tr.json.item.position, 1);
    const next = await call('POST', '/admin/label/isrc/next', { token: me.token, body: { trackId: tr.json.item.id } });
    assert.equal(next.status, 200);
    const card = await call('GET', `/admin/label/releases/${id}`, { token: me.token });
    assert.equal(card.json.tracks[0].isrc, next.json.code);
    assert.equal((await call('POST', '/admin/label/isrc/next', { token: me.token, body: { trackId: tr.json.item.id } })).status, 409, 'второй код тому же треку не выдаётся');
    assert.equal((await call('PUT', `/admin/label/releases/${id}`, { token: me.token, body: { status: 'released' } })).json.item.status, 'released');
    assert.equal((await call('GET', '/admin/label/releases', { token: me.token })).json.items[0].tracks, 1);
  } finally {
    server.close();
  }
});

test('LyricLabs: очередь, массовое принятие, откат, выгрузка архивом', async () => {
  const { server, call, login, pool } = await setup({ admins: '777:lyrics' });
  try {
    const me = await login(777);
    const author = await login(300, { name: 'Автор' });
    // трек и две версии — напрямую в базу (как после /api/submit)
    const t = await pool.query(`INSERT INTO lyrics_tracks (title, artist, duration, title_norm, artist_norm, isrc) VALUES ('Песня', 'Группа', 120, 'песня', 'группа', 'RUA1B2500001') RETURNING id`);
    const tid = t.rows[0].id;
    const v1 = await pool.query(`INSERT INTO lyrics_versions (track_id, author_id, plain, synced) VALUES ($1, $2, 'строка один\nстрока два', '[00:01.00]строка один\n[00:05.00]строка два') RETURNING id`, [tid, Number(author.user.id)]);
    const v2 = await pool.query(`INSERT INTO lyrics_versions (track_id, author_id, plain, synced) VALUES ($1, $2, 'строка 1\nстрока 2', '[00:01.00]строка 1\n[00:05.00]строка 2') RETURNING id`, [tid, Number(author.user.id)]);
    const queue = await call('GET', '/admin/lyrics/queue', { token: me.token });
    assert.equal(queue.json.items.length, 2);
    assert.equal(queue.json.items[0].kind, 'synced');
    assert.equal(queue.json.items[0].track.isrc, 'RUA1B2500001');
    const bulk = await call('POST', '/admin/lyrics/bulk', { token: me.token, body: { ids: [v1.rows[0].id, 999], action: 'accept' } });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.json.items[0].status, 'published');
    assert.equal(bulk.json.items[1].ok, false);
    const ret = await call('POST', `/admin/lyrics/versions/${v2.rows[0].id}/review`, { token: me.token, body: { action: 'return' } });
    assert.equal(ret.status, 400, 'возврат без комментария не проходит');
    assert.equal((await call('POST', `/admin/lyrics/versions/${v2.rows[0].id}/review`, { token: me.token, body: { action: 'return', note: 'опечатки' } })).json.status, 'returned');
    const found = await call('GET', '/admin/lyrics/tracks?q=RUA1B2500001', { token: me.token });
    assert.equal(found.json.items.length, 1);
    assert.equal(found.json.items[0].publishedVersion, String(v1.rows[0].id));
    const roll = await call('POST', `/admin/lyrics/tracks/${tid}/rollback`, { token: me.token, body: { versionId: v2.rows[0].id } });
    assert.equal(roll.status, 200);
    assert.equal((await call('GET', `/admin/lyrics/tracks/${tid}`, { token: me.token })).json.track.publishedVersion, String(v2.rows[0].id));
    const zip = await call('POST', '/admin/lyrics/export', { token: me.token, body: { trackIds: [tid, 12345] } });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    const files = unzip(zip.buf).map((f) => f.name);
    assert.ok(files.includes('RUA1B2500001.lrc') && files.includes('RUA1B2500001.ttml') && files.includes('README.txt'), files.join());
    // роли LyricLabs роль lyrics не меняет
    assert.equal((await call('POST', '/admin/lyrics/roles', { token: me.token, body: { user: '300', role: 'specialist' } })).status, 403);
  } finally {
    server.close();
  }
});

test('сервер: здоровье, логи, релизы и сборки через поддельный GitHub, рассылка не чаще раза в час', async () => {
  const calls = [];
  const ghFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/\/releases\?/.test(url)) return Response.json([{ id: 1, tag_name: 'v0.8.94', name: 'Nyao Music 0.8 (94)', published_at: '2026-10-01T00:00:00Z', html_url: 'u', assets: [{ id: 1, name: 'NyaoMusic-0.8.94-app-1.nui', size: 10 }, { id: 2, name: 'NyaoMusic-0.8.94-app-1.nui.sig', size: 89 }] }, { id: 2, tag_name: 'v0.8.95-nightly', prerelease: true, assets: [] }]);
    if (/\/dispatches$/.test(url)) return new Response(null, { status: 204 });
    if (/\/actions\/runs\?/.test(url) || /\/runs\?/.test(url)) return Response.json({ workflow_runs: [{ id: 5, name: 'Desktop', status: 'completed', conclusion: 'success', head_branch: 'main', run_started_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:10:00Z', html_url: 'r' }] });
    if (/\/contents\//.test(url) && (opts.method || 'GET') === 'GET') return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    if (/\/contents\//.test(url)) return Response.json({ commit: { sha: 'abc' } });
    if (/automator\/releases\/latest/.test(url)) return Response.json({ tag_name: 'v1.0.0', assets: [{ id: 9, name: 'NyaoAutomator-1.0.0-win-x64.exe', size: 5 }] });
    return new Response('{}', { status: 500 });
  };
  const sent = [];
  const push = { send: async (token, msg) => { if (token === 'dead') { const e = new Error('gone'); e.gone = true; throw e; } sent.push({ token, msg }); return true; } };
  const { server, call, login, logs, pool } = await setup({ github: new GitHub({ token: 't', fetch: ghFetch, log: () => {} }), push });
  try {
    const owner = await login(777);
    const h = await call('GET', '/admin/health', { token: owner.token });
    assert.equal(h.status, 200);
    assert.equal(h.json.db.ok, true);
    assert.equal(h.json.github, true);
    assert.equal(h.json.counts.users, 1);
    logs.push('warn', 'что-то пошло не так');
    const lg = await call('GET', '/admin/logs?level=warn&q=пошло', { token: owner.token });
    assert.equal(lg.json.items.length, 1);

    const rel = await call('GET', '/admin/releases', { token: owner.token });
    assert.equal(rel.status, 200);
    assert.equal(rel.json.items[0].channel, 'stable');
    assert.equal(rel.json.items[0].signed, true);
    assert.equal(rel.json.items[1].channel, 'nightly');
    assert.equal(rel.json.items[0].mirrored, true);
    const build = await call('POST', '/admin/builds', { token: owner.token, body: { workflow: 'android', ref: 'nightly' } });
    assert.equal(build.status, 200);
    assert.ok(calls.some((c) => c.url.endsWith('/actions/workflows/android.yml/dispatches') && c.body.ref === 'nightly'));
    assert.equal((await call('POST', '/admin/builds', { token: owner.token, body: { workflow: 'evil' } })).status, 400);
    assert.equal((await call('GET', '/admin/builds', { token: owner.token })).json.items[0].durationSec, 600);
    const notes = await call('PUT', '/admin/notes', { token: owner.token, body: { version: '0.8.95', channel: 'nightly', text: '- починили' } });
    assert.equal(notes.status, 200);
    assert.equal(notes.json.branch, 'nightly');
    assert.equal(notes.json.path, '.github/notes/v0.8.95-nightly.md');
    const ops = await call('POST', '/admin/ops', { token: owner.token, body: { action: 'restart' } });
    assert.equal(ops.status, 200);
    assert.ok(calls.some((c) => c.url.endsWith('/actions/workflows/ops.yml/dispatches') && c.body.inputs.action === 'restart'));
    const auto = await call('GET', '/admin/automator/latest', { token: owner.token });
    assert.equal(auto.json.tag, 'v1.0.0');
    assert.equal(auto.json.assets[0].url, '/admin/automator/dl/NyaoAutomator-1.0.0-win-x64.exe');

    // push: токены двух устройств, один мёртвый
    const bob = await login(200, { platform: 'android' });
    await call('PUT', '/push/token', { token: bob.token, body: { token: 'tok-bob', platform: 'android' } });
    const dead = await login(201, { platform: 'android' });
    await call('PUT', '/push/token', { token: dead.token, body: { token: 'dead', platform: 'android' } });
    const cnt = await call('POST', '/admin/push/count', { token: owner.token, body: { audience: { type: 'platform', platform: 'android' } } });
    assert.equal(cnt.json.devices, 2);
    const t1 = await call('POST', '/admin/push/test', { token: owner.token, body: { userId: bob.user.id, title: 'Привет' } });
    assert.equal(t1.json.delivered, 1);
    const bc = await call('POST', '/admin/push/broadcast', { token: owner.token, body: { audience: { type: 'all' }, title: 'Всем', body: 'Текст', link: 'nyao://updates' } });
    assert.equal(bc.status, 200);
    assert.equal(bc.json.delivered, 1);
    assert.equal(bc.json.failed, 1);
    assert.equal(bc.json.removed, 1);
    assert.equal((await call('POST', '/admin/push/broadcast', { token: owner.token, body: { audience: { type: 'all' }, title: 'Ещё' } })).status, 429);
    const hist = await call('GET', '/admin/push/history', { token: owner.token });
    assert.equal(hist.json.items.length, 1);
    assert.ok(hist.json.nextAllowedAt);
    // статистика
    const st = await call('GET', '/admin/stats/overview', { token: owner.token });
    assert.equal(st.status, 200);
    assert.equal(st.json.totals.users, 3);
    assert.ok(st.json.series.length >= 30);
    assert.equal((await call('GET', '/admin/stats/plays?groupBy=artist', { token: owner.token })).status, 200);
    // в журнале нет секретов
    const au = await pool.query(`SELECT params FROM admin_audit WHERE action = 'builds.run'`);
    assert.ok(!JSON.stringify(au.rows).includes('"token"'));
  } finally {
    server.close();
  }
});
