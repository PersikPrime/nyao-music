// Ссылки «Поделиться» (music.withnyao.app/share/…), заглушка сайта и файл для Android App Links.
// Страница пытается открыть Nyao Music (nyao://…), а если его нет — показывает, где скачать.
// На Android с подтверждённым App Link ссылка открывает приложение сразу, минуя страницу.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const NICK = '[A-Za-z0-9_.]{3,24}';
const TRACK_ID = '(?:ya|yt|sc|vk|sp):[A-Za-z0-9_.:-]{1,80}';

/** Платформа скачивания по имени файла релиза */
function downloads(mirror) {
  const rel = mirror && mirror.latest && mirror.latest();
  if (!rel || !Array.isArray(rel.assets)) return [];
  const pick = (re) => rel.assets.find((a) => re.test(a.name));
  return [
    ['Android', pick(/\.apk$/i)],
    ['Windows', pick(/win-x64\.exe$/i)],
    ['macOS (Apple Silicon)', pick(/mac-arm64\.dmg$/i)],
    ['macOS (Intel)', pick(/mac-x64\.dmg$/i)]
  ].filter(([, a]) => a).map(([label, a]) => ({ label, url: a.browser_download_url }));
}

/**
 * Страница ссылки: заголовок, текст, кнопка «Открыть в Nyao Music» (nyao://…) и скачивание.
 * open — адрес nyao://…; auto — пробовать открыть приложение сразу при заходе
 */
export function sharePage({ title, text, open = null, mirror = null, ok = true, auto = true, badge = '♪' }) {
  const dl = downloads(mirror);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Nyao Music</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(text)}"><meta property="og:site_name" content="Nyao Music">
<style>
:root{color-scheme:dark;--bg:#0b0b0f;--card:#16161d;--fg:#f3f1f7;--muted:#9a97a6;--acc:${ok ? '#b69cff' : '#ff7a8a'}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#2a1f4d 0,var(--bg) 60%);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
.card{max-width:440px;width:100%;background:var(--card);border:1px solid #ffffff12;border-radius:28px;padding:36px 28px;text-align:center}
.dot{width:72px;height:72px;margin:0 auto 20px;border-radius:24px;background:var(--acc);display:grid;place-items:center;font-size:34px;color:#0b0b0f}
h1{margin:0 0 8px;font-size:24px;overflow-wrap:anywhere}p{margin:0;color:var(--muted);overflow-wrap:anywhere}
.btn{display:inline-block;margin-top:22px;padding:14px 26px;border-radius:999px;background:var(--acc);color:#0b0b0f;font-weight:700;text-decoration:none}
.dl{margin-top:26px;padding-top:18px;border-top:1px solid #ffffff12}.dl p{font-size:13px;margin-bottom:10px}
.dl a{display:inline-block;margin:4px;padding:8px 14px;border-radius:999px;border:1px solid #ffffff22;color:var(--fg);text-decoration:none;font-size:14px}
</style></head><body><div class="card"><div class="dot">${esc(badge)}</div><h1>${esc(title)}</h1><p>${esc(text)}</p>
${open ? `<a class="btn" id="open" href="${esc(open)}">Открыть в Nyao Music</a>` : ''}
${dl.length ? `<div class="dl"><p>Ещё нет Nyao Music? Скачай:</p>${dl.map((d) => `<a href="${esc(d.url)}">${esc(d.label)}</a>`).join('')}</div>` : ''}
</div>${open && auto ? `<script>setTimeout(function(){try{location.href=${JSON.stringify(open)}}catch(e){}},350)</script>` : ''}</body></html>`;
}

/** Заглушка сайта music.withnyao.app (будущий веб) */
function landing(mirror) {
  return sharePage({ title: 'Nyao Music', text: 'Один плеер для Яндекс Музыки, YouTube Music, SoundCloud, VK и Spotify. Сайт скоро будет здесь.', mirror, auto: false });
}

/**
 * Маршруты для сайта и ссылок. androidCerts — отпечатки SHA-256 ключа подписи APK (для App Links).
 * Старые адреса /add/… и /join/… на api-домене продолжают работать (их обслуживают прежние маршруты).
 */
export function shareRoutes({ q, mirror, androidCerts = [], webHosts = [] }) {
  return [
    ['GET', /^\/$/, async ({ req }) => {
      const host = String(req.headers.host || '').split(':')[0].toLowerCase();
      if (!webHosts.includes(host)) return { ok: true, service: 'nyao-music' };
      return landing(mirror);
    }],
    ['GET', /^\/\.well-known\/assetlinks\.json$/, async () => [{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'org.nyao.music', sha256_cert_fingerprints: androidCerts }
    }]],
    ['GET', /^\/(?:share\/room|join)\/([A-Za-z0-9]{6})$/, async ({ m }) => {
      const code = m[1].toUpperCase();
      return sharePage({ title: `Слушаем вместе · ${code}`, text: 'Тебя зовут в комнату Nyao Music: музыка играет у всех одновременно, каждый — в своём сервисе.', open: `nyao://join/${code}`, mirror, badge: '♫' });
    }],
    ['GET', new RegExp(`^/share/u/(${NICK})$`), async ({ m }) => {
      const nick = m[1].toLowerCase();
      const { rows } = await q('SELECT u.name, p.nick, p.visibility FROM profiles p JOIN users u ON u.id = p.user_id WHERE lower(p.nick) = $1', [nick]);
      if (!rows.length) return sharePage({ title: 'Профиль не найден', text: `В Nyao Music нет пользователя @${nick}.`, mirror, ok: false, auto: false, badge: '!' });
      const r = rows[0];
      // имя показываем, только если профиль открыт всем; остальное решит приложение по правам
      const title = r.visibility === 'all' && r.name ? `${r.name} · @${r.nick}` : `@${r.nick}`;
      return sharePage({ title, text: 'Профиль в Nyao Music: что слушает, общий вкус и микс на двоих.', open: `nyao://u/${r.nick}`, mirror, badge: '☺' });
    }],
    ['GET', new RegExp(`^/share/track/(${TRACK_ID})$`), async ({ m, url }) => {
      const id = m[1];
      const t = String(url.searchParams.get('t') || '').slice(0, 200);
      const a = String(url.searchParams.get('a') || '').slice(0, 200);
      const d = Math.max(0, Math.min(36000, Number(url.searchParams.get('d')) || 0));
      const qs = new URLSearchParams({ ...(t ? { t } : {}), ...(a ? { a } : {}), ...(d ? { d: String(d) } : {}) }).toString();
      return sharePage({ title: t || 'Трек в Nyao Music', text: a ? `${a} — послушай в Nyao Music. Если этого сервиса у тебя нет, Nyao найдёт трек в другом.` : 'Послушай в Nyao Music.', open: `nyao://track/${id}${qs ? '?' + qs : ''}`, mirror });
    }]
  ];
}
