// Only the API server has the registered application's secret.
export const scRedirect = 'nyao://soundcloud/callback';

export function soundcloudAuthRoutes({ readJson, HttpError, limit, env = process.env, fetchFn = fetch }) {
  return [
    ['GET', /^\/auth\/soundcloud\/config$/, async () => ({
      clientId: env.SC_CLIENT_SECRET && env.SC_CLIENT_ID || null,
      redirectUri: scRedirect
    })],
    ['POST', /^\/auth\/soundcloud\/token$/, async ({ req, ip }) => {
      limit(ip);
      if (!env.SC_CLIENT_ID || !env.SC_CLIENT_SECRET) throw new HttpError(503, 'SoundCloud пока не настроен');
      const input = await readJson(req);
      const body = new URLSearchParams({ client_id: env.SC_CLIENT_ID, client_secret: env.SC_CLIENT_SECRET });
      const valid = s => typeof s === 'string' && s.length > 0 && s.length <= 4096;
      if (input.grant_type === 'authorization_code' && valid(input.code) && /^[a-zA-Z0-9._~-]{43,128}$/.test(input.code_verifier || '')) {
        for (const key of ['grant_type', 'code', 'code_verifier']) body.set(key, input[key]);
        body.set('redirect_uri', scRedirect);
      } else if (input.grant_type === 'refresh_token' && valid(input.refresh_token)) {
        body.set('grant_type', 'refresh_token');
        body.set('refresh_token', input.refresh_token);
      } else throw new HttpError(400, 'Некорректный запрос SoundCloud');
      const response = await fetchFn('https://secure.soundcloud.com/oauth/token', {
        method: 'POST', body, signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new HttpError(response.status, 'SoundCloud отклонил обмен токена');
      const { access_token, refresh_token, expires_in } = await response.json();
      if (!access_token || !refresh_token || !(Number(expires_in) > 0)) throw new HttpError(502, 'Неполный ответ SoundCloud');
      return { access_token, refresh_token, expires_in };
    }]
  ];
}
