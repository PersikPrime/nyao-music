import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReleaseMirror } from '../src/mirror.js';

test('зеркало качает файлы релиза и подменяет ссылки', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
  fs.mkdirSync(path.join(dir, 'v0.3.1'));
  const rel = { tag_name: 'v0.4.1', html_url: 'https://github.com/x', assets: [{ name: 'NyaoMusic-0.4-1.apk', size: 5, browser_download_url: 'https://github.com/a.apk' }, { name: '../evil', size: 1, browser_download_url: 'x' }] };
  const fetch = async (url) => (url.includes('api.github.com') ? new Response(JSON.stringify(rel)) : new Response('12345'));
  const m = new ReleaseMirror({ repo: 'r', dir, publicUrl: 'https://api.test/', fetch, log: () => {} });
  await m.sync();
  const latest = m.latest();
  assert.equal(latest.assets.length, 1);
  assert.equal(latest.assets[0].browser_download_url, 'https://api.test/dl/v0.4.1/NyaoMusic-0.4-1.apk');
  assert.ok(latest.mirrored);
  assert.equal(fs.readFileSync(m.file('v0.4.1', 'NyaoMusic-0.4-1.apk'), 'utf8'), '12345');
  assert.ok(!fs.existsSync(path.join(dir, 'v0.3.1')), 'старый релиз удалён');
  assert.equal(m.file('..', 'x'), null);
});
