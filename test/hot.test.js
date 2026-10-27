import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { HotStore, makeBundle, signBundle, verifyBundle, readBundle, compatOf } from '../src/main/hot.js';
import { pickHotAsset, parseTag } from '../src/main/updates.js';

const keys = crypto.generateKeyPairSync('ed25519');
const PRIV = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB = keys.publicKey.export({ type: 'spki', format: 'pem' });
const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });

function fakeApp(build, main = 'export const ok = 1;\n') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-src-'));
  fs.mkdirSync(path.join(root, 'src', 'main'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { 'youtubei.js': '^18.1.0' }, devDependencies: { electron: '44' } }));
  fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ name: '0.8', build }));
  fs.writeFileSync(path.join(root, 'src', 'main', 'main.js'), main);
  fs.writeFileSync(path.join(root, 'src', 'main', 'compat.json'), '{}');
  return root;
}
const PKG = { dependencies: { 'youtubei.js': '^18.1.0' }, devDependencies: { electron: '44' } };

function store(build = 88) {
  return new HotStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'hot-')), publicPem: PUB, bundled: { build, compat: compatOf(PKG) } });
}

test('hot: пакет собирается, подписывается и ставится; при запуске выбирается и подтверждается', () => {
  const { buf, meta } = makeBundle(fakeApp(89));
  assert.equal(meta.build, 89);
  const data = readBundle(buf);
  assert.ok(!data.files['src/main/compat.json'], 'compat.json установки в пакет не попадает');
  const sig = signBundle(buf, PRIV);
  assert.ok(verifyBundle(buf, sig, PUB));
  assert.ok(!verifyBundle(buf, signBundle(buf, other), PUB), 'чужой ключ не проходит');
  const s = store();
  s.install(buf, sig);
  const pick = s.choose();
  assert.equal(pick.build, 89);
  assert.equal(fs.readFileSync(path.join(pick.dir, 'src', 'main', 'main.js'), 'utf8'), 'export const ok = 1;\n');
  assert.equal(s.state().pending, 89);
  s.confirm();
  assert.equal(s.state().pending, null);
  assert.equal(s.choose().build, 89, 'подтверждённая версия запускается и дальше');
});

test('hot: не подтвердил запуск — в следующий раз установленная версия, а эта помечена плохой', () => {
  const { buf } = makeBundle(fakeApp(89));
  const sig = signBundle(buf, PRIV);
  const s = store();
  s.install(buf, sig);
  assert.equal(s.choose().build, 89);
  // упало, confirm не случился
  assert.equal(s.choose(), null);
  assert.deepEqual(s.state().bad, [89]);
  assert.throws(() => s.install(buf, sig), /уже не запустилась/);
});

test('hot: подделка, старая версия, другой Electron и тронутые файлы не проходят', () => {
  const { buf } = makeBundle(fakeApp(89));
  const sig = signBundle(buf, PRIV);
  const s = store();
  // подменили байт
  const bad = Buffer.from(buf);
  bad[bad.length - 5] ^= 1;
  assert.throws(() => s.install(bad, sig), /подпись/);
  // не новее установки
  assert.throws(() => store(89).install(buf, sig), /не новее/);
  // другая совместимость
  const s2 = new HotStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'hot-')), publicPem: PUB, bundled: { build: 80, compat: 'zzz' } });
  assert.throws(() => s2.install(buf, sig), /полная установка/);
  // нет ключа — выключено
  const off = new HotStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'hot-')), publicPem: null, bundled: { build: 80, compat: compatOf(PKG) } });
  assert.equal(off.choose(), null);
  assert.throws(() => off.install(buf, sig), /выключены/);
  // файл на диске подправили после установки
  s.install(buf, sig);
  fs.appendFileSync(path.join(s.dir, '89', 'app', 'src', 'main', 'main.js'), '//x');
  assert.equal(s.choose(), null);
});

test('hot: пути вне приложения в пакете отклоняются', () => {
  const evil = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, build: 90, compat: compatOf(PKG), files: { 'src/../../evil.js': '' } })));
  assert.throws(() => readBundle(evil), /странный путь/);
  const evil2 = zlib.gzipSync(Buffer.from(JSON.stringify({ format: 1, build: 90, compat: compatOf(PKG), files: { 'node_modules/x.js': '' } })));
  assert.throws(() => readBundle(evil2), /странный путь/);
});

test('hot: новая версия поверх старой, старые папки чистятся', () => {
  const s = store();
  for (const b of [89, 90]) {
    const { buf } = makeBundle(fakeApp(b));
    s.install(buf, signBundle(buf, PRIV));
  }
  assert.equal(s.choose().build, 90);
  s.confirm();
  assert.deepEqual(fs.readdirSync(s.dir).sort(), ['90', 'state.json']);
});

test('updates: пакет и подпись в релизе, теги каналов', () => {
  const assets = [
    { name: 'NyaoMusic-0.8.89-win.exe', browser_download_url: 'e', size: 1 },
    { name: 'NyaoMusic-0.8.89-app-abc.nui', browser_download_url: 'n', size: 900 },
    { name: 'NyaoMusic-0.8.89-app-abc.nui.sig', browser_download_url: 's', size: 90 },
    { name: 'NyaoMusic-0.8.89-app-old.nui', browser_download_url: 'o', size: 900 }
  ];
  assert.deepEqual(pickHotAsset(assets, 'abc'), { name: 'NyaoMusic-0.8.89-app-abc.nui', url: 'n', size: 900, sigUrl: 's' });
  assert.equal(pickHotAsset(assets, 'old'), null, 'без подписи — нет');
  assert.equal(pickHotAsset(assets, 'zzz'), null);
  assert.deepEqual(parseTag('v0.8.89-dev'), { name: '0.8', build: 89, channel: 'dev' });
  assert.deepEqual(parseTag('v0.8.84'), { name: '0.8', build: 84 });
});
