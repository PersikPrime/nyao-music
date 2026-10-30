#!/usr/bin/env bash
# Кладёт файлы в релиз текущей сборки (тег v0.2.N из version.json). Если релиза ещё нет — создаёт.
# Использование: release-upload.sh файл1 [файл2 ...]   (нужен GH_TOKEN)
set -euo pipefail
N=$(jq -r '.name' version.json); B=$(jq -r '.build' version.json)
TAG="v$N.$B"
# dev-ветка (поле "channel": "dev" в version.json): отдельный пререлиз v0.5.27-dev — центр обновлений
# и зеркало на сервере его не видят (они берут только последний обычный релиз)
CHANNEL=$(jq -r '.channel // empty' version.json)
DISPLAY=$(jq -r '.displayVersion // empty' version.json)
PRE=""
if [ -n "$CHANNEL" ]; then TAG="v$N.$B-$CHANNEL"; PRE="--prerelease"; fi
TITLE="Nyao Music $N ($B)${CHANNEL:+ $CHANNEL}"
if [ -n "$DISPLAY" ]; then TITLE="Nyao Music $DISPLAY${CHANNEL:+ $CHANNEL}"; fi
NOTES_FILE=".github/notes/$TAG.md"
create() {
  # Если для сборки написаны заметки (.github/notes/v0.4.24.md) — они видны в центре обновлений
  if [ -f "$NOTES_FILE" ]; then
    gh release create "$TAG" --title "$TITLE" --notes-file "$NOTES_FILE" --target "$GITHUB_SHA" $PRE
  else
    gh release create "$TAG" --title "$TITLE" $PRE \
      --notes "Сборка $N ($B) из коммита ${GITHUB_SHA::7}: Android (APK), Windows (EXE), macOS (DMG)." \
      --target "$GITHUB_SHA"
  fi
}
# Несколько сборок могут прийти одновременно — если создать не вышло, значит релиз уже создал соседний job
gh release view "$TAG" > /dev/null 2>&1 || create || sleep 5
gh release upload "$TAG" "$@" --clobber
