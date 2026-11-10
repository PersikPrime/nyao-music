// Предпросмотр окна Nyao Music в обычном Chromium с подставным API — чтобы смотреть вёрстку без Electron и входов.
//   node scripts/preview/run.mjs <папка для снимков> [сценарий…]     сценарии: home library fullscreen fullscreen-nolyrics settings:<раздел>
// Только для разработки. Нужен playwright (в приложение не входит).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', 'src', 'renderer');
const COLORS = [['#3E2350', '#C6B8FF'], ['#1B3A5C', '#8FB4FF'], ['#7A3A10', '#FFB86B'], ['#1F4A3C', '#7CE0C3'], ['#4A1030', '#FF8FB1'], ['#4A3A12', '#F2D675'], ['#2B2F5E', '#C6CBFF']];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
function silence(seconds = 400) {
  const rate = 8000, n = rate * seconds, b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
}
const wav = silence();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__silence.wav') {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'accept-ranges': 'bytes' }); return res.end(wav); }
    const from = Number(m[1]), to = m[2] ? Number(m[2]) : wav.length - 1;
    res.writeHead(206, { 'content-type': 'audio/wav', 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${wav.length}`, 'accept-ranges': 'bytes' });
    return res.end(wav.subarray(from, to + 1));
  }
  const c = /^\/__cover\/(\d+)\.svg$/.exec(u.pathname);
  if (c) {
    const [bg, fg] = COLORS[Number(c[1]) % COLORS.length];
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><circle cx="68" cy="34" r="26" fill="${fg}"/><circle cx="26" cy="80" r="34" fill="#00000040"/></svg>`);
  }
  const file = path.join(root, path.normalize(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const out = process.argv[2] || '.';
const scenarios = process.argv.slice(3).length ? process.argv.slice(3) : ['home'];
const { createRequire } = await import('node:module');
const { chromium } = createRequire(process.env.PLAYWRIGHT_FROM || import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
for (const sc of scenarios) {
  const [name, arg] = sc.split(':');
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1440), height: Number(process.env.H || 900) } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.stack || e).split('\n').slice(0, 3).join(' / ')));
  if (name === 'fullscreen-nolyrics') await page.addInitScript(() => { window.__noLyrics = true; });
  if (process.env.INIT) await page.addInitScript(process.env.INIT);
  await page.addInitScript({ path: path.join(here, 'mock-api.js') });
  await page.goto(base + '/index.html');
  await page.waitForTimeout(1500);
  // переход — как нажатие в боковой панели; раздел настроек — через кнопку с data-action в #view
  const go = async (route, section) => {
    await page.evaluate((r) => { const b = document.createElement('button'); b.dataset.route = r; document.querySelector('#rail').appendChild(b); b.click(); b.remove(); }, route);
    if (section) { await page.waitForTimeout(300); await page.click(`[data-sec="${section}"], [data-section="${section}"]`).catch(() => {}); }
  };
  if (name === 'library' || name.startsWith('fullscreen')) {
    await go('library');
    await page.waitForTimeout(900);
    if (name.startsWith('fullscreen')) {
      await page.click('.trow >> nth=0').catch((e) => errs.push('play: ' + e.message));
      await page.waitForTimeout(600);
      await page.evaluate(() => { const a = document.querySelector('audio') || [...document.querySelectorAll('*')].find((x) => x.tagName === 'AUDIO'); if (a) a.currentTime = 9; });
      await page.click('#pb-full').catch((e) => errs.push('full: ' + e.message));
      await page.waitForTimeout(Number(process.env.WAIT || 1800));
    }
  } else if (name === 'settings') {
    await go('settings', arg);
    await page.waitForTimeout(700);
  } else if (name !== 'home') {
    await go(name, arg);
    await page.waitForTimeout(900);
  }
  if (process.env.EVAL) { await page.evaluate(process.env.EVAL).catch((e) => errs.push('eval: ' + e.message)); await page.waitForTimeout(Number(process.env.WAIT || 500)); }
  const file = path.join(out, `${sc.replace(/[^a-z0-9-]+/gi, '_')}.png`);
  await page.screenshot({ path: file });
  console.log(sc, '→', file, errs.length ? '\n  ' + errs.slice(0, 6).join('\n  ') : '');
  await page.close();
}
await browser.close();
server.close();
