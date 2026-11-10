import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { validateManifest, describePermission, missingGrants, netAllowed, settingValues, rateLimiter } from '../src/main/addons/manifest.js';
import { AddonPages } from '../src/main/addons/pages.js';

const base = { id: 'takko.demo', name: 'Демо', version: '1.0.0', nyao: 1 };

test('манифест: минимальный проходит, main по умолчанию addon.js', () => {
  const r = validateManifest(base);
  assert.equal(r.ok, true);
  assert.equal(r.manifest.main, 'addon.js');
  assert.deepEqual(r.manifest.permissions, []);
});

test('манифест: плохой id, версия, слишком новый API', () => {
  assert.equal(validateManifest({ ...base, id: 'Demo' }).ok, false);
  assert.equal(validateManifest({ ...base, id: 'demo' }).ok, false);
  assert.equal(validateManifest({ ...base, version: 'v1' }).ok, false);
  assert.equal(validateManifest({ ...base, nyao: 99 }).ok, false);
  assert.equal(validateManifest(null).ok, false);
});

test('манифест: неизвестное право — ошибка, а не молчаливый пропуск', () => {
  const r = validateManifest({ ...base, permissions: ['track', 'tokens'] });
  assert.equal(r.ok, false);
  assert.match(r.error, /tokens/);
});

test('манифест: main не может выйти из папки дополнения', () => {
  for (const main of ['../x.js', '/etc/passwd', 'a/../../b.js', 'C:\\x.js', '.hidden.js']) assert.equal(validateManifest({ ...base, main }).ok, false, main);
  assert.equal(validateManifest({ ...base, main: 'src/main.js' }).ok, true);
});

test('манифест: page требует права page', () => {
  assert.equal(validateManifest({ ...base, page: 'page' }).ok, false);
  assert.equal(validateManifest({ ...base, page: 'page', permissions: ['page'] }).ok, true);
});

test('права: сеть описывается доменом, мусор отбрасывается', () => {
  assert.deepEqual(describePermission('net:API.Example.com').key, 'net:api.example.com');
  assert.equal(describePermission('net:api.example.com').net, true);
  for (const p of ['net:', 'net:*', 'net:*.example.com', 'net:localhost', 'net:127.0.0.1', 'net:example.com/path', 'net:a b.com']) assert.equal(describePermission(p), null, p);
});

test('сеть: только https и только перечисленные домены, без поддоменов и хитростей', () => {
  const p = ['net:api.example.com'];
  assert.equal(netAllowed(p, 'https://api.example.com/v1?x=1'), true);
  assert.equal(netAllowed(p, 'http://api.example.com/'), false);
  assert.equal(netAllowed(p, 'https://evil.api.example.com/'), false);
  assert.equal(netAllowed(p, 'https://example.com/'), false);
  assert.equal(netAllowed(p, 'https://api.example.com.evil.io/'), false);
  assert.equal(netAllowed(p, 'https://api.example.com@evil.io/'), false);
  assert.equal(netAllowed(p, 'https://user:pass@api.example.com/'), false);
  assert.equal(netAllowed(p, 'https://api.example.com:8443/'), false);
  assert.equal(netAllowed(p, 'file:///etc/passwd'), false);
  assert.equal(netAllowed(p, 'не адрес'), false);
  assert.equal(netAllowed([], 'https://api.example.com/'), false);
});

test('новая версия просит больше — видно, чего не хватает', () => {
  assert.deepEqual(missingGrants(['track', 'lyrics'], ['track']), ['lyrics']);
  assert.deepEqual(missingGrants(['track'], ['track', 'history']), []);
  assert.deepEqual(missingGrants(['track'], undefined), ['track']);
});

test('настройки дополнения: умолчания, чужие ключи и значения не из списка не проходят', () => {
  const { manifest } = validateManifest({ ...base, settings: [
    { key: 'style', type: 'select', label: 'Вид', default: 'b', options: [{ value: 'a', label: 'А' }, { value: 'b', label: 'Б' }] },
    { key: 'on', type: 'toggle', label: 'Вкл', default: true },
  ] });
  assert.deepEqual(settingValues(manifest, null), { style: 'b', on: true });
  assert.deepEqual(settingValues(manifest, { style: 'a', on: false, evil: 1 }), { style: 'a', on: false });
  assert.deepEqual(settingValues(manifest, { style: 'zzz', on: 'да' }), { style: 'b', on: true });
});

test('ограничитель: не чаще n раз за окно', () => {
  let now = 0;
  const ok = rateLimiter(2, 1000, () => now);
  assert.equal(ok(), true);
  assert.equal(ok(), true);
  assert.equal(ok(), false);
  now = 1500;
  assert.equal(ok(), true);
});

test('встроенные дополнения: манифесты проходят проверку', () => {
  const root = new URL('../src/addons/', import.meta.url);
  const dirs = fs.readdirSync(root);
  assert.ok(dirs.length >= 2);
  for (const d of dirs) {
    const r = validateManifest(JSON.parse(fs.readFileSync(new URL(`${d}/manifest.json`, root), 'utf8')));
    assert.equal(r.ok, true, `${d}: ${r.error}`);
    assert.equal(r.manifest.id, d);
    if (!r.manifest.native) assert.ok(fs.existsSync(new URL(`${d}/${r.manifest.main}`, root)));
  }
});

test('пример из docs/examples проходит проверку', () => {
  const r = validateManifest(JSON.parse(fs.readFileSync(new URL('../docs/examples/autoskip/manifest.json', import.meta.url), 'utf8')));
  assert.equal(r.ok, true, r.error);
});

test('страницы: отдают файлы и данные, не выпускают из папки, пускают только с этого компьютера', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyao-addon-'));
  fs.mkdirSync(path.join(dir, 'page'));
  fs.writeFileSync(path.join(dir, 'page', 'index.html'), '<b>привет</b>');
  fs.writeFileSync(path.join(dir, 'secret.json'), '{"x":1}');
  const pages = new AddonPages();
  const url = await pages.mount('takko.demo', path.join(dir, 'page'));
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/a\/takko\.demo\/$/);
    assert.equal(await (await fetch(url)).text(), '<b>привет</b>');
    assert.equal((await fetch(`${url}..%2Fsecret.json`)).status, 403);
    assert.equal((await fetch(`${url}%2e%2e/secret.json`)).status, 404); // нормализуется в /a/secret.json — такого дополнения нет
    assert.equal((await fetch(`${url}nope.html`)).status, 404);
    assert.equal((await fetch(url.replace('takko.demo', 'other.addon'))).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    // чужой Host (подмена DNS): fetch такой заголовок не даёт задать, поэтому запрос руками
    assert.equal(await new Promise((resolve, reject) => http.get(url, { headers: { host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject)), 403);
    assert.equal(await (await fetch(`${url}__data`)).text(), 'null');
    pages.publish('takko.demo', { title: 'Holocene' });
    assert.deepEqual(await (await fetch(`${url}__data`)).json(), { title: 'Holocene' });
    assert.throws(() => pages.publish('takko.demo', 'x'.repeat(70_000)));
    assert.equal(pages.publish('nobody', {}), false);
    // поток: первое сообщение — текущие данные
    const res = await fetch(`${url}__events`);
    const chunk = new TextDecoder().decode((await res.body.getReader().read()).value);
    assert.match(chunk, /^data: \{"title":"Holocene"\}/);
  } finally {
    pages.unmount('takko.demo');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(pages.running, false);
});
