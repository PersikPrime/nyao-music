import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup, login } from './helpers.js';
import { normCode, newCode } from '../src/legacy.js';

const spki = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

test('код: формат и нормализация', () => {
  assert.match(newCode(), /^[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(normCode('k7q 4md'), 'K7Q4MD');
  assert.equal(normCode('K7Q-4MD'), 'K7Q4MD');
});

test('вход Legacy по коду: от ключа устройства до сессии', async () => {
  const { server, call } = await setup();
  try {
    const { token } = await login(call, 'Телефон');
    assert.equal((await call('POST', '/legacy/pair', { body: { publicKey: 'abc' } })).status, 400);
    const key = spki();
    const start = await call('POST', '/legacy/pair', { body: { publicKey: key, device: 'Планшет 2014' } });
    assert.equal(start.status, 200);
    const { id, secret, code } = start.json;
    assert.match(code, /^[A-Z0-9]{6}$/);

    // опрос: без секрета нельзя, с секретом — ждём
    assert.equal((await call('GET', `/legacy/pair/${id}?secret=wrong`)).status, 403);
    assert.equal((await call('GET', `/legacy/pair/${id}?secret=${secret}`)).json.status, 'pending');

    // основное приложение: без входа — нельзя; с входом — получает открытый ключ
    assert.equal((await call('GET', `/legacy/pair/code/${code}`)).status, 401);
    const info = await call('GET', `/legacy/pair/code/${code.slice(0, 3)}-${code.slice(3).toLowerCase()}`, { token });
    assert.equal(info.status, 200);
    assert.equal(info.json.publicKey, key);
    assert.equal(info.json.device, 'Планшет 2014');
    assert.equal((await call('GET', '/legacy/pair/code/ZZZZZZ', { token })).status, 404);

    assert.equal((await call('POST', `/legacy/pair/code/${code}`, { token, body: {} })).status, 400);
    const ok = await call('POST', `/legacy/pair/code/${code}`, { token, body: { payload: 'ZW5jcnlwdGVk.cGF5bG9hZA' } });
    assert.equal(ok.status, 200);
    assert.equal((await call('POST', `/legacy/pair/code/${code}`, { token, body: { payload: 'eA' } })).status, 409, 'второй раз нельзя');

    // устройство забирает сессию и пакет — один раз
    const done = await call('GET', `/legacy/pair/${id}?secret=${secret}`);
    assert.equal(done.json.status, 'done');
    assert.equal(done.json.payload, 'ZW5jcnlwdGVk.cGF5bG9hZA');
    assert.equal(done.json.user.name, 'Takko');
    assert.equal((await call('GET', `/legacy/pair/${id}?secret=${secret}`)).status, 410);

    // выданная сессия рабочая
    assert.equal((await call('GET', '/me', { token: done.json.token })).status, 200);
  } finally {
    server.close();
  }
});
