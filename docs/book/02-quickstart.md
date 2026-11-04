# 2. Быстрый старт

## ПК (Electron)

Нужен Node.js 22 (минимум 20) и git.

```bash
npm install          # ставит Electron от castlabs (с Widevine) — первый раз долго
npm start            # запуск
npm run dev          # то же, но с DevTools
npm test             # тесты ПК (node --test test/*.test.js)
```

- Тема macOS на Windows: `NYAO_THEME=mac npm start`.
- Данные приложения (настройки, секреты, кэш, горячие обновления) — в папке `userData` Electron:
  Windows `%APPDATA%/Nyao Music`, macOS `~/Library/Application Support/Nyao Music`.
- Горячее обновление в `userData/hot/` подменяет код из репозитория! Если правки «не применяются» —
  в центре обновлений нажмите «Вернуть версию из установщика» (или в разделе «Разработчик» —
  «Вернуть код установщика»), либо удалите папку `hot/`.
- `npm run yt-test` — проверка, что YouTube отдаёт звук (без запуска интерфейса).

Собрать установщик локально: `npm run dist` (Windows) или `npm run dist:mac`. Обычно не нужно —
всё собирает GitHub Actions (глава 10).

## Android

JDK 17, Android SDK 36.

```bash
cd android
./gradlew assembleDebug      # или assembleRelease (подпись — только в CI)
```

Версия берётся из корневого `version.json` (см. `android/app/build.gradle.kts`).
Открывать удобно в Android Studio как проект `android/`.

## iOS

Только на Mac с Xcode 16+ (в CI — Xcode 26).

```bash
brew install xcodegen
cd ios && xcodegen generate     # создаёт NyaoMusic.xcodeproj из project.yml (в git его нет)
open NyaoMusic.xcodeproj
```

Подписывать не нужно: CI собирает неподписанный IPA, на устройстве его подписывает SideStore (глава 9).

## Сервер

```bash
cd server
npm install
npm test                     # 50+ тестов; база — pg-mem в памяти, сеть не нужна
```

Запустить по-настоящему локально: нужен Postgres. Проще всего `docker compose up` в `server/`,
предварительно создав `server/.env` с минимумом:

```
POSTGRES_PASSWORD=любой
DOMAIN=localhost
TG_CLIENT_ID=
TG_CLIENT_SECRET=
```

Без `TG_CLIENT_ID/SECRET` всё работает, кроме входа через Telegram. Боевой `.env` пишет деплой из
GitHub Secrets — у себя его не храните (в `.gitignore` он уже есть).

## С чего начать читать код

1. `src/main/main.js` → функции `initProviders()` и `registerIpc()`: что умеет приложение.
2. `src/preload.cjs`: весь список того, что окно может попросить у main.
3. `src/renderer/app.js` → `go()`, `RENDER`, `handleAction()` (глава 4).
4. `src/renderer/player.js`: очередь и воспроизведение.
5. `src/main/wave.js` + `wave-policy.js`: волна (глава 6).
