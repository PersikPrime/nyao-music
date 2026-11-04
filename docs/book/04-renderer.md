# 4. ПК: интерфейс и `app.js`

`src/renderer/app.js` — около 4000 строк. Страшно только первый день: внутри нет магии,
фреймворка и скрытого состояния. Это **один модуль с пятью механизмами**, которые повторяются
от экрана к экрану. Поймёте их — сможете править любой экран.

## Пять механизмов

### 1. Состояние — один объект `state`

```js
const state = {
  route: 'home', params: {}, stack: [],     // где мы и как вернуться назад
  status: { ya, yt, sc, vk },               // в какие сервисы вошли
  settings,                                 // копия настроек из main
  home, lib, search, artist, album, …       // данные экранов
  drawer,                                   // открытая боковая панель: null | 'info' | 'queue'
  cloud, room, stats, …                     // аккаунт Nyao, «Слушать вместе», итоги
};
```

Ничего реактивного: поменяли `state` — сами вызвали нужный `render…()`.

Рядом живут:
- `player` — экземпляр `Player` (`player.js`): очередь, `<audio>`, события `track`, `queue`, `state`, `time`, `like`;
- `lists` — словарь «ключ списка → массив треков» (см. механизм 4);
- `api = window.nyao` — всё, что умеет main (глава 3).

### 2. Экран = функция `render…()`, которая пишет HTML в `#view`

```js
function renderLibrary() {
  view.innerHTML = `<div class="scroll">…${tracksHtml(tracks, 'lib')}…</div>`;
}
```

Все экраны перечислены в одной строке — **`RENDER`** (ищите `const RENDER =`):

```js
const RENDER = { home: renderHome, wave: renderWave, library: renderLibrary, search: renderSearch,
                 settings: renderSettings, prefs: renderSettings, artist: renderArtist, album: renderAlbum,
                 together: renderTogether, stats: renderStats, tracks: renderTrackList,
                 friends: () => friends.renderFriends(), user: …, profile: … };
```

Переход между экранами — **`go(route, params)`**: кладёт текущий экран в `state.stack`,
вызывает `RENDER[route]()` и запускает загрузку данных (`loadHome()`, `loadLibrary()` …).
`back()` достаёт предыдущий экран из стека. Экраны друзей и профилей отрисовывает модуль
`friends.js` (`friends.renderFriends()` и т. п.) — он получает нужные функции app.js через `createFriends({...})`.

Типичный экран рисуется **дважды**: сразу (со скелетом или «Загружаем…») и после прихода данных
(`load…()` кладёт данные в `state` и снова зовёт `render…()`, если пользователь ещё на этом экране:
`if (state.route === 'library') renderLibrary();`).

### 3. Клики — атрибут `data-action` и один большой `switch`

Ни одного `onclick` в HTML. Кнопка просто помечается:

```html
<button data-action="wave-tune">Настроить волну</button>
<button data-action="open-artist" data-ref="ya:123">Имя</button>
```

Один обработчик на всё окно (`view.addEventListener('click', …)`) находит ближайший
`[data-action]` и отдаёт его в **`handleAction(el, e)`** — там `switch (a)` примерно на 150 веток.
Параметры берутся из `el.dataset.*`. Ошибка внутри ветки автоматически превращается в тост.

Тот же механизм у боковой панели (`#drawer`) и нижнего плеера. Действия с префиксом `fr-`
сначала отдаются `friends.action(el)`.

Найти, что делает кнопка: `grep "case 'имя-действия'" src/renderer/app.js`.

Формы — так же через `data-form` (обработчик `submit`), ползунки и поля — через `data-input`
(обработчик `input`).

### 4. Списки треков — `tracksHtml(tracks, key)` + `lists[key]`

```js
${tracksHtml(state.lib.tracks, 'lib')}   // рисует строки и запоминает lists['lib'] = tracks
```

Каждая строка получает `data-action="play-row" data-list="lib" data-i="5"`. По клику
`handleAction` берёт `lists['lib'][5]` — так в DOM не хранится JSON треков, а у любого списка
бесплатно работают воспроизведение, меню «⋯» (`row-more`) и перетаскивание в очереди.

Обложка в строке — `coverHtml(track)`. У трека без картинки сам подставит шаблонный диск,
а если картинка не загрузилась — подтянет её через сервер Nyao или покажет шаблон (`covers.js`).

### 5. Плеер и события

`player.js` — класс на `EventTarget`. app.js подписан на его события ближе к концу файла:

```js
player.addEventListener('track', () => { renderBar(); …обновить панель, текущую строку… });
player.addEventListener('queue', …);   // очередь поменялась
player.addEventListener('time',  …);   // позиция (часто!) — только лёгкие обновления
```

Нижний плеер рисует `renderBar()`; полноэкранный режим — отдельный класс `FullScreen` (`fullscreen.js`),
ему app.js передаёт зависимости (`player`, `api`, `toast`, `menu`, …).

## Карта файла

Порядок разделов в app.js (заголовки `// ---------- … ----------`). Номера строк примерные.

| ≈ строка | Раздел | Что там |
|---------:|--------|---------|
| 1–70 | Импорты, `api`, `player`, `state` | Всё глобальное. `lists`, `artistCache` |
| 70–255 | Утилиты | `esc()` (экранирование — **всегда** для данных в HTML), `coverHtml`, `rowHtml`, `tracksHtml`, `badge`, `toast`, форматтеры, `waveControlsHtml` |
| 258–300 | Акцентный цвет, вид приложения | `refreshAccent`, `layout()` (режим «Плеер» или «Моя волна») |
| 297–440 | Навигация | `renderRail()` (левая панель), `go()`, `back()` |
| 440–670 | Главная и волна | `renderHome`, `renderHomePlayer` (режим «Плеер»), `renderWave` |
| 670–790 | Боковая панель | `openDrawer/closeDrawer/toggleDrawer`, `renderDrawer` (очередь и «Об исполнителе») |
| 790–1110 | Медиатека, поиск, исполнитель, альбом, вход в сервисы | `renderLibrary`, `renderSearch`, `renderArtist`, `renderAlbum`, карточки сервисов |
| 1110–1280 | Аккаунт Nyao | вход через Telegram, устройства, «продолжить с телефона» |
| 1280–1640 | Профиль и настройки | `renderSettings`, `renderSettingsSection(sec)`, Last.fm, звук, раздел «Разработчик» |
| 1640–1745 | Техработы и сбои сервисов | плашки статуса, `createFriends(...)`, **`const RENDER`** |
| 1746–1920 | Загрузка данных | `loadHome`, `loadLibrary`, `loadLiked`, `loadArtist`, `setWave` … |
| 1920–2060 | Меню «⋯» | `openMenu(x, y, track, queueIndex, { addOnly })`, `askText()` (замена `prompt()`) |
| 2060–2420 | Nyao Connect, «Слушать вместе», итоги, перенос плейлиста | `renderConnect`, `renderTogether`, `renderStats` |
| 2484–3200 | **`handleAction()`** | Большой `switch` по `data-action` |
| 3197–3310 | Обработчики событий окна | `click`, `submit`, `input`, `change` на `#view` и `#drawer` |
| 3311–3560 | Нижний плеер | `renderBar()`, подписки на события `player`, `FullScreen`, приколы |
| 3564–3760 | Сессия, окно, клавиши, приветствие, обязательное обновление | восстановление очереди после перезапуска, горячие клавиши |
| 3760–3880 | Конструктор микса | `renderMixBuilder` |
| 3880–3980 | **Старт** | `init()`: настройки → статус сервисов → первый экран → фоновые загрузки |
| 3980–конец | Перетаскивание в очереди | `dragstart/dragover/drop` для `#qlist` |

## Каркас окна (`index.html`)

| id | Что |
|----|-----|
| `#rail` | Левая панель навигации (`renderRail`) |
| `#accounts` | Аватар и значки сервисов вверху |
| `#view` | Текущий экран — сюда пишут все `render…()` |
| `#drawer` | Боковая панель справа (очередь, «Об исполнителе») |
| `#playerbar`, `#pb-*` | Нижний плеер |
| `#menu` | Всплывающее меню «⋯» (`openMenu`) |
| `#toast` | Уведомление (`toast(msg, isErr)`) |
| `#connect` | Окно Nyao Connect |
| `#audio` | Единственный `<audio>`, им управляет `player.js` |

## Остальные файлы интерфейса

| Файл | Зачем |
|------|-------|
| `player.js` | Очередь, режимы `wave`/`list`, повтор, перемешивание, Media Session (медиаклавиши, шторка Windows), отчёт о прослушивании (`reportLeave`) |
| `fullscreen.js` | Полноэкранный режим: обложка, текст песни с караоке, очередь (перетаскивание, меню по точкам), карточка со строками |
| `friends.js` + `profile-ui.js` | Друзья, профили, редактор профиля, аватары-печеньки, значки |
| `covers.js` | Шаблонные обложки и запасной путь картинок через сервер |
| `social.js` | Логика Connect/«Вместе»/итогов без DOM |
| `search.js` | Склейка и ранжирование результатов поиска |
| `eq.js` | Эквалайзер на Web Audio поверх `<audio>`, плавные переходы |
| `onboarding.js` | Приветствие при первом запуске |
| `spotify-sync.js`, `sp-mode.js`, `librespot-ui.js` | Связка плеера и Spotify |
| `accent.js`, `ribbon.js`, `layouts.js` | Акцентный цвет, «лента» волны, выбор вида приложения |
| `lyric-card.js` | Картинка «строки из песни» для соцсетей |
| `hundred.js`, `pranks.js` | Пасхалка сотой сборки и «приколы» раздела «Разработчик» |
| `styles.css` | Все стили; `theme-mac.css` — поверх для Liquid Glass |

## Правила хорошего тона в app.js

- **Любые данные в HTML — через `esc()`.** Названия треков приходят от сервисов и пользователей.
- **Не держите ссылки на DOM между рендерами** — `innerHTML` их пересоздаёт. Ищите элемент заново: `$('#id', view)`.
- **`time` приходит много раз в секунду.** В его обработчике — только точечные правки (полоска, цифры), без `render…()`.
- **Новая кнопка — новый `case` в `handleAction`**, а не свой `addEventListener`.
- **Долгие вызовы `api` — с проверкой, что экран не сменился**, пока ждали: `if (state.route !== 'x') return;`.
- **Ошибки — в тост.** Не глушите их молча, если пользователь нажал кнопку и ждёт результата.

## Если файл всё-таки хочется распилить

Удачные примеры выноса уже есть: `friends.js` (получает зависимости через объект), `social.js`
и `search.js` (чистая логика без DOM — такую легко покрыть тестами). Выносить стоит так же: модуль-фабрика,
которой app.js передаёт `state`, `api`, `esc`, `toast`, `go` и т. п. Глобальные переменные между модулями не делать.
