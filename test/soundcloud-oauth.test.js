import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SoundCloudOAuth } from '../src/main/soundcloud-oauth.js';
import { SoundCloudProvider } from '../src/main/providers/soundcloud.js';

test('browser login checks state and PKCE, rotates refresh once, and uses official library routes', async () => {
  let oauth, challenge, refreshes = 0;
  const calls = [];
  const store = new Map();
  oauth = new SoundCloudOAuth({ store, base: 'https://broker.test', open: async url => {
    const q = new URL(url).searchParams;
    challenge = q.get('code_challenge');
    oauth.callback('nyao://soundcloud/callback?code=wrong&state=wrong');
    oauth.callback('nyao://soundcloud/callback?code=ok&state=' + q.get('state'));
  }, fetchFn: async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/config')) return Response.json({ clientId: 'client' });
    if (url.pathname.endsWith('/token')) {
      const b = JSON.parse(init.body);
      if (b.grant_type === 'authorization_code') {
        assert.equal(b.code, 'ok');
        assert.equal(createHash('sha256').update(b.code_verifier).digest('base64url'), challenge);
      } else refreshes++;
      return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: refreshes ? 3600 : 1 });
    }
    assert.equal(url.origin, 'https://api.soundcloud.com');
    calls.push([url.pathname, init.method]);
    if (url.pathname === '/me') return Response.json({ id: 42, username: 'demo' });
    if (url.pathname === '/me/likes/tracks') return Response.json({ collection: [{ urn: 'soundcloud:tracks:123', title: 'Track' }] });
    return new Response(null, { status: 204 });
  } });
  await oauth.login();
  const provider = new SoundCloudProvider({ oauth });
  const [tracks] = await Promise.all([provider.likedTracks(), oauth.access()]);
  assert.equal(refreshes, 1);
  assert.equal(tracks[0].id, 'sc:123');
  await provider.like(tracks[0]);
  await provider.like(tracks[0], false);
  assert.deepEqual(calls.slice(-2).map(([p,m]) => [decodeURIComponent(p),m]), [
    ['/likes/tracks/soundcloud:tracks:123','POST'], ['/likes/tracks/soundcloud:tracks:123','DELETE']
  ]);
  await assert.rejects(oauth.api('https://example.org'), /адрес/);
  oauth.clear();
  assert.equal(provider.loggedIn, false);
});
