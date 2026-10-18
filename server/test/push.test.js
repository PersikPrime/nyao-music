import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { FcmPush, parseServiceAccount } from '../src/push.js';

test('FCM: ключ из base64, токен доступа кэшируется, мёртвый токен устройства помечается', async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const acc = { project_id: 'nyao-test', client_email: 'push@nyao-test.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) };
  assert.deepEqual(parseServiceAccount(Buffer.from(JSON.stringify(acc)).toString('base64')).project_id, 'nyao-test');
  assert.equal(parseServiceAccount('мусор'), null);
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
    if (JSON.parse(opts.body).message.token === 'dead') return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
    return new Response('{}', { status: 200 });
  };
  const p = new FcmPush(acc, { fetch, log: () => {} });
  assert.equal(await p.send('dev1', { title: 'Привет', body: 'b', data: { kind: 'track', n: 5 } }), true);
  await p.send('dev2', { title: 'x' });
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1, 'токен доступа один на час');
  const msg = JSON.parse(calls[1].opts.body).message;
  assert.equal(msg.data.kind, 'track');
  assert.equal(msg.data.n, '5');
  assert.equal(msg.data.title, 'Привет');
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer at');
  await assert.rejects(p.send('dead', { title: 'x' }), (e) => e.gone === true);
});
