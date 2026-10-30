import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { publicVersion, versionLabel } from '../src/main/version.js';
import { HotStore, makeBundle, signBundle, hotAssetName, compatOf } from '../src/main/hot.js';
import { checkUpdate } from '../src/main/updates.js';
import { ReleaseMirror } from '../server/src/mirror.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nyao-patch-'));
test('patch naming preserves monotonic builds, sync and the next regular release', () => {
  const d = dir();
  try {
    fs.mkdirSync(path.join(d, 'scripts'));
    fs.mkdirSync(path.join(d, 'src', 'main'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts/bump.mjs'), path.join(d, 'scripts/bump.mjs'));
    fs.copyFileSync(path.join(root, 'src/main/version.js'), path.join(d, 'src/main/version.js'));
    fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ name: '0.8', build: 97, channel: 'nightly' }));
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ type: 'module', build: {} }));
    const bump = arg => execFileSync('node', ['scripts/bump.mjs', ...(arg ? [arg] : [])], { cwd: d, stdio: 'pipe' });
    const read = f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    bump('--patch');
    assert.equal(read('version.json').build, 98);
    assert.equal(publicVersion(read('version.json')), '0.8.97.1');
    assert.equal(versionLabel(read('version.json')), '0.8.97.1 nightly');
    assert.equal(read('package.json').version, '0.8.98', 'Electron receives valid semver');
    assert.ok(read('package.json').build.artifactName.includes('0.8.97.1-build-0.8.98-'));
    bump('--sync'); assert.equal(read('version.json').build, 98);
    bump('--patch'); assert.equal(publicVersion(read('version.json')), '0.8.97.2');
    const mainRelease = read('version.json'); delete mainRelease.channel;
    fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify(mainRelease));
    bump();
    assert.equal(publicVersion(read('version.json')), '0.8.100');
    assert.equal(versionLabel(read('version.json')), '0.8 (100)');
    assert.equal(read('version.json').displayVersion, undefined);
    assert.equal(publicVersion({ name: '0.8', build: 98, displayVersion: '<invalid>' }), '0.8.98');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('97 accepts signed 97.1 NUI without a new native component or loader migration', () => {
  const d = dir(), install = dir();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.nyaoNativeAbi, 2, '97 helper ABI is preserved');
    const oldPkg = { ...pkg, version: '0.8.97' };
    assert.equal(compatOf(oldPkg), compatOf(pkg));
    fs.mkdirSync(path.join(d, 'src', 'main'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src/main/main.js'), 'export const ok = true;\n');
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(d, 'version.json'), JSON.stringify({ name: '0.8', build: 98, displayVersion: '0.8.97.1', channel: 'nightly' }));
    const { buf, meta } = makeBundle(d);
    assert.equal(meta.build, 98);
    assert.equal(meta.displayVersion, '0.8.97.1');
    assert.equal(hotAssetName(meta), 'NyaoMusic-0.8.97.1-build-0.8.98-app-' + meta.compat + '.nui');
    const keys = crypto.generateKeyPairSync('ed25519');
    const store = new HotStore({ dir: install, publicPem: keys.publicKey.export({ type: 'spki', format: 'pem' }),
      bundled: { build: 97, compat: compatOf(oldPkg) } });
    store.install(buf, signBundle(buf, keys.privateKey.export({ type: 'pkcs8', format: 'pem' })));
    const selected = store.choose();
    assert.equal(selected.build, 98);
    assert.equal(publicVersion(JSON.parse(fs.readFileSync(path.join(selected.dir, 'version.json'), 'utf8'))), '0.8.97.1');
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(install, { recursive: true, force: true }); }
});

test('legacy mirror keeps the patch NUI alongside an APK and 97 discovers it', async () => {
  const d = dir();
  try {
    const nui = 'NyaoMusic-0.8.97.1-build-0.8.98-app-abc.nui';
    const assets = [nui, nui + '.sig', 'NyaoMusic-0.8-98.apk'].map(name => ({ name, size: 123,
      browser_download_url: 'https://github.com/PersikPrime/nyao-music/releases/download/v0.8.98-nightly/' + name }));
    const patch = { tag_name: 'v0.8.98-nightly', name: 'Nyao Music 0.8.97.1 nightly', prerelease: true, assets };
    const mirror = new ReleaseMirror({ repo: 'PersikPrime/nyao-music', dir: d, publicUrl: 'https://example.test',
      fetch: async () => Response.json([patch]), log: () => {} });
    await mirror.refreshChannels();
    const release = mirror.latest('nightly');
    assert.equal(release.assets.length, 3, 'APK cannot hide the patch package in the old mirror');
    const result = await checkUpdate({ name: '0.8', build: 97, channel: 'nightly' },
      async () => Response.json(release), { compat: 'abc' });
    assert.equal(result.available, true);
    assert.equal(result.latest.build, 98);
    assert.equal(result.latest.label, '0.8.97.1');
    assert.equal(result.hot.name, nui);
    assert.ok(result.hot.sigUrl.endsWith(nui + '.sig'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
