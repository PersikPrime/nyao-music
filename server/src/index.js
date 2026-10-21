// Точка входа сервера. Настройки — из переменных окружения (их кладёт деплой из секретов GitHub).
import http from 'node:http';
import { createPool, migrate } from './db.js';
import { TelegramOIDC } from './telegram.js';
import { ReleaseMirror } from './mirror.js';
import { createApp } from './app.js';
import { StatusFile } from './status.js';
import { FcmPush, parseServiceAccount } from './push.js';

const env = process.env;
// PUBLIC_URL — адрес, на который Telegram возвращает после входа и откуда раздаются файлы обновлений
const PUBLIC_URL = env.PUBLIC_URL || 'https://api.nmusic.bixtl.cc';
// WEB_URL — сайт и ссылки «Поделиться» (music.withnyao.app/share/…)
const WEB_URL = (env.WEB_URL || 'https://music.withnyao.app').replace(/\/$/, '');
const WEB_HOSTS = String(env.WEB_HOSTS || new URL(WEB_URL).host).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
// отпечатки SHA-256 ключа подписи APK — для Android App Links (ссылки открывают приложение сразу)
const ANDROID_CERTS = String(env.ANDROID_CERT_SHA256 || '').split(',').map((h) => h.trim().toUpperCase()).filter((h) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(h));

const pool = createPool(env.DATABASE_URL);
for (let i = 0; ; i++) {
  try {
    await migrate(pool);
    break;
  } catch (e) {
    // Postgres в соседнем контейнере может стартовать дольше нас
    if (i > 30) throw e;
    console.log(`[db] жду базу: ${e.message}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const tg = new TelegramOIDC({ clientId: env.TG_CLIENT_ID, clientSecret: env.TG_CLIENT_SECRET, redirectUri: `${PUBLIC_URL}/auth/telegram/callback`, relay: env.TG_RELAY });
if (env.TG_RELAY) console.log(`[auth] Telegram через ретранслятор ${env.TG_RELAY}`);
if (!tg.configured) console.warn('[auth] TG_CLIENT_ID / TG_CLIENT_SECRET не заданы — вход через Telegram выключен');

const mirror = new ReleaseMirror({ repo: env.GITHUB_REPO || 'PersikPrime/nyao-music', dir: env.MIRROR_DIR || '/data/releases', publicUrl: PUBLIC_URL });
mirror.sync();
setInterval(() => mirror.sync(), 3 * 60_000);

// MIN_BUILD — минимальная разрешённая сборка (задаётся переменной репозитория NYAO_MIN_BUILD)
const minBuild = Number(env.MIN_BUILD) || 0;
if (minBuild) console.log(`[nyao] минимальная сборка: ${minBuild}`);
const status = new StatusFile(env.STATUS_FILE || '/data/status/status.json');
const fcm = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
const push = fcm ? new FcmPush(fcm) : null;
console.log(push ? `[push] Firebase: ${fcm.project_id}` : '[push] FCM_SERVICE_ACCOUNT не задан — push выключены');
const server = http.createServer(createApp({ db: pool, tg, mirror, minBuild, status, push, publicUrl: PUBLIC_URL, webUrl: WEB_URL, webHosts: WEB_HOSTS, androidCerts: ANDROID_CERTS }));
server.listen(Number(env.PORT) || 8080, () => console.log(`[nyao] сервер слушает :${server.address().port}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
