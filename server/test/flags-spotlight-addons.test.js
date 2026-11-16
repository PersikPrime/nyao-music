// Флаги функций, Spotlight и каталог дополнений: Автоматор меняет — приложение получает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucket, flagOn } from '../src/flags.js';
import { setupAdmin } from './helpers-admin.js';

const b64 = (s) => Buffer.from(s).toString('base64');

test('флаги: правило «кому»', () => {
  const row = { key: 'ui2', enabled: true, channels: 'nightly', platforms: 'desktop', audience: 'all', percent: 100, user_ids: '' };
  assert.equal(flagOn(row, { channel: 'nightly', platform: 'win32', user: null }), true);
  assert.equal(flagOn(row, { channel: 'stable', platform: 'win32', user: null }), false);
  assert.equal(flagOn(row, { channel: 'nightly', platform: 'android', user: null }), false);
  assert.equal(flagOn({ ...row, audience: 'devs' }, { channel: 'nightly', platform: 'darwin', user: { id: '1', dev: true } }), true);
  assert.equal(flagOn({ ...row, audience: 'devs' }, { channel: 'nightly', platform: 'darwin', user: { id: '1' } }), false);
  assert.equal(flagOn({ ...row, audience: 'list', user_ids: '111,222' }, { channel: 'nightly', platform: 'win32', user: { id: '9', tgId: '222' } }), true);
  assert.equal(flagOn({ ...row, percent: 50 }, { channel: 'nightly', platform: 'win32', user: null }), false, 'гость в процент не попадает');
  // процент стабилен и примерно честен
  let n = 0;
  for (let i = 0; i < 2000; i++) if (bucket('ui2', String(i)) < 30) n++;
  assert.ok(n > 480 && n < 720, `30% из 2000 → ${n}`);
  assert.equal(flagOn({ ...row, enabled: false }, { channel: 'nightly', platform: 'win32', user: null }), false);
});

test('флаги, Spotlight, дополнения: Автоматор → приложение', async () => {
  const { server, call, login } = await setupAdmin({ admins: '777:owner,555:viewer' });
  try {
  const owner = await login(777);
  const viewer = await login(555);
  const user = await login(888);

  // флаг: viewer не меняет, owner включает списку
  assert.equal((await call('PUT', '/admin/flags/ui2', { token: viewer.token, body: { enabled: true } })).status, 403);
  assert.equal((await call('PUT', '/admin/flags/Bad-Key', { token: owner.token, body: { enabled: true } })).status, 404);
  const f = await call('PUT', '/admin/flags/ui2', { token: owner.token, body: { enabled: true, audience: 'list', userIds: '888, 999', channels: ['nightly'], platforms: ['desktop'] } });
  assert.equal(f.status, 200, f.text);
  assert.deepEqual(f.json.userIds, ['888', '999']);
  const list = await call('GET', '/admin/flags', { token: viewer.token });
  assert.equal(list.json.items.length, 1);
  assert.ok(list.json.known.some((k) => k.key === 'ui2'));
  assert.deepEqual((await call('GET', '/flags?channel=nightly&platform=win32', { token: user.token })).json.flags, { ui2: true });
  assert.deepEqual((await call('GET', '/flags?channel=nightly&platform=win32', { token: owner.token })).json.flags, {});
  assert.deepEqual((await call('GET', '/flags?channel=nightly&platform=win32')).json.flags, {}, 'гость не в списке');
  assert.deepEqual((await call('GET', '/flags?channel=stable&platform=win32', { token: user.token })).json.flags, {});
  assert.equal((await call('DELETE', '/admin/flags/ui2', { token: owner.token })).status, 200);

  // Spotlight: модель канала, отчёты, сводка
  assert.equal((await call('GET', '/spotlight/model?channel=nightly')).json.version, null);
  assert.equal((await call('PUT', '/admin/spotlight/models/spotlight-v1', { token: owner.token, body: { notes: 'первая', hit10: 17.7, channels: ['nightly'] } })).status, 200);
  assert.equal((await call('PUT', '/admin/spotlight/models/spotlight-v2', { token: owner.token, body: { notes: 'вторая', channels: ['nightly'] } })).status, 200);
  assert.equal((await call('GET', '/spotlight/model?channel=nightly')).json.version, 'spotlight-v2', 'канал переехал на v2');
  assert.equal((await call('POST', '/spotlight/report', { body: { session: 'abcdefgh1', model: 'spotlight-v2' } })).status, 401, 'без входа нельзя');
  const rep = { session: 'abcdefgh1', model: 'spotlight-v2', build: 126, judged: 40, unknown: 10, inTop: { n: 12, skipped: 2 }, outTop: { n: 28, skipped: 14 }, medianRank: 61 };
  assert.equal((await call('POST', '/spotlight/report', { token: user.token, body: rep })).status, 200);
  assert.equal((await call('POST', '/spotlight/report', { token: user.token, body: { ...rep, judged: 50 } })).status, 200, 'та же сессия перезаписывается');
  const sp = await call('GET', '/admin/spotlight', { token: viewer.token });
  assert.equal(sp.status, 200, sp.text);
  assert.equal(sp.json.byModel.length, 1);
  assert.equal(sp.json.byModel[0].judged, 50);
  assert.equal(sp.json.byModel[0].sessions, 1);
  assert.deepEqual(sp.json.models.find((x) => x.version === 'spotlight-v1').channels, []);

  // дополнения: загрузка → на проверке (в каталоге нет) → опубликовано → пакет → отзыв
  const manifest = { id: 'takko.clock', name: 'Часы', version: '1.0.0', nyao: 1, permissions: ['track', 'net:example.com'], author: 'Takko' };
  const bundle = { files: { 'manifest.json': b64(JSON.stringify(manifest)), 'addon.js': b64('nyao.on("track", () => {})') } };
  assert.equal((await call('POST', '/admin/addons', { token: owner.token, body: { bundle: { files: { 'manifest.json': b64('{"id":"nyao.evil","name":"x","version":"1","nyao":1}'), 'addon.js': b64('') } } } })).status, 400);
  assert.equal((await call('POST', '/admin/addons', { token: owner.token, body: { bundle: { files: { ...bundle.files, '../x.js': b64('') } } } })).status, 400);
  const up = await call('POST', '/admin/addons', { token: owner.token, body: { bundle } });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.json.status, 'pending');
  assert.deepEqual(up.json.permissions, ['track', 'net:example.com']);
  assert.equal((await call('GET', '/addons/catalog?channel=nightly')).json.items.length, 0);
  assert.equal((await call('PUT', '/admin/addons/takko.clock', { token: owner.token, body: { status: 'published', verified: true, channels: ['nightly'] } })).status, 200);
  const cat = (await call('GET', '/addons/catalog?channel=nightly')).json;
  assert.equal(cat.items.length, 1);
  assert.equal(cat.items[0].verified, true);
  assert.equal((await call('GET', '/addons/catalog?channel=stable')).json.items.length, 0);
  const pkg = await call('GET', '/addons/bundle/takko.clock?channel=nightly');
  assert.equal(pkg.status, 200);
  const { createHash } = await import('node:crypto');
  assert.equal(createHash('sha256').update(pkg.text).digest('hex'), cat.items[0].sha256, 'приложение сверяет sha256 пакета');
  assert.equal((await call('PUT', '/admin/addons/takko.clock', { token: owner.token, body: { status: 'revoked' } })).status, 400, 'без причины не отзываем');
  assert.equal((await call('PUT', '/admin/addons/takko.clock', { token: owner.token, body: { status: 'revoked', note: 'отправлял лишнее' } })).status, 200);
  const after = (await call('GET', '/addons/catalog?channel=nightly')).json;
  assert.equal(after.items.length, 0);
  assert.deepEqual(after.revoked, [{ id: 'takko.clock', reason: 'отправлял лишнее' }]);
  assert.equal((await call('GET', '/addons/bundle/takko.clock?channel=nightly')).status, 404);
  } finally {
    server.close();
  }
});
