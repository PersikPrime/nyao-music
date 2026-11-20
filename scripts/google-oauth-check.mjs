// Desktop OAuth compatibility probe. Reads the test user's library; credentials live in memory.
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

const filename = process.argv[2];
if (!filename) throw new Error('Укажи путь к JSON OAuth-клиента Google типа Desktop app');
const { installed } = JSON.parse(await readFile(filename, 'utf8'));
if (!installed?.client_id) throw new Error('Нужны учётные данные типа Desktop app');
const verifier = randomBytes(48).toString('base64url');
const state = randomBytes(32).toString('base64url');
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
const server = http.createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const redirect = 'http://127.0.0.1:' + server.address().port + '/callback';
url.search = new URLSearchParams({ client_id: installed.client_id, redirect_uri: redirect,
  scope: 'https://www.googleapis.com/auth/youtube.readonly', response_type: 'code', state,
  code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') });
try {
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Истекло время ожидания входа')), 180000);
    server.on('request', (req, res) => {
      const callback = new URL(req.url, redirect);
      if (req.method !== 'GET' || callback.origin !== new URL(redirect).origin ||
          callback.pathname !== '/callback' || callback.searchParams.get('state') !== state) {
        res.writeHead(400).end(); return;
      }
      clearTimeout(timer);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Вернись в терминал Nyao.');
      const code = callback.searchParams.get('code');
      if (code) resolve(code); else reject(new Error('Пользователь отменил вход'));
    });
    console.log('Открой ссылку в системном браузере на этом компьютере:\n' + url.href);
  });
  const body = new URLSearchParams({ client_id: installed.client_id, grant_type: 'authorization_code', code,
    redirect_uri: redirect, code_verifier: verifier });
  if (installed.client_secret) body.set('client_secret', installed.client_secret);
  const token = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  if (!token.ok) throw new Error('Обмен кода Google: HTTP ' + token.status);
  const { access_token } = await token.json();
  for (const path of ['playlists?part=id&mine=true', 'videos?part=id&myRating=like']) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/' + path + '&maxResults=1', {
      headers: { Authorization: 'Bearer ' + access_token }, signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error(path.split('?')[0] + ': HTTP ' + r.status);
    const data = await r.json();
    console.log(path.split('?')[0] + ': OK, элементов на тестовой странице: ' + data.items.length);
  }
} finally { server.close(); }
