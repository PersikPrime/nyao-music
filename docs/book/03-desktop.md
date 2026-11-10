# 3. ПК: main, preload, окно

Electron делит приложение на два мира:

| Процесс | Файлы | Что может |
|---------|-------|-----------|
| **main** (Node.js) | `src/main/**` | Сеть без CORS, файлы, токены, окна входа, трей, протокол `nyao://` |
| **renderer** (окно, Chromium) | `src/renderer/**` | Только интерфейс. Node недоступен: `contextIsolation`, `sandbox`, `nodeIntegration: false` |

Между ними — **preload** (`src/preload.cjs`): он выставляет в окно объект `window.nyao` и больше ничего.

## Как окно просит что-то у main (IPC)

Цепочка всегда одна:

```
renderer: await api.library.liked()            // api = window.nyao
preload:  liked: () => call('library:liked')    // ipcRenderer.invoke
main:     handle('library:liked', async () => …) // registerIpc() в main.js
```

`handle(channel, fn)` в `main.js` оборачивает ответ: `{ ok: true, data }` или `{ ok: false, error }`.
`call()` в preload разворачивает его обратно и **бросает Error с текстом**, если `ok: false`.
Поэтому в окне достаточно `try/catch` + `toast(e.message, true)`.

Сообщения в обратную сторону (main → окно) идут через `send(channel, payload)` в main и
`ipcRenderer.on(channel, …)` в preload, например `status`, `win:state`, `stream:substitute`, `social:open`.

Где искать обработчик: `grep "handle('имя:канала'" src/main/main.js`. Все ≈120 каналов регистрируются
в `registerIpc()`. Группы по префиксу:

| Префикс | Что |
|---------|-----|
| `win:` `app:` `theme:` | окно, версия, тема |
| `auth:` | вход и выход из сервисов (`auth.js`) |
| `home`, `library:`, `search`, `catalog:`, `artists:`, `mix:` | данные для экранов |
| `wave:` `radio:` | волна и радио по треку |
| `stream:` `lyrics` `like` `track:details` `match:playable` | воспроизведение |
| `cloud:` `social:api` `connect:` `room:` `stats` | сервер Nyao |
| `spotify:` `dev:librespot*` | Spotify |
| `update:` `dev:` | обновления и раздел «Разработчик» |
| `lastfm:` `rpc:` `transfer:` | Last.fm, Discord, перенос плейлистов |

## Протокол `nyao://`

Зарегистрирован в `main.js` (`protocol.registerSchemesAsPrivileged` в начале файла,
`protocol.handle('nyao', …)` в `app.whenReady`). Окно использует его как обычные URL:

| Адрес | Что отдаёт |
|-------|-----------|
| `nyao://stream/<id трека>` | Звук. `<audio src>` указывает сюда, а `stream.js` находит прямую ссылку сервиса, кэширует её и отдаёт байты с поддержкой Range (перемотка) |
| `nyao://cover/<id>.png` | Шаблонная обложка «диск на цвете» (`cover-art.js`) для трека без картинки |

Ссылки `nyao://…` из браузера (приглашения, комнаты, профили, треки) разбирает `deeplink.js` —
это другое применение той же схемы (приложение зарегистрировано обработчиком ссылок).

> CSP окна (`index.html`, `img-src`) обязана содержать `nyao:`, иначе шаблонные обложки не
> показываются. Это уже ломалось (глава 12).

### Почему звук идёт через прокси

- У сервисов разные ссылки и правила: у Яндекса — подписанный mp3 на час, у YouTube — куски по 4 МБ
  с правильным User-Agent (их отдаём через Node fetch, не через сеть Chromium), у VK — HLS из MPEG-TS
  (его `stream.js` сам разбирает в mp3/AAC, `demuxTs()`), у SoundCloud — HLS.
- Окну всё равно: оно играет `nyao://stream/ya:123`. Протухла ссылка — прокси берёт новую.
- Spotify: в `<audio>` — тишина той же длины, а звук играет устройство Spotify (`spotify-sync.js`).
  Без Premium — ищется копия трека в другом сервисе и играет она.

## Настройки и секреты

`src/main/store.js`:

- **settings** — обычный JSON `settings.json` в `userData`. Все ключи и значения по умолчанию —
  в `DEFAULT_SETTINGS` (там же комментарии к каждому). Новый ключ добавляйте туда.
- **secrets** — токены и cookies сервисов, зашифрованы `safeStorage` (на Windows — DPAPI пользователя).
- Часть настроек синхронизируется с сервером: `WAVE_KEYS` и `PREF_KEYS` в `main.js`
  (обработчик `settings:set` сам отправляет их через `cloud.pushState`). Хотите, чтобы новая
  настройка ехала на другие устройства, — добавьте ключ в один из этих списков.

## Окна входа

`src/main/auth.js`. Каждому сервису — своё окно со своей сессией (partition):

- **Яндекс** — OAuth-страница, токен ловится из адреса после редиректа.
- **YouTube Music** — вход Google, забираем cookies `music.youtube.com` (нужен `SAPISID`).
- **SoundCloud** — cookie `oauth_token`; капча DataDome показывается отдельным окном (`solveScCaptcha`).
- **VK** — десктопная версия сайта, id пользователя берём из `window.vk.id`, запросы идут через
  сессию окна (`vkSessionFetch`), сессия продлевается тихо (`refreshVkSession`).

Пароли к нам не попадают никогда — только токен/cookies после входа.

## Обновления

- `updates.js` — центр обновлений: смотрит последний релиз (через зеркало на нашем сервере
  `/updates/latest`, запасной путь — GitHub), качает установщик.
- `hot.js` — горячие обновления: код приложения (`src/**`, `version.json`, `package.json`) приходит
  подписанным пакетом `.nui` (Ed25519) и ставится в `userData/hot/<build>/` без установщика.
  Подходит, только если совпадает «compat» — версия Electron и библиотек. Подробно — глава 10.

## Прочее в main

| Файл | Зачем |
|------|-------|
| `cloud.js` | Клиент сервера Nyao: вход через Telegram (опрос `/auth/poll`), история, «сейчас играет», синхронизация `state`, соцсеть (`social:api` пропускает к серверу только разрешённые адреса соцсети) |
| `live.js` | Длинный опрос `/events`: команды Nyao Connect, «сейчас играет» на других устройствах |
| `popup.js` | Окошки в углу экрана как у Steam: «зовёт слушать вместе», «прислал трек» |
| `lastfm.js` | Скробблинг. Ключи приложения кладутся в `lastfm-keys.json` при сборке из секретов |
| `discord.js` | Discord Rich Presence без зависимостей (локальный IPC Discord) |
| `radio.js` | Радио по треку |
| `transfer.js` | Перенос плейлиста в другой сервис (через `match.js`) |
| `catalog.js` | Объединённые страницы исполнителя и альбома из нескольких сервисов |
| `diagnostics.js` | `safeDiagnostic()` — вырезает из ошибок токены, cookies, query-строки. Всё, что пишется в лог, пропускайте через неё |

## Дополнения

Песочница для дополнений — `src/main/addons` (манифест и права, запуск, локальные страницы), встроенные дополнения — `src/addons`. Описание API и защиты: [docs/addons.md](../addons.md). Свои дополнения запускаются только в Red, из папки для разработки.
