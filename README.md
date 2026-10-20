<img width="1796" height="400" alt="Group 4330" src="https://github.com/user-attachments/assets/0870edb4-5f15-4dfb-bc8b-7d2d53ce5d61" />

<p align="center">
  <a href="https://github.com/PersikPrime/nyao-music/releases/latest"><img src="docs/download-macos.png" width="270" alt="Скачать для macOS"></a>
  <a href="https://github.com/PersikPrime/nyao-music/releases/latest"><img src="docs/download-windows.png" width="270" alt="Скачать для Windows"></a>
  <a href="https://github.com/PersikPrime/nyao-music/releases/latest"><img src="docs/download-android.png" width="270" alt="Скачать для Android"></a>
</p>


## Скриншоты:

<img width="1796" height="1122" alt="image" src="https://github.com/user-attachments/assets/091de441-8291-40b6-adf3-999c4de75a0f" />
<img width="1802" height="1123" alt="image" src="https://github.com/user-attachments/assets/0fc9dc47-a4b8-411f-bc14-dd51c9250c16" />

## Что это

Один плеер для **Яндекс Музыки, YouTube Music, SoundCloud и VK**: общие лайки и плейлисты, поиск сразу везде и «Моя волна», которая смешивает сервисы в нужной пропорции. Windows, macOS и Android.

- **Моя волна** — основа от Яндекса плюс треки из других сервисов; характер, настроение и баланс источников.
- **Радио по треку**, «продолжать похожим», правка очереди, тексты песен (Яндекс → LRCLIB → YouTube Music).
- **Между устройствами** — аккаунт Nyao: Nyao Connect (управление и «забрать сюда»), «Слушать вместе», итоги, синхронизация миксов и настроек.
- **Перенос плейлистов** между сервисами, Last.fm, офлайн на Android, полноэкранный режим с текстом на ПК.

Токены и cookies сервисов хранятся только на устройстве (на ПК — зашифрованы системой) и на сервер Nyao не отправляются.

## Обновления

Последняя версия — на странице [релизов](https://github.com/PersikPrime/nyao-music/releases/latest). Приложение само проверяет обновления: «Настройки» → «Центр обновлений» (на Android APK ставится поверх, входы сохраняются). Тестовые сборки выходят пререлизами `-dev`.

## Разработка

ПК (Electron, нужен Node.js 20+):

```bash
npm install
npm start          # запуск (npm run dev — с DevTools)
npm run dist       # установщик для Windows (dist:mac — .dmg)
npm run bump       # +1 к номеру сборки
```

Android (Kotlin + Jetpack Compose, JDK 17 и Android SDK 36):

```bash
cd android && ./gradlew assembleRelease
```

Версия «0.7 (45)» лежит в `version.json` и общая для всех платформ. Сборки для всех систем делает GitHub Actions при пуше; тему macOS на другой системе можно посмотреть так: `NYAO_THEME=mac npm start`.

```
src/main/        главный процесс: провайдеры сервисов, волна, поток аудио, тексты, аккаунт Nyao
src/renderer/    интерфейс без фреймворков (app.js — экраны, player.js — очередь)
android/         приложение для Android
server/          сервер аккаунта Nyao (Node.js + Postgres)
```

## Важно

Сервисы подключены через **неофициальные** API, после их обновлений что-то может сломаться. Для личного использования; без Яндекс Плюса полные треки могут не играть.

### Единая волна (nightly 0.8.72)

Все пять источников передают кандидатов общему алгоритму Nyao. В «Любимом» при максимальной свежести цель — 70% недавних лайков, 20% остальных любимых и 10% рекомендаций; при нехватке кандидатов доли перераспределяются. Свежесть — давность интереса, а не год выхода песни. Где API не отдаёт дату лайка, используется исходная позиция в списке и дата обнаружения нового добавления. Баланс источников — предпочтение, которое может уступать доступности, разнообразию и отсутствию дублей.

Дубликаты объединяются по ISRC или исполнителю, названию и близкой длительности. Названия версий live/remix сохраняются. Локально запоминаются «не нравится», ранние пропуски и дослушивания. Настроение пока передаётся только в рекомендации Яндекса; Spotify участвует через библиотеку и поиск, без зависимости от закрытого API рекомендаций.

Проверка подбора: `npm test`; Android: `cd android && ./gradlew testReleaseUnitTest`.
