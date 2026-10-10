// Точка входа сервера. Настройки — из переменных окружения (их кладёт деплой из секретов GitHub).
import http from 'node:http';
import { createPool, migrate } from './db.js';
import { TelegramOIDC } from './telegram.js';
import { ReleaseMirror } from './mirror.js';
import { createApp } from './app.js';

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

const tg = new TelegramOIDC({ clientId: env.TG_CLIENT_ID, clientSecret: env.TG_CLIENT_SECRET, redirectUri: `${PUBLIC_URL}/auth/telegram/callback` });
if (!tg.configured) console.warn('[auth] TG_CLIENT_ID / TG_CLIENT_SECRET не заданы — вход через Telegram выключен');

const mirror = new ReleaseMirror({ repo: env.GITHUB_REPO || 'PersikPrime/nyao-music', dir: env.MIRROR_DIR || '/data/releases', publicUrl: PUBLIC_URL });
mirror.sync();
setInterval(() => mirror.sync(), 15 * 60_000);

const server = http.createServer(createApp({ db: pool, tg, mirror }));
server.listen(Number(env.PORT) || 8080, () => console.log(`[nyao] сервер слушает :${server.address().port}`));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
