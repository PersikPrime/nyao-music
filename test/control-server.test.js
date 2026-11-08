import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControlServer } from '../src/main/control-server.js';

test('пульт: токен, защита от браузера, состояние, длинный опрос, команды', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyao-ctl-'));
  const got = [];
  const s = new ControlServer({ dir, onCommand: (c, v) => got.push([c, v]), cover: async () => Buffer.from('png') });
  const port = await s.start();
  try {
    const { token } = JSON.parse(fs.readFileSync(path.join(dir, 'control.json'), 'utf8'));
    const H = { authorization: `Bearer ${token}` };
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/v1/ping`)).status, 200);
    assert.equal((await fetch(`${base}/v1/state`)).status, 401);
    assert.equal((await fetch(`${base}/v1/state`, { headers: { ...H, origin: 'https://example.com' } })).status, 401);

    s.setState({ playing: true, position: 10, duration: 200, track: { id: 'ya:1', title: 'T', artist: 'A', cover: 'https://x/c.jpg' } });
    const st = await (await fetch(`${base}/v1/state`, { headers: H })).json();
    assert.deepEqual([st.track.title, st.playing, st.duration], ['T', true, 200]);

    const wait = fetch(`${base}/v1/state?since=${st.rev}`, { headers: H }).then((r) => r.json());
    setTimeout(() => s.setState({ playing: false, position: 11, duration: 200, track: st.track }), 100);
    assert.equal((await wait).playing, false);

    const cmd = (body) => fetch(`${base}/v1/cmd`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    assert.equal((await cmd({ cmd: 'volume', value: 0.5 })).status, 200);
    assert.equal((await cmd({ cmd: 'volume', value: 5 })).status, 400);
    assert.equal((await cmd({ cmd: 'rm' })).status, 400);
    assert.deepEqual(got, [['volume', 0.5]]);
    assert.equal((await fetch(`${base}/v1/cover?size=64`, { headers: H })).headers.get('content-type'), 'image/png');
  } finally {
    s.stop();
  }
  assert.equal(fs.existsSync(path.join(dir, 'control.json')), false);
});
