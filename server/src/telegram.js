// Вход через Telegram по OAuth 2.0 / OpenID Connect (oauth.telegram.org).
// Поток: /auth/start → браузер на oauth.telegram.org/auth → /auth/telegram/callback?code → обмен кода
// на id_token (Basic client_id:client_secret + PKCE) → проверка подписи по JWKS.
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const ISSUER = 'https://oauth.telegram.org';
const AUTH_URL = `${ISSUER}/auth`;
const TOKEN_URL = `${ISSUER}/token`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;

export const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function pkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export class TelegramOIDC {
  constructor({ clientId, clientSecret, redirectUri, fetch = globalThis.fetch, keys = null }) {
    this.clientId = String(clientId || '');
    this.clientSecret = String(clientSecret || '');
    this.redirectUri = redirectUri;
    this.fetch = fetch;
    // keys можно подменить в тестах; по умолчанию — публичные ключи Telegram, кэшируются jose
    this.keys = keys || createRemoteJWKSet(new URL(JWKS_URL));
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
    const res = await this.fetch(TOKEN_URL, {
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
