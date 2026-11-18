#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_USER=openqareer-deploy
readonly RELEASE_ROOT=/srv/openqareer
readonly UPSTREAM_SNIPPET=/etc/caddy/openqareer-upstream.caddy
readonly SLOTS_LIB_DIR=/usr/local/lib/openqareer
# Адрес, по которому установщик узнаёт «свой» хост. AWS — прежний по умолчанию;
# новый хост передаёт свой: OPENQAREER_EXPECTED_ADDRESS=<адрес> bootstrap.sh … (B305).
readonly EXPECTED_PRIVATE_ADDRESS="${OPENQAREER_EXPECTED_ADDRESS:-172.31.41.215}"
readonly CADDYFILE=/etc/caddy/Caddyfile
readonly CADDY_KEY_URL=https://dl.cloudsmith.io/public/caddy/stable/gpg.key
readonly CADDY_REPOSITORY_URL=https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt
readonly CADDY_KEY_FINGERPRINT=65760C51EDEA2017CEA2CA15155B6D79CA56EA34
readonly NODE_VERSION=24.14.1
readonly NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
readonly NODE_ARCHIVE_SHA256=84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be
readonly NODE_ROOT=/opt/openqareer
readonly NODE_RUNTIME="$NODE_ROOT/node-v${NODE_VERSION}-linux-x64"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PUBLIC_KEY_FILE="${1:-}"

candidate_file=""
authorized_keys_temp=""
caddy_key_temp=""
caddy_source_temp=""
node_archive_temp=""

fail() {
  printf 'openqareer-bootstrap: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local temporary_file
  for temporary_file in \
    "$candidate_file" \
    "$authorized_keys_temp" \
    "$caddy_key_temp" \
    "$caddy_source_temp" \
    "$node_archive_temp"; do
    [[ -z "$temporary_file" || ! -e "$temporary_file" ]] ||
      rm -f -- "$temporary_file"
  done
}
trap cleanup EXIT

wait_for_application_health() {
  local -r expected="$1" port="$2"
  local attempt
  for attempt in $(seq 1 180); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/health" 2>/dev/null |
      grep -Fqx "$expected"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

install_node_runtime() {
  if [[ -x "$NODE_RUNTIME/bin/node" ]]; then
    [[ "$("$NODE_RUNTIME/bin/node" --version)" == "v$NODE_VERSION" ]] ||
      fail "installed Node.js runtime has an unexpected version"
    return 0
  fi

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils
  install -d -o root -g root -m 0755 "$NODE_ROOT"
  node_archive_temp="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -fsS --max-time 120 \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
    -o "$node_archive_temp"
  printf '%s  %s\n' "$NODE_ARCHIVE_SHA256" "$node_archive_temp" |
    sha256sum -c - >/dev/null
  tar -xJf "$node_archive_temp" -C "$NODE_ROOT" --no-same-owner
  chown -R root:root "$NODE_RUNTIME"
  [[ "$("$NODE_RUNTIME/bin/node" --version)" == "v$NODE_VERSION" ]] ||
    fail "Node.js runtime verification failed"
}

install_caddy_package() {
  local primary_fingerprint

  if dpkg-query -W -f='${Status}' caddy 2>/dev/null |
    grep -Fqx 'install ok installed'; then
    [[ "$(command -v caddy)" == "/usr/bin/caddy" ]] ||
      fail "installed Caddy binary has an unexpected path"
    return 0
  fi

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    apt-transport-https ca-certificates curl debian-archive-keyring \
    debian-keyring gnupg
  command -v gpg >/dev/null 2>&1 ||
    fail "gnupg installation did not provide gpg"

  caddy_key_temp="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -fsS --max-time 30 \
    "$CADDY_KEY_URL" -o "$caddy_key_temp"
  primary_fingerprint="$(
    gpg --show-keys --with-colons "$caddy_key_temp" 2>/dev/null |
      awk -F: '$1 == "fpr" { print $10; exit }'
  )"
  [[ "$primary_fingerprint" == "$CADDY_KEY_FINGERPRINT" ]] ||
    fail "Caddy repository signing-key fingerprint mismatch"
  gpg --batch --yes --dearmor \
    --output /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    "$caddy_key_temp"
  chmod 0644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg

  caddy_source_temp="$(mktemp)"
  curl --proto '=https' --tlsv1.2 -fsS --max-time 30 \
    "$CADDY_REPOSITORY_URL" -o "$caddy_source_temp"
  grep -Fq 'signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg' \
    "$caddy_source_temp" ||
    fail "Caddy repository definition does not pin the expected keyring"
  install -o root -g root -m 0644 \
    "$caddy_source_temp" /etc/apt/sources.list.d/caddy-stable.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends caddy
  [[ "$(command -v caddy)" == "/usr/bin/caddy" ]] ||
    fail "Caddy installation did not provide /usr/bin/caddy"
}

install_caddy_configuration() {
  local backup_dir
  local backup_file

  candidate_file="$(mktemp)"
  install -o root -g root -m 0644 \
    "$SCRIPT_DIR/Caddyfile.openqareer" "$candidate_file"
  caddy validate --config "$candidate_file" --adapter caddyfile

  if cmp -s "$candidate_file" "$CADDYFILE"; then
    systemctl enable --now caddy
    return 0
  fi

  backup_dir=/var/backups/openqareer/caddy
  install -d -o root -g root -m 0700 "$backup_dir"
  backup_file="$backup_dir/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -f "$CADDYFILE" ]]; then
    install -o root -g root -m 0600 "$CADDYFILE" "$backup_file"
  else
    printf 'absent\n' > "$backup_file.absent"
    chmod 0600 "$backup_file.absent"
  fi

  install -o root -g root -m 0644 "$candidate_file" "$CADDYFILE"
  if ! systemctl enable --now caddy; then
    if [[ -f "$backup_file" ]]; then
      install -o root -g root -m 0644 "$backup_file" "$CADDYFILE"
      systemctl restart caddy || true
    fi
    fail "Caddy failed to start; prior configuration restored when available"
  fi

  if ! caddy validate --config "$CADDYFILE" --adapter caddyfile; then
    if [[ -f "$backup_file" ]]; then
      install -o root -g root -m 0644 "$backup_file" "$CADDYFILE"
      systemctl reload caddy || true
    fi
    fail "installed Caddy configuration failed validation"
  fi
  systemctl reload caddy
}

# B705: the port Caddy points at. Without a snippet the pre-B705 single
# service owns 3210, so the snippet starts there and nothing moves.
ensure_upstream_snippet() {
  [[ -f "$UPSTREAM_SNIPPET" ]] && return 0
  install -d -o root -g root -m 0755 "$(dirname "$UPSTREAM_SNIPPET")"
  printf 'to 127.0.0.1:3210\n' > "$UPSTREAM_SNIPPET"
  chmod 0644 "$UPSTREAM_SNIPPET"
}

live_port() {
  sed -nE 's/^[[:space:]]*to[[:space:]]+127\.0\.0\.1:(3210|3211)([[:space:]]+127\.0\.0\.1:(3210|3211))?[[:space:]]*$/\1/p' \
    "$UPSTREAM_SNIPPET" | head -n 1
}

install_sudoers() {
  local sudoers_temp port
  sudoers_temp="$(mktemp)"
  {
    printf '%s\n' \
      'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart openqareer-static.service' \
      'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl disable --now openqareer-static.service' \
      'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart openqareer-maintenance.service' \
      'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart openqareer-vacancy-mechanics.service'
    for port in 3210 3211; do
      printf 'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl %s openqareer-static@%s.service\n' \
        restart "$port" stop "$port" enable "$port" disable "$port"
      printf 'openqareer-deploy ALL=(root) NOPASSWD: /usr/local/bin/openqareer-upstream %s\n' "$port"
      # B705-2: тёплый резерв — сторож окна и Caddy с двумя портами.
      printf 'openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl %s openqareer-reserve@%s.service\n' \
        restart "$port" stop "$port"
    done
    printf 'openqareer-deploy ALL=(root) NOPASSWD: /usr/local/bin/openqareer-upstream %s\n' \
      '3210 3211' '3211 3210'
  } > "$sudoers_temp"
  # Проверка до установки: битый файл в sudoers.d не должен попасть на хост.
  visudo -cf "$sudoers_temp" >/dev/null || fail "generated sudoers rules do not parse"
  if ! cmp -s "$sudoers_temp" /etc/sudoers.d/openqareer-deploy; then
    install -o root -g root -m 0440 "$sudoers_temp" /etc/sudoers.d/openqareer-deploy
  fi
  rm -f -- "$sudoers_temp"
}

install_zero_downtime_files() {
  install -d -o root -g root -m 0755 "$SLOTS_LIB_DIR"
  install -o root -g root -m 0644 \
    "$SCRIPT_DIR/openqareer-slots.sh" "$SLOTS_LIB_DIR/openqareer-slots.sh"
  install -o root -g root -m 0755 \
    "$SCRIPT_DIR/openqareer-upstream" /usr/local/bin/openqareer-upstream
  install -o root -g root -m 0755 \
    "$SCRIPT_DIR/openqareer-activate" /usr/local/bin/openqareer-activate
  install -o root -g root -m 0755 \
    "$SCRIPT_DIR/openqareer-rollback" /usr/local/bin/openqareer-rollback
  install -o root -g root -m 0644 \
    "$SCRIPT_DIR/openqareer-static@.service" \
    "/etc/systemd/system/openqareer-static@.service"
  install -o root -g root -m 0755 \
    "$SCRIPT_DIR/openqareer-reserve-watch" /usr/local/bin/openqareer-reserve-watch
  install -o root -g root -m 0644 \
    "$SCRIPT_DIR/openqareer-reserve@.service" \
    "/etc/systemd/system/openqareer-reserve@.service"
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 "$RELEASE_ROOT/slots"
  systemctl daemon-reload
  systemd-analyze verify "/etc/systemd/system/openqareer-static@3210.service"
  systemd-analyze verify "/etc/systemd/system/openqareer-reserve@3210.service"
}

[[ "$(id -u)" == "0" ]] || fail "run with sudo/root"

# B705: switch a running host to zero-downtime deploys without restarting the
# application. The next deploy starts the template instance on 3211 and stops
# the old single service; repeat runs change nothing.
if [[ "$PUBLIC_KEY_FILE" == "--zero-downtime" ]]; then
  install_zero_downtime_files
  install_sudoers
  ensure_upstream_snippet
  install_caddy_configuration
  printf 'openqareer-bootstrap: zero-downtime deploy installed; live port %s\n' "$(live_port)"
  exit 0
fi

# Only the proxy configuration: validate, back up, install, reload. No service
# restarts, units or keys — for a Caddyfile change on a running host (02.11).
if [[ "$PUBLIC_KEY_FILE" == "--caddy-only" ]]; then
  ensure_upstream_snippet
  install_caddy_configuration
  exit 0
fi
# B649-6: only the three units. Installs a unit whose file differs, reloads,
# verifies and restarts just the changed ones; a repeat run changes nothing.
install_units_only() {
  local unit changed=()
  for unit in openqareer-maintenance.service openqareer-vacancy-mechanics.service; do
    if ! cmp -s "$SCRIPT_DIR/$unit" "/etc/systemd/system/$unit"; then
      install -o root -g root -m 0644 "$SCRIPT_DIR/$unit" "/etc/systemd/system/$unit"
      changed+=("$unit")
    fi
  done
  # The template has no instance to restart: the next deploy starts one.
  if ! cmp -s "$SCRIPT_DIR/openqareer-static@.service" \
    "/etc/systemd/system/openqareer-static@.service"; then
    install -o root -g root -m 0644 "$SCRIPT_DIR/openqareer-static@.service" \
      "/etc/systemd/system/openqareer-static@.service"
    systemctl daemon-reload
    systemd-analyze verify "/etc/systemd/system/openqareer-static@3210.service"
    printf 'openqareer-bootstrap: installed openqareer-static@.service\n'
  fi
  if [[ "${#changed[@]}" -eq 0 ]]; then
    printf 'openqareer-bootstrap: units unchanged\n'
    return 0
  fi
  systemctl daemon-reload
  for unit in "${changed[@]}"; do
    systemd-analyze verify "/etc/systemd/system/$unit"
    systemctl restart "$unit"
    printf 'openqareer-bootstrap: restarted %s\n' "$unit"
  done
}

if [[ "$PUBLIC_KEY_FILE" == "--units-only" ]]; then
  install_units_only
  exit 0
fi
for command_name in apt-get awk basename cat chmod chown cmp curl cut \
  dpkg-query flock getent grep id install ip ln mktemp readlink rm scp seq \
  sha256sum tar systemctl systemd-analyze touch tr useradd visudo; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "missing command: $command_name"
done
ip -4 address show | grep -Fq "$EXPECTED_PRIVATE_ADDRESS/" ||
  fail "expected dedicated-host private address is absent"

install_caddy_package
install_node_runtime

[[ ! -L "$RELEASE_ROOT" ]] ||
  fail "$RELEASE_ROOT must not be a symbolic link"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$RELEASE_ROOT" \
    --shell /bin/bash "$DEPLOY_USER"
else
  deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  [[ "$deploy_home" == "$RELEASE_ROOT" ]] ||
    fail "existing deploy user has unexpected home: $deploy_home"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  "$RELEASE_ROOT" "$RELEASE_ROOT/releases" "$RELEASE_ROOT/incoming"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 \
  /var/lib/openqareer
# B334/B576: desktop installers served by /downloads/openqareer-{macos.dmg,windows.exe};
# they live beside the database so the unit's ReadWritePaths already covers them.
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  /var/lib/openqareer/downloads
# B359/B576: signed updater feed served by /desktop/*; written by openqareer-desktop-publish.
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  /var/lib/openqareer/desktop
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 \
  "$RELEASE_ROOT/.ssh"

[[ -n "$PUBLIC_KEY_FILE" && -f "$PUBLIC_KEY_FILE" ]] ||
  fail "usage: bootstrap.sh /absolute/path/to/openqareer-ci-public-key"
public_key="$(tr -d '\r\n' < "$PUBLIC_KEY_FILE")"
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+\ openqareer-github-deploy$ ]] ||
  fail "OpenQareer CI public key has an unexpected format"
public_key_blob="$(awk '{print $2}' "$PUBLIC_KEY_FILE")"
authorized_key="restrict,command=\"/usr/local/bin/openqareer-ci-command\" $public_key"
touch "$RELEASE_ROOT/.ssh/authorized_keys"

install -o root -g root -m 0755 \
  "$SCRIPT_DIR/openqareer-ci-command" /usr/local/bin/openqareer-ci-command
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/openqareer-desktop-publish" /usr/local/bin/openqareer-desktop-publish
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/openqareer-env-set" /usr/local/bin/openqareer-env-set
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/openqareer-browser-install" /usr/local/bin/openqareer-browser-install
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/openqareer-maintenance.service" \
  /etc/systemd/system/openqareer-maintenance.service
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/openqareer-vacancy-mechanics.service" \
  /etc/systemd/system/openqareer-vacancy-mechanics.service

authorized_keys_temp="$(mktemp "$RELEASE_ROOT/.ssh/.authorized_keys.XXXXXX")"
awk -v blob="$public_key_blob" '$2 != blob && $3 != blob { print }' \
  "$RELEASE_ROOT/.ssh/authorized_keys" > "$authorized_keys_temp"
printf '%s\n' "$authorized_key" >> "$authorized_keys_temp"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0600 \
  "$authorized_keys_temp" "$RELEASE_ROOT/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/.ssh"

install_sudoers

[[ -L "$RELEASE_ROOT/current" ]] ||
  fail "an immutable application release must be staged before migration"
[[ -f "$RELEASE_ROOT/current/server.mjs" ]] ||
  fail "current release does not contain server.mjs"
[[ -f /etc/openqareer/openqareer.env ]] ||
  fail "/etc/openqareer/openqareer.env must be installed before migration"

/usr/local/bin/openqareer-browser-install

install_zero_downtime_files
ensure_upstream_snippet
systemd-analyze verify /etc/systemd/system/openqareer-maintenance.service
systemd-analyze verify /etc/systemd/system/openqareer-vacancy-mechanics.service
systemctl enable openqareer-maintenance.service
systemctl enable openqareer-vacancy-mechanics.service
# B705: the instance on the port Caddy points at runs the current release;
# the pre-B705 single service gives the port up first.
listen_port="$(live_port)"
[[ -n "$listen_port" ]] || fail "upstream snippet has no known port"
ln -sfn "../$(readlink "$RELEASE_ROOT/current")" "$RELEASE_ROOT/slots/$listen_port"
chown -h "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/slots/$listen_port"
systemctl disable --now openqareer-static.service 2>/dev/null || true
systemctl enable "openqareer-static@$listen_port.service"
systemctl restart "openqareer-static@$listen_port.service"
expected_health="$(basename "$(readlink "$RELEASE_ROOT/current")")"
wait_for_application_health "$expected_health" "$listen_port" ||
  fail "application service health failed after restart"
systemctl restart openqareer-maintenance.service
systemctl restart openqareer-vacancy-mechanics.service

install_caddy_configuration
systemctl is-active --quiet "openqareer-static@$listen_port.service" ||
  fail "application service is not active"
systemctl is-active --quiet caddy ||
  fail "Caddy is not active"

printf 'bootstrap=ok health=%s listen=%s caddy=%s\n' \
  "$expected_health" "127.0.0.1:$listen_port" "$(caddy version | awk '{print $1}')"
