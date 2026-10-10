// Ретранслятор для входа через Telegram: сервер Nyao в РФ не видит oauth.telegram.org (ТСПУ),
// а Cloudflare видит. Пропускает только две вещи — обмен кода (/token) и публичные ключи (JWKS).
// Cloudflare → Workers & Pages → Create → Worker → вставить этот файл → Deploy.
const UPSTREAM = 'https://oauth.telegram.org';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const allowed =
      (request.method === 'POST' && url.pathname === '/token') ||
      (request.method === 'GET' && url.pathname === '/.well-known/jwks.json');
    if (!allowed) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    for (const h of ['authorization', 'content-type', 'accept']) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    const res = await fetch(UPSTREAM + url.pathname, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? await request.text() : undefined
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' }
    });
  }
};
