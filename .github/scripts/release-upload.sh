#!/usr/bin/env bash
# Кладёт файлы в релиз текущей сборки (тег v0.2.N из version.json). Если релиза ещё нет — создаёт.
# Использование: release-upload.sh файл1 [файл2 ...]   (нужен GH_TOKEN)
set -euo pipefail
N=$(jq -r '.name' version.json); B=$(jq -r '.build' version.json)
TAG="v$N.$B"
create() {
  gh release create "$TAG" --title "Nyao Music $N ($B)" \
    --notes "Сборка $N ($B) из коммита ${GITHUB_SHA::7}: Android (APK), Windows (EXE), macOS (DMG)." \
    --target "$GITHUB_SHA"
}
# Несколько сборок могут прийти одновременно — если создать не вышло, значит релиз уже создал соседний job
gh release view "$TAG" > /dev/null 2>&1 || create || sleep 5
gh release upload "$TAG" "$@" --clobber
