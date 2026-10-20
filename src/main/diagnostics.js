// Never retain query strings, cookies, bearer credentials or raw provider replies.
export function safeDiagnostic(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, raw => { try { const u = new URL(raw); return u.origin + '/[адрес скрыт]'; } catch { return '[адрес скрыт]'; } })
    .replace(/\b(Bearer|OAuth)\s+[^\s"',;]+/gi, '$1 [скрыто]')
    .replace(/((?:cookie|authorization|access_token|refresh_token|oauth_token|web_token|client_secret|datadome)\s*["']?\s*[:=]\s*)[^\r\n]+/gi, '$1[скрыто]')
    .slice(0, 4000);
}
