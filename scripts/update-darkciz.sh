#!/usr/bin/env bash
# Frontend-only update: keep existing models, configuration and previous assets.
set -euo pipefail
[[ $EUID = 0 ]] || { echo 'Запустите через sudo.' >&2; exit 1; }
cd -- "$(dirname -- "$0")"
target=/var/www/eye-test
test -f "$target/index.html"
test -f site/index.html
if find site ! -type f ! -type d -print -quit | grep -q .; then
  echo 'Ссылки или специальные файлы в сборке запрещены.' >&2; exit 1
fi
diff -qr --exclude='._*' site/models "$target/models"
diff -qr --exclude='._*' site/wasm "$target/wasm"
for file in site/assets/*; do
  name=$(basename "$file")
  if [[ -e "$target/assets/$name" ]]; then
    cmp "$file" "$target/assets/$name"
  fi
done
backup=$(mktemp -d /var/backups/eye-test-XXXXXXXX)
cp -p "$target/index.html" "$backup/index.html"
for file in site/assets/*; do
  name=$(basename "$file")
  if [[ ! -e "$target/assets/$name" ]]; then
    install -m 644 "$file" "$target/assets/$name"
  fi
done
next=$(mktemp "$target/.index-XXXXXXXX")
trap 'rm -f -- "$next"' EXIT
install -m 644 site/index.html "$next"
mv -f -- "$next" "$target/index.html"
echo "Обновление установлено. Прежний index.html: $backup/index.html"
echo 'https://darkciz.ru/eye-test/'
