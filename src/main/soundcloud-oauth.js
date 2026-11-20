import { randomBytes, createHash } from 'node:crypto';

const redirect = 'nyao://soundcloud/callback';
export class SoundCloudOAuth {
  constructor({ store, base, open, fetchFn = fetch }) {
    Object.assign(this, { store, base, open, fetchFn });
    this.tokens = store.get('scOAuth') || null;
  }
  async broker(path, body) {
    const response = await this.fetchFn(this.base + '/auth/soundcloud/' + path, {
      method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body && JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Сервер авторизации SoundCloud: HTTP ' + response.status);
    return response.json();
  }
  async login() {
    this.cancel();
    const attempt = this.attempt;
    const ensureCurrent = () => {
      if (attempt !== this.attempt) throw new Error('Вход в SoundCloud отменён');
    };
    const { clientId } = await this.broker('config');
    if (!clientId) throw new Error('Владелец Nyao ещё не настроил приложение SoundCloud');
    ensureCurrent();
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code',
      code_challenge_method: 'S256', code_challenge: challenge, state });
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(), 180000);
      this.pending = { state, resolve, reject, timer };
      Promise.resolve(this.open('https://secure.soundcloud.com/authorize?' + query)).catch(e => {
        if (this.pending?.state === state) { clearTimeout(timer); this.pending = null; reject(e); }
      });
    });
    const data = await this.broker('token', { grant_type: 'authorization_code', code, code_verifier: verifier });
    const me = await this.api('/me', 'GET', data.access_token);
    if (!me.id && !me.urn) throw new Error('Не удалось определить аккаунт SoundCloud');
    ensureCurrent();
    this.save(data, { uid: String(me.id || me.urn.split(':').pop()), name: me.username || 'SoundCloud' });
    return this.tokens.account;
  }
  callback(raw) {
    let url;
    try { url = new URL(raw); } catch { return false; }
    if (url.protocol !== 'nyao:' || url.host !== 'soundcloud' || url.username || url.password || url.pathname !== '/callback') return false;
    const p = this.pending;
    if (p && p.state === url.searchParams.get('state')) {
      this.pending = null;
      clearTimeout(p.timer);
      const code = url.searchParams.get('code');
      if (code && !url.searchParams.has('error')) p.resolve(code);
      else p.reject(new Error('Вход в SoundCloud отменён'));
    }
    return true;
  }
  cancel() {
    this.attempt = Symbol();
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new Error('Вход в SoundCloud отменён'));
    this.pending = null;
  }
  save(data, account) {
    const next = { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + 1000 * Number(data.expires_in), account };
    this.store.set('scOAuth', next);
    this.tokens = next;
  }
  clear() { this.cancel(); this.store.set('scOAuth', null); this.tokens = null; }
  async access() {
    const current = this.tokens;
    if (!current) throw new Error('Войди в SoundCloud');
    if (current.expires > Date.now() + 60000) return current.access;
    if (!this.refreshing) this.refreshing = this.broker('token', { grant_type: 'refresh_token', refresh_token: current.refresh })
      .then(data => {
        if (this.tokens !== current) throw new Error('Сменился аккаунт SoundCloud');
        this.save(data, current.account);
        return this.tokens.access;
      }).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async api(path, method = 'GET', token) {
    const url = new URL(path, 'https://api.soundcloud.com');
    if (url.origin !== 'https://api.soundcloud.com') throw new Error('Некорректный адрес API SoundCloud');
    const response = await this.fetchFn(url, { method, redirect: 'error', headers: { Authorization: 'OAuth ' + (token || await this.access()) }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error('SoundCloud: HTTP ' + response.status), { status: response.status });
    return method === 'GET' ? response.json() : null;
  }
}
