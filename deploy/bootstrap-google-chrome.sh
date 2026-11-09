#!/usr/bin/env bash
# B626: Google Chrome stable и свой дисплей Xvfb для пула LinkedIn.
#
# Cloudflare на linkedin.com/login отдаёт 403 встроенному Chromium Playwright,
# а Google Chrome в окне проходит (прод 09.11). Скрипт идемпотентный:
#  1. репозиторий Google и пакет google-chrome-stable, проверка версии;
#  2. openqareer-xvfb.service — Xvfb :99 от пользователя сервиса;
#  3. drop-in обслуживания: DISPLAY=:99, AF_UNIX для соединения с X
#     (абстрактный сокет виден и при PrivateTmp), запуск после Xvfb.
# Повторный запуск без изменений ничего не перезапускает.
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }

readonly KEYRING=/usr/share/keyrings/google-chrome.gpg
readonly SOURCE_LIST=/etc/apt/sources.list.d/google-chrome.list
readonly XVFB_UNIT=/etc/systemd/system/openqareer-xvfb.service
readonly DROPIN_DIR=/etc/systemd/system/openqareer-maintenance.service.d
readonly DROPIN="$DROPIN_DIR/b626-google-chrome.conf"
readonly CHROME_BIN=/opt/google/chrome/chrome
readonly SERVICE_USER=openqareer-deploy
readonly TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

changed_units=0

install_if_changed() {
  local -r candidate="$1" target="$2" mode="$3"
  if ! cmp -s "$candidate" "$target" 2>/dev/null; then
    install -o root -g root -m "$mode" "$candidate" "$target"
    return 0
  fi
  return 1
}

# 1. Репозиторий и пакет.
if [[ ! -s "$KEYRING" ]]; then
  curl --fail --location --silent --show-error https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor > "$TEMP_DIR/google-chrome.gpg"
  install -o root -g root -m 0644 "$TEMP_DIR/google-chrome.gpg" "$KEYRING"
fi
printf 'deb [arch=amd64 signed-by=%s] https://dl.google.com/linux/chrome/deb/ stable main\n' \
  "$KEYRING" > "$TEMP_DIR/google-chrome.list"
if install_if_changed "$TEMP_DIR/google-chrome.list" "$SOURCE_LIST" 0644 || [[ ! -x "$CHROME_BIN" ]]; then
  apt-get update
fi
if [[ ! -x "$CHROME_BIN" ]]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends google-chrome-stable
fi
# Пакет Google кладёт свой список; второй источник дал бы предупреждение apt о дубле.
rm -f /etc/apt/sources.list.d/google-chrome.sources
command -v xvfb-run >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y xvfb

chrome_version="$("$CHROME_BIN" --version)"
[[ "$chrome_version" =~ ^Google\ Chrome\ [0-9]+\. ]] || {
  printf 'unexpected chrome version output: %s\n' "$chrome_version" >&2
  exit 1
}

# 2. Дисплей.
cat > "$TEMP_DIR/xvfb.service" <<UNIT
[Unit]
Description=OpenQareer Xvfb display :99 for Google Chrome (B626)
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=/usr/bin/Xvfb :99 -screen 0 1440x900x24 -nolisten tcp
Restart=always
RestartSec=5s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
install_if_changed "$TEMP_DIR/xvfb.service" "$XVFB_UNIT" 0644 && changed_units=1

# 3. Обслуживание видит дисплей.
install -d -o root -g root -m 0755 "$DROPIN_DIR"
cat > "$TEMP_DIR/dropin.conf" <<'CONF'
[Unit]
Wants=openqareer-xvfb.service
After=openqareer-xvfb.service

[Service]
Environment=DISPLAY=:99
Environment=OPENQAREER_LINKEDIN_CHROME_PATH=/opt/google/chrome/chrome
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CONF
install_if_changed "$TEMP_DIR/dropin.conf" "$DROPIN" 0644 && changed_units=1

if [[ "$changed_units" -eq 1 ]]; then
  systemctl daemon-reload
fi
systemctl enable --now openqareer-xvfb.service >/dev/null
systemctl is-active --quiet openqareer-xvfb.service || {
  printf 'openqareer-xvfb.service is not active\n' >&2
  exit 1
}

printf 'bootstrap-google-chrome: %s, Xvfb :99 active, units changed=%s\n' \
  "$chrome_version" "$changed_units"
printf 'maintenance picks the display up on its next restart (deploy restarts it)\n'
