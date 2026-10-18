// Push-уведомления через Firebase Cloud Messaging (HTTP v1). Ключ сервисного аккаунта — в переменной
// FCM_SERVICE_ACCOUNT (JSON или base64 от JSON), её кладёт деплой из секретов GitHub. Без ключа push выключен.
import { SignJWT, importPKCS8 } from 'jose';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export function parseServiceAccount(raw) {
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const j = JSON.parse(text);
    return j.project_id && j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}

export class FcmPush {
  constructor(account, { fetch = globalThis.fetch, log = console.log } = {}) {
    this.acc = account;
    this.fetch = fetch;
    this.log = log;
    this.token = null;
    this.tokenExp = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const key = await importPKCS8(this.acc.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.acc.client_email)
      .setAudience(this.acc.token_uri || 'https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const res = await this.fetch(this.acc.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    });
    const j = await res.json();
    if (!res.ok || !j.access_token) throw new Error(`FCM: нет токена доступа (${res.status})`);
    this.token = j.access_token;
    this.tokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
    return this.token;
  }

  /** msg: { title, body, data } — data уходит строками, приложение по ней открывает нужный экран */
  async send(deviceToken, msg) {
    const data = Object.fromEntries(Object.entries({ ...(msg.data || {}), title: msg.title, body: msg.body }).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    const res = await this.fetch(`https://fcm.googleapis.com/v1/projects/${this.acc.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      // только data: уведомление рисует само приложение — в стиле Nyao и с кнопками
      body: JSON.stringify({ message: { token: deviceToken, data, android: { priority: 'HIGH', ttl: '86400s' } } })
    });
    if (res.ok) return true;
    const text = await res.text().catch(() => '');
    const gone = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(text);
    const e = new Error(`FCM ${res.status}`);
    e.gone = gone;
    if (!gone) this.log(`[push] ${res.status} ${text.slice(0, 200)}`);
    throw e;
  }
}
