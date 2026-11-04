# 11. Рецепты

Пошагово для частых задач. Названия функций точные — ищите их поиском по файлу.

---

## ПК: новая кнопка

1. В HTML нужного `render…()`:
   ```js
   `<button class="btn" data-action="clear-history">Очистить историю</button>`
   ```
   Параметры — через `data-*`: `data-id="${esc(id)}"` → в обработчике `el.dataset.id`.
2. В `handleAction()` (`app.js`) — новая ветка:
   ```js
   case 'clear-history':
     await api.cloud.clearHistory();   // если нужен main — см. «новый IPC-канал»
     toast('История очищена');
     renderSettings();
     break;
   ```
3. Всё. Ошибка из `await` сама станет красным тостом (обработчик `click` на `#view` ловит исключения).

Кнопка в нижнем плеере или в `#drawer` работает так же — у них тот же делегированный обработчик.

## ПК: новый экран

1. Функция отрисовки:
   ```js
   function renderHistory() {
     view.innerHTML = `<div class="scroll"><h1 class="page">История</h1>
       ${state.history ? tracksHtml(state.history, 'history') : '<div class="skeleton" style="height:300px"></div>'}</div>`;
   }
   ```
2. Загрузка данных:
   ```js
   async function loadHistory() {
     try { state.history = await api.cloud.history(); }
     catch (e) { toast(e.message, true); state.history = []; }
     if (state.route === 'history') renderHistory();   // пользователь мог уйти, пока ждали
   }
   ```
3. Зарегистрировать: в `const RENDER = { … }` добавить `history: renderHistory`, в `go()` —
   `if (route === 'history') loadHistory();`.
4. Вход на экран: `data-action="go" data-route="history"` на любой кнопке, или пункт в `NAV` (левая панель).
5. Строки `tracksHtml(…, 'history')` сразу умеют играть (`play-row`) и открывать меню «⋯» — ничего добавлять не нужно.
6. Стили — в `styles.css`; если на macOS выглядит иначе — проверьте `theme-mac.css`.

## ПК: пункт в меню «⋯» трека

`openMenu()` (`app.js`):

1. Кнопка в шаблоне: `<button data-m="lyrics">Текст песни</button>` (при условии — через `${cond ? '…' : ''}`).
2. Ветка в `menu.onclick`: `else if (b.dataset.m === 'lyrics') { … }`.

Меню используется и из полноэкранного режима (`FullScreen({ menu })`) — проверьте там тоже.

## ПК: новый IPC-канал (окно просит что-то у main)

1. `src/main/main.js`, внутри `registerIpc()`:
   ```js
   handle('cloud:clearHistory', async () => {
     needCloud();                                    // бросит понятную ошибку без входа
     return cloud.request('DELETE', '/history');
   });
   ```
2. `src/preload.cjs`, в нужной группе:
   ```js
   clearHistory: () => call('cloud:clearHistory'),
   ```
3. В окне: `await api.cloud.clearHistory()`.

Аргументы и ответ должны сериализоваться (structured clone): никаких функций, классов, DOM.
Ошибки — обычным `throw new Error('понятный текст')`: текст увидит пользователь (после `safeDiagnostic`).

## ПК: новая настройка

1. `src/main/store.js` → `DEFAULT_SETTINGS`: `myOption: false,  // что делает`.
2. В окне читать `state.settings.myOption`, писать `await api.settings.set({ myOption: true })` (возвращает новые настройки).
3. Нужно на других устройствах? Добавьте ключ в `PREF_KEYS` (или `WAVE_KEYS` для волны) в `main.js`,
   а на Android — в `Prefs.kt` (и в разбор синхронизации в `NyaoCloud.kt`).

## Сервер: новый маршрут

`server/src/app.js` (или модуль группы — `social.js`, `admin.js`…):

```js
['DELETE', /^\/history$/, async ({ s }) => {
  await q('DELETE FROM plays WHERE user_id = $1', [s.id]);
  return { ok: true };
}, true],                                   // true — только с входом
```

- Данные от клиента — через `readJson(req)` и `clip(v, n)`; трек — `cleanTrack(t)`.
- Публичный (без входа) — свой `limiter(n)` и вызов `xxxLimit(ip)` в начале.
- Тест в `server/test/` (по образцу `api.test.js`: `helpers.js` поднимает приложение с базой в памяти).
- Деплой — сам после push в `main`/`nightly` (`server/**`).

## Сервер: новая колонка или таблица

В **конец** массива `SCHEMA` в `server/src/db.js`:

```js
`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS pronouns TEXT`,
```

Только идемпотентный SQL (`IF NOT EXISTS`), никаких переименований и удалений — схема выполняется на каждом старте,
а старые приложения ещё ходят.

## Новый музыкальный сервис

Большая задача. Порядок:

1. **Провайдер** `src/main/providers/<svc>.js`: `loggedIn`, `getAccount`, `search`, `likedTracks`, `playlists`,
   `playlistTracks`, `like`, `streamUrl`, `mapTrack` → формат трека из главы 5. Короткий код источника (`'dz'`).
2. **`initProviders()`** в `main.js` — создать; добавить в `providers()`.
3. **Звук**: ветка в `StreamService.resolve()` (`stream.js`), если поток нестандартный — поддержка в обработчике `nyao://stream`.
4. **Вход**: окно в `auth.js`, сохранение в `secrets`, обработчики `auth:*` и статус в `send('status', …)`.
5. **Окно**: `SERVICES` и `srcName()` в `app.js` (кнопка аккаунта и меню подхватят), значок `badge()`, цвет в стилях.
6. **Поиск**: обработчик `search` в `main.js`, склейка в `search.js`.
7. **Волна**: ветка в `WaveMixer.recommendations()` и `sources()`.
8. **Статус**: код в `SERVICES` в `server/src/status.js` (для «сервис упал»), прокси картинок — хост в белый список `img-proxy.js` и `cloudflare-worker.js`.
9. **Android и iOS** — то же самое там (`data/<Svc>Api.kt`, `Services/<Svc>API.swift`).

## Android: новый экран

1. `Route` в `ui/AppModel.kt`: `data object History : Route`.
2. Если это страница поверх вкладки — добавить её в условие `go()` (иначе стек сбросится).
3. `ui/NyaoRoot.kt`: ветка `Route.History -> HistoryScreen(model)` в `when`, порядок для анимации и вкладка-родитель рядом.
4. `ui/screens/HistoryScreen.kt`: `@Composable fun HistoryScreen(model: AppModel)`; данные — в поле `AppModel`,
   загрузка — `model.launch { … }`.

## Выпустить dev-сборку

```bash
git checkout dev
# правки…
# version.json: build +1, "channel": "dev"
node scripts/bump.mjs --sync
$EDITOR .github/notes/v0.8.<build>-dev.md
git commit -am "dev 0.8 (<build>): коротко что нового" && git push
```

Через ~15 минут в релизе `v0.8.<build>-dev` появятся EXE/DMG/ZIP, `.nui`, APK, IPA.
