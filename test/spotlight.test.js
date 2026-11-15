import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, trackKey, looseKey, Spotlight } from '../src/main/spotlight.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spotlight');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));

test('spotlight: ключи треков совпадают с Python (spotlight/keys.py)', () => {
  for (const k of expected.keys) {
    assert.equal(trackKey(k.artist, k.title), k.key, `${k.artist} — ${k.title}`);
    assert.equal(looseKey(k.artist, k.title), k.loose, `${k.artist} — ${k.title} (мягкий)`);
  }
});

test('spotlight: вектор вкуса и топ совпадают с PyTorch', () => {
  const m = loadModel(dir);
  for (const c of expected.cases) {
    const t = m.taste(c.history);
    let dot = 0, a = 0, b = 0;
    for (let i = 0; i < t.length; i++) { dot += t[i] * c.taste[i]; a += t[i] * t[i]; b += c.taste[i] ** 2; }
    assert.ok(dot / Math.sqrt(a * b) > 0.999, `история ${c.history}: косинус ${dot / Math.sqrt(a * b)}`);
    const top = m.top(t, 10).map(x => x.id);
    const same = top.filter(id => c.top.includes(id)).length;
    assert.ok(same >= 9, `история ${c.history}: в топе совпало ${same} из 10`);
  }
});

test('spotlight: тень считает скипы в топе модели и вне его', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spot-'));
  const s = new Spotlight({ dir: tmp });
  s.model = loadModel(dir);
  s.state = 'ready';
  const tr = (i) => ({ artist: `Artist ${i % 7}`, title: `Song ${i}`, source: 'ya' });
  const played = [1, 2, 3, 4, 5, 6].map(i => ({ track: tr(i) }));
  const top = s.suggest(played);
  assert.ok(top.length > 0 && !top.some(x => x.id <= 6), 'недавние не предлагаются');
  s.observe('trackStarted', tr(top[0].id), played);
  s.observe('trackFinished', tr(top[0].id), played, 200);
  s.observe('trackStarted', { artist: 'Неизвестный', title: 'трек' }, played);
  s.observe('skip', { artist: 'Неизвестный', title: 'трек' }, played, 5);
  const st = s.status();
  assert.equal(st.judged, 1);
  assert.equal(st.inTop.n, 1);
  assert.equal(st.inTop.skipped, 0);
  assert.equal(st.unknown, 1);
  assert.equal(st.medianRank, 1);
  await new Promise(r => setTimeout(r, 50));
  assert.equal(fs.readFileSync(path.join(tmp, 'spotlight-shadow.jsonl'), 'utf8').trim().split('\n').length, 2);
});
