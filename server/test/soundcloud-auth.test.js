import test from 'node:test';
import assert from 'node:assert/strict';
import { soundcloudAuthRoutes } from '../src/soundcloud-auth.js';
import { HttpError } from '../src/app.js';

test('SoundCloud broker fixes redirect and destination and exposes only public configuration', async () => {
  const requests = [];
  const routes = soundcloudAuthRoutes({ env: { SC_CLIENT_ID: 'id', SC_CLIENT_SECRET: 'secret' },
    HttpError, limit() {}, readJson: async input => input, fetchFn: async (url, { body }) => {
      requests.push({ url, body });
      return Response.json({ access_token: 'one', refresh_token: 'two', expires_in: 3600 });
    } });
  const config = await routes[0][2]();
  assert.deepEqual(config, { clientId: 'id', redirectUri: 'nyao://soundcloud/callback' });
  const exchange = req => routes[1][2]({ req, ip: 'local' });
  await assert.rejects(exchange({ grant_type: 'client_credentials' }), { status: 400 });
  await exchange({ grant_type: 'authorization_code', code: 'abc', code_verifier: 'x'.repeat(43), redirect_uri: 'https://example.org' });
  await exchange({ grant_type: 'refresh_token', refresh_token: 'two' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://secure.soundcloud.com/oauth/token');
  assert.equal(requests[0].body.get('redirect_uri'), config.redirectUri);
  assert.equal(requests[1].body.get('client_secret'), 'secret');
});
