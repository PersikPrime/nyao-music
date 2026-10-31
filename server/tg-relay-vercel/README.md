# Ретранслятор Telegram на Vercel

Сервер Nyao в РФ не видит oauth.telegram.org, а с осени 2026 провайдер режет и адреса Cloudflare
(104.21.x, 172.67.x — там и наш Worker, и любые *.workers.dev). Vercel пока виден.

Ретранслятор пропускает только две вещи: обмен кода (`/token`) и публичные ключи (`/.well-known/jwks.json`).
Секретов в нём нет — ключ бота сервер передаёт в заголовке Authorization, Vercel его не хранит.

1. vercel.com → войти через GitHub → Add New → Project → импортировать `nyao-music`.
2. Root Directory: `server/tg-relay-vercel`, Framework: Other → Deploy.
3. Адрес проекта (например `https://nyao-tg-relay.vercel.app`) → секрет GitHub `NYAO_TG_RELAY`.
4. Перезапустить деплой сервера (Actions → Server deploy → Run workflow).
