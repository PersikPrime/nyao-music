# 8. Android

`android/` — Kotlin, Jetpack Compose (Material 3 Expressive), Media3 (ExoPlayer + MediaSession), Coil 3.
Пакет `org.nyao.music`, минимум Android 8.0.

Это не порт Electron-кода, а отдельная реализация **той же логики**: провайдеры, волна, совпадения
треков, тексты повторяют ПК. Близнецы подписаны в комментариях («как на ПК: src/main/…»).

## Карта

```
org/nyao/music/
  NyaoApp.kt             Application: Repo.init, Coil с прокси картинок, друзья
  MainActivity.kt        одна Activity, setContent { NyaoRoot() }, ссылки nyao:// и music.withnyao.app
  data/                  всё без UI
    Repo.kt              object Repo — «main-процесс» Android: провайдеры, библиотека, поиск, nyao://-ссылки
    Models.kt            Track, Playlist, HomeData… (тот же формат, что на ПК)
    YandexApi.kt  YtMusicApi.kt + YtStreams.kt  ScApi.kt  VkApi.kt     провайдеры
    WaveMixer.kt + WavePolicy.kt   волна (глава 6)
    Match.kt  Search.kt  Lyrics.kt  Radio.kt  Mixes.kt  Freshness.kt
    NyaoCloud.kt + SocialModels.kt   клиент сервера Nyao
    Prefs.kt             настройки и токены (SharedPreferences приложения)
    ImageProxy.kt        OkHttp-клиент: картинка не загрузилась → /img на сервере
    TemplateCover.kt     шаблонные обложки
    LibraryCache.kt  PendingLikes.kt  Updates.kt  LastFm.kt  Diagnostics.kt
  playback/
    PlaybackService.kt   MediaSessionService: ExoPlayer, уведомление, ошибки, виджет
    PlayerConnection.kt  object — мост UI ↔ сервис через MediaController (play, очередь, волна)
    RoutingDataSource.kt откуда качать: кэш на диске или напрямую (SC и VK — мимо кэша)
    ChunkedDataSource.kt YouTube кусками, PlaybackCache.kt, Offline.kt
    NyaoEqualizer.kt  NyaoWidget.kt + WidgetArt.kt  NyaoPush.kt  NfcShare.kt
    Friends.kt  Social.kt   живые события (Connect, «вместе»), уведомления друзей
  spotify/               Spotify: авторизация, API, движок, тишина-заглушка (SilenceDataSource)
  ui/
    AppModel.kt          состояние экранов и навигация (sealed interface Route)
    NyaoRoot.kt          каркас: навигация, мини-плеер, шторки, when(route) → экран
    screens/             HomeScreen, WaveScreen, LibraryScreens, NowPlayingScreen, SettingsScreen, SocialScreens…
    components/          общие куски: Common, Expressive, Motion, NyaoIcons, LyricCard
    theme/               Theme, AccentSync (акцент с обложки), LookShapes
```

## Навигация и состояние

```kotlin
sealed interface Route {
    data object Home : Route
    data object Wave : Route
    data class ArtistPage(val source: String, val id: String?, val name: String) : Route
    …
}
class AppModel(scope) {
    val stack = mutableStateListOf<Route>(Route.Home)
    fun go(r: Route)     // вкладки верхнего уровня сбрасывают стек, страницы (плейлист, исполнитель…) кладутся сверху
    fun back(): Boolean  // логин → плеер → стек → «Главная»
    var home, liked, playlists, …   // данные экранов: живут в модели, вкладки не грузятся заново
}
```

`NyaoRoot.kt` рисует экран по `when (r) { Route.Home -> HomeScreen(model, wide) … }`.
Это прямой аналог `RENDER` + `go()` на ПК.

Новый экран: класс в `Route` → ветка в `when` в `NyaoRoot` → (если нужно) индекс анимации и вкладка-родитель
там же → `model.go(Route.X)` из кнопки.

## Воспроизведение

```
UI ─► PlayerConnection.playList(list, start, label)
        └─ MediaController ─► PlaybackService (ExoPlayer)
                                 └─ MediaItem с uri nyao://ya/123
                                      └─ RoutingDataSource ─► Repo.resolve(uri) ─► настоящая ссылка
```

- Как на ПК: в плеере трек — это `nyao://<source>/<srcId>`, настоящая ссылка добывается в момент загрузки
  (`Repo.resolve`, блокирующий — зовётся в потоке загрузчика) и кэшируется. Протухла — `forgetStream()` и заново.
- MediaController передаёт сервису элементы без ссылок; сервис восстанавливает их по id (`Repo.mediaItemById`).
- SoundCloud и VK (временные ссылки на куски HLS) идут мимо дискового кэша; VK — с cookie сессии.
- Spotify: в плеере — тишина нужной длины (`SilenceDataSource`), звук играет Spotify, или подменяется копией из другого сервиса (`spx`).
- Ошибка загрузки → `PlaybackService.handleError` пробует новую ссылку / следующий трек.

Состояние для UI — `StateFlow` в `PlayerConnection` (`current`, очередь, позиция). Экраны подписываются через `collectAsState()`.

## Данные и сеть

`object Repo` — один на процесс (`Repo.init` в `NyaoApp`). Держит провайдеры, кэш треков по id, библиотеку,
делает поиск по всем сервисам параллельно (Spotify ждём не дольше 6 с) и отдаёт `StateFlow`.

Токены — в `Prefs` (приватные SharedPreferences приложения, на сервер не уходят).

Картинки: `NyaoApp` подменяет HTTP-клиент Coil на `ImageProxy.client` — если CDN не отвечает, тот сам
повторяет запрос через `/img` сервера Nyao. Поэтому в Compose достаточно обычного `AsyncImage(url)`.

## Сборка и версия

- Версия — из корневого `version.json` (`app/build.gradle.kts`): `versionCode = build`, `versionName = "0.8 (101) dev"`.
- Подпись release — только в CI (`NYAO_KEYSTORE_*`). Локально `assembleRelease` подпишется debug-ключом,
  и такой APK **не встанет поверх** официального.
- CI (`android.yml`): `./gradlew testReleaseUnitTest assembleRelease`, запускается от изменений в `android/**` (и `version.json`).
- Тесты: `app/src/test/…` — `WavePolicyTest`, `ServicesTest`, `LyricsWordsTest`, `LibraryCacheTest`. Локально: `./gradlew testDebugUnitTest`.

## Особенности Compose в проекте

- Тема Material 3 Expressive: формы и анимации — в `components/Expressive.kt`, `Motion.kt`, `theme/LookShapes.kt`.
- Акцентный цвет берётся с обложки (`AccentSync`) — как `accent.js` на ПК.
- Размеры аватаров и обложек фиксируйте `requiredSize`, а не `size`: в узком родителе `size` молча сжимается
  (так однажды «сплющился» аватар в профиле — глава 12).
- Тяжёлое (сеть, диск) — в `model.launch { … }` или `withContext(Dispatchers.IO)`, не в composable.
