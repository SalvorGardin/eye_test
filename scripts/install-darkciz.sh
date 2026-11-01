#!/usr/bin/env bash
# Run from the unpacked deployment directory, containing site/.
set -euo pipefail
[[ $EUID = 0 ]] || { echo 'Запустите через sudo.' >&2; exit 1; }
cd -- "$(dirname -- "$0")"
test -f site/index.html
test -f site/models/face_landmarker.task
test -f site/models/hand_landmarker.task
if [[ -e /var/www/eye-test || -L /var/www/eye-test ]]; then
  echo '/var/www/eye-test уже существует; установка остановлена без изменений.' >&2
  exit 1
fi
if find site ! -type f ! -type d -print -quit | grep -q .; then
  echo 'В сборке обнаружены ссылки или специальные файлы.' >&2; exit 1
fi
backup=$(mktemp -d /etc/caddy/eye-test-backup-XXXXXXXX)
cp -p /etc/caddy/Caddyfile "$backup/Caddyfile"
python3 - "$backup/Caddyfile" "$backup/Caddyfile.next" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
old = '''darkciz.ru {
    reverse_proxy 127.0.0.1:8765 {
        flush_interval -1
    }
}'''
new = '''darkciz.ru {
    redir /eye-test /eye-test/ 308

    handle_path /eye-test/* {
        root * /var/www/eye-test
        file_server
    }

    handle {
        reverse_proxy 127.0.0.1:8765 {
            flush_interval -1
        }
    }
}'''
if text.count(old) != 1:
    raise SystemExit('Конфигурация сайта изменилась. Нужна повторная проверка; файл не изменён.')
Path(sys.argv[2]).write_text(text.replace(old, new))
PY
caddy validate --config "$backup/Caddyfile.next" --adapter caddyfile
install -d -m 755 /var/www/eye-test
cp -R site/. /var/www/eye-test/
chown -R root:root /var/www/eye-test
find /var/www/eye-test -type d -exec chmod 755 {} +
find /var/www/eye-test -type f -exec chmod 644 {} +
install -m 644 "$backup/Caddyfile.next" /etc/caddy/Caddyfile
if ! systemctl reload-or-restart caddy; then
  cp -p "$backup/Caddyfile" /etc/caddy/Caddyfile
  echo "Caddy не запущен. Прежняя конфигурация восстановлена из $backup." >&2
  echo 'Проверьте: sudo journalctl -u caddy -n 80 --no-pager' >&2
  exit 1
fi
echo "Установка завершена. Резервная копия конфигурации: $backup"
echo 'Проверьте https://darkciz.ru/ и https://darkciz.ru/eye-test/'
