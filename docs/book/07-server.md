# 7. Сервер Nyao

`server/` — Node.js 22 без фреймворков, Postgres 17, Caddy (HTTPS), всё в Docker на Selectel.

**Сервер не играет музыку и не знает токенов сервисов.** Он хранит аккаунт Telegram, устройства,
историю, синхронизируемые настройки, соцсеть, тексты песен LyricLabs и раздаёт обновления.
Если для фичи «нужен токен Яндекса на сервере» — это другая фича (README, правило 1).

## Файлы

| Файл | Что |
|------|-----|
| `src/index.js` | Точка входа: читает env, создаёт базу, Telegram, зеркало, push, прокси картинок, поднимает HTTP. Настройки TLS (глава 12) |
| `src/app.js` | `createApp(deps)` — **все маршруты** и обработчик запросов |
| `src/db.js` | `SCHEMA` — список SQL, `migrate()` выполняет их на старте |
| `src/telegram.js` | Вход через Telegram (OpenID Connect + PKCE), ретранслятор, проверка подписи через JWKS |
| `src/hub.js` | Живые события в памяти: Nyao Connect, «Слушать вместе», реакции |
| `src/social.js` | Друзья, профили, приглашения, блокировки, входящие, «сейчас играет» у друзей |
| `src/stats.js` | Итоги («Wrapped») из таблицы `plays` |
| `src/lyrics.js`, `lyrics-web.js/.html` | LyricLabs: API `/api/*` и сайт `lyrics.withnyao.app` |
| `src/admin*.js` | `/admin/*` для Nyao Automator: баны, тексты, профили, push, ярлыки, техработы |
| `src/mirror.js` | Зеркало релизов GitHub (из РФ GitHub бывает медленным) — `/updates/latest`, `/dl/…` |
| `src/status.js` | Техработы и «упавшие» сервисы (`/status`), файл пишет Automator |
| `src/push.js` | Push через Firebase (FCM HTTP v1) |
| `src/img-proxy.js` | `/img?u=` — картинки, которые без VPN не грузятся |
| `src/share.js` | Страницы «Поделиться» на `music.withnyao.app`, Android App Links |
| `src/legacy.js` | Упрощённый вход для Nyao Legacy (Android 4.x) |
| `src/wave-mix.js` | (nightly) своя волна Nyao — глава 6 |
| `cloudflare-worker.js` | Ретранслятор на Cloudflare (деплоится **вручную**, см. ниже) |

## Как устроен маршрут

```js
const routes = [
  // [метод, регулярка пути, обработчик, нужен ли вход]
  ['GET', /^\/history$/, async ({ s, url }) => { … return { items }; }, true],
  ['PUT', /^\/state\/([^/]+)$/, async ({ m, s, req }) => { const key = m[1]; … }, true],
];
```

Обработчик получает `{ req, res, url, m, s, ip }`:
`m` — совпадение регулярки, `s` — сессия (если `needAuth`), `ip` — настоящий адрес (за Cloudflare — `CF-Connecting-IP`).

Что можно вернуть:

| Вернули | Клиент получит |
|---------|----------------|
| объект | `200` + JSON |
| `throw new HttpError(404, 'текст')` | этот статус и `{ error: 'текст' }` |
| любое другое исключение | `500 { error: 'Ошибка сервера' }`, стек — в лог |
| `{ __raw: { type, body, cache?, filename? } }` | файл/HTML/картинка как есть |
| `{ __sent: true }` | ничего — обработчик сам написал в `res` (поток, редирект) |

Маршруты из других модулей подключаются фабриками: `socialRoutes({...})`, `lyricsRoutes({...})`,
`adminRoutes({...})` — им передаются `q` (запрос к базе), `HttpError`, `readJson`, `clip`, `limiter` и т. д.

### Защита по умолчанию

- `needAuth` → заголовок `Authorization: Bearer <токен>`. В базе хранится только `sha256` токена (`sessions.token_hash`).
- `limiter(n)` — не больше `n` запросов в минуту с IP на группу маршрутов. Новый публичный маршрут — со своим лимитером.
- `readJson` режет тело больше 512 КБ. Строки от клиента — через `clip(v, n)`, треки — через `cleanTrack()`.
- `MIN_BUILD`: слишком старые сборки получают `426` и просьбу обновиться (кроме `/api/*` и `/admin/*`).
- Забаненный в Automator пользователь получает отказ, его сессии удаляются.

## Группы маршрутов

| Префикс | Что |
|---------|-----|
| `/health`, `/status` | Жив ли сервер, техработы и сбои сервисов (приложения спрашивают раз в 2 минуты) |
| `/auth/*`, `/me`, `/devices` | Вход через Telegram, профиль, устройства |
| `/history`, `/state/<key>`, `/now` | История, синхронизируемые настройки, «сейчас играет» |
| `/events` | Длинный опрос (до 25 с): команды Connect, комнаты, уведомления |
| `/connect/*`, `/rooms/*` | Nyao Connect, «Слушать вместе» |
| `/friends/*`, `/profile/*`, `/users/*`, `/invites/*`, `/blocks/*`, `/inbox/*`, `/nick`, `/media` | Соцсеть |
| `/stats` | Итоги |
| `/updates/latest`, `/dl/<tag>/<file>` | Зеркало релизов |
| `/img?u=` | Прокси картинок |
| `/push/*` | Регистрация push-токенов |
| `/api/*` | Открытый API LyricLabs (на домене `api.corrode5-15.withnyao.app`) |
| `/admin/*` | Automator (по ролям из `ADMIN_IDS`) |
| `/legacy/*` | Nyao Legacy |

## База

Схема — массив `SCHEMA` в `db.js`, выполняется целиком на каждом старте. Поэтому:

- **Только `CREATE TABLE IF NOT EXISTS` и `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.** Миграции «один раз» не бывает.
- Новое — **в конец** массива.
- Не переименовывайте и не удаляйте колонки — старые сборки приложений ещё ходят на сервер.

Основные таблицы: `users`, `sessions`, `plays` (история), `state` (настройки по ключам), `now_playing`,
`profiles`, `friendships`, `blocks`, `invites`, `inbox`, `push_tokens`, `lyrics_*`, `user_bans`, `admin_audit`,
`app_settings`, `status_*`, `push_broadcasts`, `label_*`, `profile_moderation`.

Тесты (`server/test/`) поднимают базу в памяти (`pg-mem`) — сеть и Docker не нужны: `cd server && npm test`.

## Вход через Telegram

```
приложение POST /auth/start ─► { id, url }      открывает url в браузере
браузер ─► oauth.telegram.org ─► /auth/telegram/callback?code=…&state=…
сервер: обмен code → токены через ретранслятор (TG_RELAY), проверка id_token по JWKS
приложение опрашивает GET /auth/poll?id=… ─► { status: 'done', token, user }   (токен отдаётся один раз)
```

PKCE (`pkce()` в `telegram.js`), ожидание входа — 10 минут, всё в памяти (`logins`).

### Почему ретранслятор

Сервер в РФ: ТСПУ режет ему `oauth.telegram.org`. Cloudflare Worker (`cloudflare-worker.js`, адрес —
секрет `NYAO_TG_RELAY`) пропускает только три вещи: обмен кода (`/token`), публичные ключи (JWKS)
и картинки с известных CDN (`/img?u=`).

**Worker не деплоится из GitHub.** Поменяли `cloudflare-worker.js` — откройте Cloudflare → Workers →
`nyao-tg-relay` → Edit code → вставить файл → Deploy.

`TG_RELAY_IPS` — запасные IP ретранслятора, если DNS режут; `TLS_CURVES` — см. главу 12 (ТСПУ и постквантовый TLS).

## Картинки (`/img`)

Аватарки Telegram, обложки YouTube, SoundCloud, VK из РФ без VPN часто не грузятся. Клиент при ошибке
картинки (`covers.js` на ПК, `ImageProxy.kt` на Android) просит `/img?u=<исходный адрес>`:

- только хосты из белого списка (`proxyable()`), только `https`;
- сервер берёт картинку сам или через Worker, кэширует на диск `/data/imgcache`;
- неудача запоминается на 10 минут, а клиенту уходит `302` на исходный адрес — с VPN откроется как раньше.

## Деплой

`.github/workflows/server.yml`: push в `main` или `nightly` с изменениями в `server/**` (или вручную, «Run workflow»):

1. `npm ci && npm test` в `server/` — упали тесты, деплоя нет.
2. Собирается `.env` из GitHub Secrets и Variables (пароль базы, секрет Telegram, FCM, токен GitHub для Automator, ключ Last.fm…).
3. `server/` копируется по SSH в `/opt/nyao/server`, там `docker compose up -d --build`.

> **Сервер один на все ветки.** Деплой из `nightly` выкатывает nightly-сервер для всех; следующий деплой из
> `main` откатит то, чего в main нет. Перед деплоем из main убедитесь, что серверные изменения nightly уже влиты.

### Docker

`docker-compose.yml`: `db` (postgres:17-alpine, том `pgdata`), `api` (наш `Dockerfile`, порт 8080),
`caddy` (80/443, сертификаты сам). Тома: `pgdata`, `releases`, `status`, `banners`, `imgcache`.
**Всё, что должно пережить деплой, — только в томах** (баннеры однажды пропали именно так).

Домены (Caddyfile): `api.music.withnyao.app` (API), `api.nmusic.bixtl.cc` (старый адрес для старых сборок),
`music.withnyao.app` (сайт, «Поделиться»), `lyrics.withnyao.app` и `api.corrode5-15.withnyao.app` (LyricLabs).

### Диагностика

- `server-diag.yml` — запускает на сервере `probe.mjs` (скрипт пишется под конкретную проблему) и печатает результат в лог Actions.
- `ops.yml` — операции с сервером (перезапуск, логи) по кнопке.
- Логи API: `docker compose logs api` на сервере; последние строки видны и в Automator (`logbuf.js`).

## Переменные окружения

Задаются деплоем, у себя их не храните.

| Переменная | Откуда | Зачем |
|-----------|--------|-------|
| `DATABASE_URL`, `PGPASSWORD` | compose / `NYAO_DB_PASSWORD` | база |
| `TG_CLIENT_ID`, `TG_CLIENT_SECRET` | workflow / `NYAO_TG_CLIENT_SECRET` | вход через Telegram |
| `TG_RELAY`, `TG_RELAY_IPS` | `NYAO_TG_RELAY`, var `NYAO_TG_RELAY_IPS` | ретранслятор |
| `MIN_BUILD` | var `NYAO_MIN_BUILD` | минимальная сборка приложений |
| `FCM_SERVICE_ACCOUNT` | `NYAO_FCM_SERVICE_ACCOUNT` | push |
| `ADMIN_IDS`, `GH_ADMIN_TOKEN`, `AUTOMATOR_REPO` | `NYAO_ADMIN_IDS`, `NYAO_GH_ADMIN_TOKEN`, var | Automator |
| `DEV_IDS` | `NYAO_DEV_IDS` | кто видит раздел «Разработчик» и dev-функции |
| `LYRICS_ADMINS` | var `NYAO_LYRICS_ADMINS` | модераторы LyricLabs |
| `ANDROID_CERT_SHA256` | считается из ключа подписи APK | App Links |
| `LASTFM_KEY` | `NYAO_LASTFM_KEY` (nightly) | своя волна Nyao |
| `MIRROR_DIR`, `STATUS_FILE`, `DATA_DIR` | compose | пути в томах |
