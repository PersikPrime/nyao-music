# Прежняя иконка Nyao Music (три волны)

Резервная копия до временной иконки с котом (до обновления 0.10). Вернуть:

```sh
cp build/icon-backup/icon.png build/icon-backup/icon-mac.png build/icon-backup/android-foreground.png build/
cp build/icon-backup/discord-logo.png build/discord/logo.png
cp build/icon-backup/android/ic_launcher.xml build/icon-backup/android/ic_launcher_round.xml android/app/src/main/res/mipmap-anydpi-v26/
rm android/app/src/main/res/drawable-nodpi/ic_launcher_art.png
```

`ic_launcher_foreground.xml` (вектор волн) и цвет фона `#13111C` в коде не трогались — они остались на месте.
Фон временной иконки — `@color/ic_launcher_background_art` в `values/colors.xml`, его можно удалить.
