// Ретранслятор для входа через Telegram: сервер Nyao в РФ не видит oauth.telegram.org (ТСПУ),
// а Cloudflare видит. Пропускает только обмен кода (/token), публичные ключи (JWKS) и картинки
// с известных CDN (/img?u=…: аватарки Telegram, обложки YouTube, SoundCloud, VK, Spotify) — их сервер кэширует у себя.
// Cloudflare → Workers & Pages → Create → Worker → вставить этот файл → Deploy.
const UPSTREAM = 'https://oauth.telegram.org';
const IMG_HOSTS = /(^|\.)(t\.me|telegram\.org|telesco\.pe|cdn-telegram\.org|ytimg\.com|ggpht\.com|googleusercontent\.com|sndcdn\.com|userapi\.com|vk\.me|vkuser\.net|vk-cdn\.net|scdn\.co|spotifycdn\.com|mzstatic\.com)$/i;

async function image(raw) {
  let u;
  try { u = new URL(raw || ''); } catch { return new Response('bad url', { status: 400 }); }
  if (u.protocol !== 'https:' || !IMG_HOSTS.test(u.hostname)) return new Response('host not allowed', { status: 403 });
  const res = await fetch(u.toString(), { headers: { accept: 'image/*' }, cf: { cacheEverything: true, cacheTtl: 604800 } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.startsWith('image/')) return new Response('not an image', { status: 502 });
  return new Response(res.body, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=604800' } });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/img') return image(url.searchParams.get('u'));
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
