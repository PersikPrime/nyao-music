// Сайт Nyao Music: одна страница, загрузки и немного служебного. Express + EJS, без сборки.
const path = require('node:path');
const express = require('express');
const compression = require('compression');
const config = require('./config');
const shapes = require('./lib/shapes');
const { getReleases } = require('./lib/releases');

const app = express();
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(compression());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

/** Какая платформа у гостя — чтобы сразу показать нужную кнопку */
function detect(ua = '') {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/mac os x|macintosh/i.test(ua)) return 'mac';
  return 'win';
}
const sizeLabel = (bytes) => (bytes ? `${Math.round(bytes / 1048576)} МБ` : '');
// тег v0.10.114 или v0.10.118-nightly → «0.10 · 114»
const versionLabel = (rel, fallback) => {
  const m = rel && /^v?(\d+\.\d+)\.(\d+)/.exec(rel.tag || '');
  return m ? `${m[1]} · ${m[2]}` : fallback;
};

app.get('/', async (req, res, next) => {
  try {
    const releases = (await getReleases()) || {};
    const platforms = config.platforms.map((p) => {
      const file = releases.stable && releases.stable.files[p.id];
      const red = releases.red && releases.red.files[p.id];
      return { ...p, href: `/download/stable/${p.id}`, redHref: `/download/red/${p.id}`, altHref: p.alt ? `/download/stable/${p.alt.id}` : '', size: sizeLabel(file && file.size), hasRed: !!red || !releases.red };
    });
    res.render('index', {
      config, shapes, platforms,
      os: detect(req.get('user-agent')),
      stableVersion: versionLabel(releases.stable, config.fallback.stable),
      redVersion: versionLabel(releases.red, config.fallback.red),
      year: new Date().getFullYear(),
    });
  } catch (e) { next(e); }
});

// Кнопки «Скачать» ведут сюда: отдаём свежий файл с GitHub, а если его нет — страницу релизов
app.get('/download/:channel/:os', async (req, res) => {
  const channel = req.params.channel === 'red' ? 'red' : 'stable';
  const ids = config.platforms.flatMap((p) => [p.id, p.alt && p.alt.id]).filter(Boolean);
  if (!ids.includes(req.params.os)) return res.redirect(302, config.links.releases);
  const releases = (await getReleases()) || {};
  const rel = releases[channel];
  const file = rel && rel.files[req.params.os];
  res.redirect(302, file ? file.url : rel ? rel.url : config.links.releases);
});

app.get('/api/releases', async (req, res) => {
  const r = (await getReleases()) || {};
  const slim = (x) => x && { version: versionLabel(x, ''), date: x.date, url: x.url, files: Object.fromEntries(Object.entries(x.files).map(([k, f]) => [k, { name: f.name, size: f.size }])) };
  res.json({ stable: slim(r.stable) || null, red: slim(r.red) || null });
});

app.get(['/health', '/healthz'], (req, res) => res.json({ ok: true, service: 'nyao-site' }));
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nSitemap: ${config.siteUrl}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${config.siteUrl}/</loc></url></urlset>`));

app.use((req, res) => res.status(404).render('404', { config, shapes }));
app.use((err, req, res, _next) => {
  console.error('[site]', err);
  res.status(500).type('text').send('Что-то сломалось. Попробуй обновить страницу.');
});

if (require.main === module) app.listen(config.port, () => console.log(`[site] Nyao Music: http://localhost:${config.port}`));
module.exports = app;
