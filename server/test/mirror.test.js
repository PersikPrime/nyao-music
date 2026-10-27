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

test('зеркало: каналы dev/nightly — маленькие файлы к себе, установщики со ссылкой на GitHub', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
  const stable = { tag_name: 'v0.8.84', assets: [{ name: 'NyaoMusic-0.8.84-win.exe', size: 3, browser_download_url: 'https://gh/s.exe' }] };
  const list = [
    { tag_name: 'v0.8.88-dev', prerelease: true, assets: [{ name: 'NyaoMusic-0.8.88-win.exe', size: 20e6, browser_download_url: 'https://gh/old.exe' }] },
    { tag_name: 'v0.8.89-dev', prerelease: true, assets: [
      { name: 'NyaoMusic-0.8.89-win.exe', size: 20e6, browser_download_url: 'https://gh/d.exe' },
      { name: 'NyaoMusic-0.8.89-app-abc.nui', size: 4, browser_download_url: 'https://gh/d.nui' }
    ] },
    stable
  ];
  const got = [];
  const fetch = async (url) => {
    got.push(url);
    if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(stable));
    if (url.includes('/releases?')) return new Response(JSON.stringify(list));
    return new Response(url.endsWith('.nui') ? 'nnnn' : 'abc');
  };
  const m = new ReleaseMirror({ repo: 'r', dir, publicUrl: 'https://api.test', fetch, log: () => {} });
  await m.sync();
  assert.equal(m.latest().tag_name, 'v0.8.84');
  const dev = m.latest('dev');
  assert.equal(dev.tag_name, 'v0.8.89-dev');
  assert.equal(dev.assets.find((a) => a.name.endsWith('.nui')).browser_download_url, 'https://api.test/dl/v0.8.89-dev/NyaoMusic-0.8.89-app-abc.nui');
  assert.equal(dev.assets.find((a) => a.name.endsWith('.exe')).browser_download_url, 'https://gh/d.exe');
  assert.ok(!got.includes('https://gh/d.exe'), 'большой установщик канала не качается');
  assert.equal(m.latest('nightly').tag_name, 'v0.8.84', 'нет канала — обычный релиз');
  // обычный релиз догнал канал — каналу отдаётся он
  m.release = { ...m.release, tag_name: 'v0.8.90', assets: [] };
  assert.equal(m.latest('dev').tag_name, 'v0.8.90');
});

test('зеркало: файл перезалили с тем же размером — качается заново', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-'));
  let body = 'AAAA';
  let id = 1;
  const rel = () => ({ tag_name: 'v0.8.90', assets: [{ id, name: 'NyaoMusic-0.8.90-app-x.nui.sig', size: 4, browser_download_url: 'https://gh/s' }] });
  const fetch = async (url) => (url.includes('api.github.com') ? new Response(JSON.stringify(url.includes('releases?') ? [] : rel())) : new Response(body));
  const m = new ReleaseMirror({ repo: 'r', dir, publicUrl: 'https://api.test', fetch, log: () => {} });
  await m.sync();
  assert.equal(fs.readFileSync(m.file('v0.8.90', 'NyaoMusic-0.8.90-app-x.nui.sig'), 'utf8'), 'AAAA');
  body = 'BBBB';
  id = 2;
  await m.sync();
  assert.equal(fs.readFileSync(m.file('v0.8.90', 'NyaoMusic-0.8.90-app-x.nui.sig'), 'utf8'), 'BBBB');
});
