# 9. iOS

`ios/` — SwiftUI, AVPlayer, iOS 17+, iPhone и iPad. Самая молодая платформа: ~3800 строк, часть функций
ПК и Android ещё не перенесена. Без App Store — ставится через **SideStore** (или любой другой подписыватель IPA).

## Сборка

Проект описан в `ios/project.yml` (XcodeGen); `.xcodeproj` в git нет.

```bash
brew install xcodegen
cd ios && xcodegen generate && open NyaoMusic.xcodeproj
```

- Подпись выключена (`CODE_SIGNING_ALLOWED: NO`): CI собирает **неподписанный** IPA, подписывает уже устройство (SideStore своим Apple ID).
- Bundle id `app.withnyao.music`. Версию CI подставляет из `version.json` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`) — в `project.yml` числа только для локальной сборки.
- `Info.plist` генерирует XcodeGen из раздела `info:` в `project.yml` — правьте там, а не сам plist
  (например, фоновое аудио `UIBackgroundModes: [audio]`).

### CI: `.github/workflows/ios.yml`

Запускается от изменений в `ios/**` и `version.json`, на `macos-15`:

1. `xcodegen generate` → `xcodebuild … build` без подписи. Ошибки компиляции выводятся аннотациями `::error::` (видны прямо на странице запуска).
2. `.app` упаковывается в `Payload/` → `NyaoMusic-<версия>-<сборка>.ipa`.
3. Генерируется `sidestore.json` — источник для SideStore/AltStore (имя, иконка, версия, ссылка на IPA).
4. Оба файла прикладываются к релизу (`release-upload.sh`).

Источник для SideStore: `https://github.com/PersikPrime/nyao-music/releases/latest/download/sidestore.json`.
Бесплатный Apple ID: подпись живёт 7 дней, SideStore продлевает её сам.

> Swift в CI строже, чем кажется: «variable captured by a closure before being initialized» в `init` — частая
> ошибка (используйте статические константы вместо свойств `self`). Проверяйте лог сборки, а не только зелёную галочку:
> CI проверяет, что в `.app` есть бинарник.

## Карта

```
NyaoMusic/
  Core/
    Models.swift     Track, Playlist, Source — тот же формат, что на ПК и Android
    Net.swift        общий HTTP: JSON, ошибки ApiError, таймауты
    Repo.swift       @MainActor final class Repo: ObservableObject — сервисы, библиотека, поиск, волна, ссылки на звук
    Store.swift      Keychain (токены — только на устройстве) + UserDefaults (настройки)
  Services/
    YandexAPI.swift  VkAPI.swift  ScAPI.swift     провайдеры (переносы YandexApi.kt / VkApi.kt / ScApi.kt)
    LyricsAPI.swift  тексты: Яндекс → LyricLabs → LRCLIB
    NyaoCloud.swift  сервер Nyao: вход через Telegram, история, «сейчас играет», друзья
  Player/
    Player.swift     final class Player: ObservableObject — очередь, AVPlayer, режимы list/wave/radio,
                     Now Playing и пульт на экране блокировки (MPRemoteCommandCenter)
  Views/
    Root.swift       @main App, вкладки (Tab), маршруты (Route), PhoneLayout / PadLayout, мини-плеер, приветствие
    Screens.swift    Главная, Волна, Медиатека, Поиск, Настройки
    NowPlaying.swift полноэкранный плеер, текст песни
    Social.swift     друзья и профили
    LoginView.swift  входы в сервисы (WKWebView) и в аккаунт Nyao
    Theme.swift      цвета и стили; Hundred.swift — пасхалка сотой сборки
```

## Как устроено

- **Состояние** — два `ObservableObject`: `Repo` и `Player`, переданы во view через `@EnvironmentObject`.
- **Навигация** — `TabView` по `Tab` + `NavigationStack` с `Route` внутри вкладки; на iPad — `NavigationSplitView` с боковой панелью (`PadLayout`).
- **Звук**: `Player.load()` просит у `Repo.streamURL(track)` прямую ссылку и отдаёт её `AVPlayer`
  (HLS SoundCloud и VK AVPlayer понимает сам, без своего прокси). Ссылка перестала работать → `forgetStream` и следующая попытка.
- **Сервисы**: Яндекс, VK, SoundCloud. YouTube Music и Spotify **пока не играют** (`streamURL` бросает «скоро»).
- **Волна** — упрощённая: `Repo.waveStart/waveMore` чередует «Мою волну» Яндекса (с настроением и характером)
  и `wavePool` VK/SC. **Полного `WaveMixer`/`WavePolicy` здесь нет** — это главный кандидат на перенос.

## Чего ещё нет по сравнению с ПК и Android

- Полноценная волна (квоты, свежесть, баланс, вкус, своя волна Nyao).
- YouTube Music и Spotify.
- Nyao Connect, «Слушать вместе», итоги, миксы, перенос плейлистов.
- Прокси картинок `/img` (обложки VK и аватарки Telegram без VPN могут не грузиться).
- Офлайн-кэш, эквалайзер, виджеты.

Переносите с Android: Kotlin ближе к Swift, чем JS, и структура `data/` ≈ `Core/` + `Services/`.
