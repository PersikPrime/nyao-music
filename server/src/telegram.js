// Вход через Telegram по OAuth 2.0 / OpenID Connect (oauth.telegram.org).
// Поток: /auth/start → браузер на oauth.telegram.org/auth → /auth/telegram/callback?code → обмен кода
// на id_token (Basic client_id:client_secret + PKCE) → проверка подписи по JWKS.
import crypto from 'node:crypto';
import https from 'node:https';
import { createLocalJWKSet, jwtVerify } from 'jose';

export const ISSUER = 'https://oauth.telegram.org';
const AUTH_URL = `${ISSUER}/auth`; // открывается в браузере пользователя — напрямую

/**
 * Запасные IP ретранслятора (TG_RELAY_IPS через запятую), если провайдер режет адреса из DNS.
 * Для Cloudflare не подходит: чужие IP Cloudflare отвечают ошибкой 1034, поэтому по умолчанию пусто.
 */
export const RELAY_IPS = [];

/** Запрос на конкретный IP с нужным именем хоста (SNI и проверка сертификата — по имени) → Response */
export function pinnedFetch(url, { method = 'GET', headers = {}, body, ip, timeout = 10000 } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname, servername: u.hostname, port: u.port || 443, path: u.pathname + u.search, method,
      headers: { ...headers, host: u.host, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      lookup: (_h, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: { 'content-type': res.headers['content-type'] || 'application/json' } })));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${ip}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export class TelegramOIDC {
  /**
   * relay — адрес ретранслятора (Cloudflare Worker), если серверу закрыт прямой доступ к oauth.telegram.org
   * (в РФ на части хостингов его режет ТСПУ). Запасной вариант — Vercel: server/tg-relay-vercel. Через него идут только /token и ключи JWKS.
   */
  constructor({ clientId, clientSecret, redirectUri, relay = '', relayIps = null, fetch = globalThis.fetch, pinned = pinnedFetch, keys = null }) {
    this.clientId = String(clientId || '');
    this.clientSecret = String(clientSecret || '');
    this.redirectUri = redirectUri;
    this.rawFetch = fetch;
    this.pinned = pinned;
    this.relay = String(relay || '').trim().replace(/\/$/, '');
    const base = this.relay || ISSUER;
    this.tokenUrl = `${base}/token`;
    this.jwksUrl = `${base}/.well-known/jwks.json`;
    this.relayIps = (relayIps && relayIps.length ? relayIps : RELAY_IPS).filter(Boolean);
    this.goodIp = null; // IP, который сработал в прошлый раз
    // keys можно подменить в тестах; по умолчанию — публичные ключи Telegram (через тот же путь, что и /token), кэш на час
    this.keys = keys || (async (header, token) => (await this.jwks())(header, token));
    this.jwksCache = null;
  }

  /**
   * Запрос к Telegram или ретранслятору. Если адрес ретранслятора не отвечает (его IP режет провайдер),
   * пробуем запасные IP Cloudflare — с тем же именем хоста.
   */
  async fetch(url, init = {}) {
    const viaRelay = this.relay && String(url).startsWith(this.relay);
    if (!viaRelay) return this.rawFetch(url, { ...init, signal: init.signal || AbortSignal.timeout(15000) });
    if (!this.goodIp) {
      try {
        return await this.rawFetch(url, { ...init, signal: AbortSignal.timeout(4000) });
      } catch (e) {
        if (!this.relayIps.length) throw e;
      }
    }
    const order = this.goodIp ? [this.goodIp, ...this.relayIps.filter((i) => i !== this.goodIp)] : this.relayIps;
    let last;
    for (const ip of order) {
      try {
        const res = await this.pinned(url, { method: init.method || 'GET', headers: init.headers || {}, body: init.body, ip, timeout: 5000 });
        if (res.status === 403 && /error code: 10\d\d/.test(await res.clone().text())) throw new Error(`${ip}: Cloudflare не отдаёт хост на этом IP`);
        this.goodIp = ip;
        return res;
      } catch (e) {
        last = e;
        if (this.goodIp === ip) this.goodIp = null;
      }
    }
    throw new Error(`fetch failed: ретранслятор не отвечает ни по одному адресу (${last && last.message})`);
  }

  async jwks() {
    if (this.jwksCache && Date.now() - this.jwksCache.at < 3600_000) return this.jwksCache.set;
    const res = await this.fetch(this.jwksUrl);
    if (!res.ok) throw new Error(`Telegram JWKS ответил ${res.status}`);
    const set = createLocalJWKSet(await res.json());
    this.jwksCache = { at: Date.now(), set };
    return set;
  }

  get configured() {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  authUrl({ state, challenge }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', this.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'openid profile');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  /** Код из callback → профиль пользователя Telegram */
  async exchange(code, verifier) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: verifier
    });
    const res = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
      },
      body: body.toString()
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Telegram /token ответил ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    if (!json.id_token) throw new Error('Telegram не вернул id_token');
    return this.verify(json.id_token);
  }

  async verify(idToken) {
    const { payload } = await jwtVerify(idToken, this.keys, { issuer: ISSUER });
    const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud)];
    if (!aud.includes(this.clientId)) throw new Error('id_token выписан для другого бота');
    const id = String(payload.id ?? payload.sub);
    if (!id || id === 'undefined') throw new Error('В id_token нет пользователя');
    const name = payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || payload.preferred_username || 'Telegram';
    return { tgId: id, name: String(name).slice(0, 128), username: payload.preferred_username || null, picture: payload.picture || null };
  }
}
