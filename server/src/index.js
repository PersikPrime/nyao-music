// Точка входа сервера. Настройки — из переменных окружения (их кладёт деплой из секретов GitHub).
import http from 'node:http';
import { createPool, migrate } from './db.js';
import { TelegramOIDC } from './telegram.js';
import { ReleaseMirror } from './mirror.js';
import { createApp } from './app.js';
import { StatusFile } from './status.js';
import { FcmPush, parseServiceAccount } from './push.js';

const env = process.env;
const PUBLIC_URL = env.PUBLIC_URL || 'https://api.nmusic.bixtl.cc';

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
const server = http.createServer(createApp({ db: pool, tg, mirror, minBuild, status, push, publicUrl: PUBLIC_URL }));
server.listen(Number(env.PORT) || 8080, () => console.log(`[nyao] сервер слушает :${server.address().port}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
