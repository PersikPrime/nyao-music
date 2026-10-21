// Разбор ссылок nyao:// — приглашение, комната, профиль, трек.
/** nyao://add/КОД, nyao://join/КОД, nyao://u/ник, nyao://track/ya:123?t=…&a=…&d=… → что открыть */
export function parseDeepLink(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'nyao:') return null;
  const seg = decodeURIComponent(u.pathname.replace(/^\/+/, '')).split('/')[0] || '';
  if (u.host === 'add' && /^[a-z0-9]{6,16}$/.test(seg)) return { kind: 'add', value: seg };
  if (u.host === 'join' && /^[A-Za-z0-9]{6}$/.test(seg)) return { kind: 'join', value: seg.toUpperCase() };
  if (u.host === 'u' && /^[A-Za-z0-9_.]{3,24}$/.test(seg)) return { kind: 'user', value: seg };
  if (u.host === 'track' && /^(ya|yt|sc|vk|sp):[A-Za-z0-9_.:-]{1,80}$/.test(seg)) {
    const i = seg.indexOf(':');
    return {
      kind: 'track',
      track: {
        id: seg, source: seg.slice(0, i), srcId: seg.slice(i + 1),
        title: String(u.searchParams.get('t') || '').slice(0, 200) || 'Трек',
        artist: String(u.searchParams.get('a') || '').slice(0, 200),
        album: '', cover: null, duration: Math.max(0, Math.min(36000, Number(u.searchParams.get('d')) || 0))
      }
    };
  }
  return null;
}
