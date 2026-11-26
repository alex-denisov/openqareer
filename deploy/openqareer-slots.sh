# shellcheck shell=bash
# Выкат без простоя (B705): два экземпляра openqareer-static@<порт>.service на
# 3210 и 3211. Caddy смотрит на один из них через сниппет UPSTREAM_FILE;
# новый релиз поднимается на свободном порту, проверяется по /health и только
# потом получает трафик. Подключается из openqareer-activate и
# openqareer-rollback; сам по себе ничего не делает.
#
# Переопределения через OPENQAREER_* нужны тестам. Скрипты запускает
# openqareer-deploy без sudo, поэтому подмена путей не даёт ему прав сверх
# своих: всё привилегированное идёт через sudo с точными аргументами.

readonly SLOT_PORTS=(3210 3211)
readonly LEGACY_SERVICE=openqareer-static.service
readonly UPSTREAM_FILE="${OPENQAREER_UPSTREAM_FILE:-/etc/caddy/openqareer-upstream.caddy}"
readonly UPSTREAM_HELPER=/usr/local/bin/openqareer-upstream
# Сервер под нагрузкой стартует 34-43 с и дольше (B701); окно считается по часам.
readonly HEALTH_WINDOW_SECONDS="${OPENQAREER_HEALTH_WINDOW_SECONDS:-180}"
# Запросы, принятые старым экземпляром до переключения (потоки консультанта),
# успевают закончиться, прежде чем он получит SIGTERM.
readonly DRAIN_SECONDS="${OPENQAREER_DRAIN_SECONDS:-20}"
# Тёплый резерв (B705-2): прежний экземпляр живёт ещё 10 минут вторым upstream
# Caddy, а openqareer-reserve@<новый порт> следит за новым. Релиз со сменой
# схемы базы кладёт в архив файл-маркер, и резерв не держится.
readonly NO_RESERVE_MARKER=no-warm-reserve

slot_service() {
  printf 'openqareer-static@%s.service' "$1"
}

# Порт, на который сейчас смотрит Caddy. Сниппета нет только на хосте до
# установки B705: там трафик держит прежний openqareer-static.service на 3210.
active_port() {
  local port=""
  if [[ -f "$UPSTREAM_FILE" ]]; then
    # Первый адрес строки to — основной; второй, если есть, — резерв.
    port="$(sed -nE 's/^[[:space:]]*to[[:space:]]+127\.0\.0\.1:(3210|3211)([[:space:]]+127\.0\.0\.1:(3210|3211))?[[:space:]]*$/\1/p' \
      "$UPSTREAM_FILE" | head -n 1)"
    [[ -n "$port" ]] || fail "upstream snippet has no known port: $UPSTREAM_FILE"
  else
    port=3210
  fi
  printf '%s' "$port"
}

other_port() {
  if [[ "$1" == "3210" ]]; then printf '3211'; else printf '3210'; fi
}

slot_health() {
  curl -fsS --max-time 3 "http://127.0.0.1:$1/health" 2>/dev/null | tr -d '\r\n' || true
}

wait_slot_health() {
  local -r port="$1" expected="$2"
  local -r deadline=$((SECONDS + HEALTH_WINDOW_SECONDS))
  while ((SECONDS < deadline)); do
    [[ "$(slot_health "$port")" == "$expected" ]] && return 0
    sleep 1
  done
  return 1
}

slot_is_active() {
  systemctl is-active --quiet "$(slot_service "$1")"
}

legacy_is_active() {
  systemctl is-active --quiet "$LEGACY_SERVICE"
}

stop_slot() {
  sudo -n /usr/bin/systemctl stop "$(slot_service "$1")" || true
}

# Запускает релиз (путь относительно RELEASE_ROOT) на порту и ждёт его SHA.
# Трафик при этом остаётся на прежнем экземпляре; при неудаче новый гасится.
start_slot() {
  local -r port="$1" target="$2" expected="$3"
  mkdir -p "$RELEASE_ROOT/slots"
  local -r slot_next="$RELEASE_ROOT/slots/.$port.next.$$"
  rm -f -- "$slot_next"
  ln -s "../$target" "$slot_next"
  mv -Tf "$slot_next" "$RELEASE_ROOT/slots/$port"
  if ! sudo -n /usr/bin/systemctl restart "$(slot_service "$port")"; then
    stop_slot "$port"
    return 1
  fi
  if ! wait_slot_health "$port" "$expected"; then
    stop_slot "$port"
    return 1
  fi
}

# switch_upstream <основной> [резерв]
switch_upstream() {
  sudo -n "$UPSTREAM_HELPER" "$@"
}

reserve_service() {
  printf 'openqareer-reserve@%s.service' "$1"
}

# Новый выкат или откат сам решает судьбу резерва: сторож прежнего окна
# останавливается до того, как скрипт что-либо меняет.
stop_reserve_watch() {
  local port
  for port in "${SLOT_PORTS[@]}"; do
    if systemctl is-active --quiet "$(reserve_service "$port")"; then
      sudo -n /usr/bin/systemctl stop "$(reserve_service "$port")" || true
    fi
  done
}

# Оставляет прежний экземпляр резервом: Caddy знает оба порта, сторож 10 минут
# смотрит за новым и гасит резерв сам, если новый не падал.
keep_reserve() {
  local -r new_port="$1" old_port="$2"
  sudo -n /usr/bin/systemctl enable "$(slot_service "$new_port")" ||
    printf 'warning: could not enable %s\n' "$(slot_service "$new_port")" >&2
  if legacy_is_active; then
    sudo -n /usr/bin/systemctl disable --now "$LEGACY_SERVICE" ||
      printf 'warning: could not stop %s\n' "$LEGACY_SERVICE" >&2
  fi
  sudo -n /usr/bin/systemctl restart "$(reserve_service "$new_port")"
}

# Гасит прежний экземпляр после переключения Caddy и закрепляет новый для
# загрузки хоста. Прежний сервис (до B705) выключается тем же шагом.
retire_slot() {
  local -r new_port="$1" old_port="$2"
  sudo -n /usr/bin/systemctl enable "$(slot_service "$new_port")" ||
    printf 'warning: could not enable %s\n' "$(slot_service "$new_port")" >&2
  sleep "$DRAIN_SECONDS"
  if slot_is_active "$old_port"; then
    stop_slot "$old_port"
  fi
  sudo -n /usr/bin/systemctl disable "$(slot_service "$old_port")" >/dev/null 2>&1 || true
  if legacy_is_active; then
    sudo -n /usr/bin/systemctl disable --now "$LEGACY_SERVICE" ||
      printf 'warning: could not stop %s\n' "$LEGACY_SERVICE" >&2
  fi
}
