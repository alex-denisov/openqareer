#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_USER=openqareer-deploy
readonly RELEASE_ROOT=/srv/openqareer
readonly LISTEN_ADDRESS=127.0.0.1:3210
readonly EXPECTED_PRIVATE_ADDRESS=172.31.41.215
readonly CADDYFILE=/etc/caddy/Caddyfile
readonly CADDY_KEY_URL=https://dl.cloudsmith.io/public/caddy/stable/gpg.key
readonly CADDY_REPOSITORY_URL=https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt
readonly CADDY_KEY_FINGERPRINT=65760C51EDEA2017CEA2CA15155B6D79CA56EA34
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PUBLIC_KEY_FILE="${1:-}"

candidate_file=""
authorized_keys_temp=""
caddy_key_temp=""
caddy_source_temp=""

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
    "$caddy_source_temp"; do
    [[ -z "$temporary_file" || ! -e "$temporary_file" ]] ||
      rm -f -- "$temporary_file"
  done
}
trap cleanup EXIT

wait_for_static_health() {
  local -r expected="$1"
  local attempt
  for attempt in $(seq 1 20); do
    if curl -fsS --max-time 3 "http://$LISTEN_ADDRESS/health" 2>/dev/null |
      grep -Fqx "$expected"; then
      return 0
    fi
    sleep 1
  done
  return 1
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

[[ "$(id -u)" == "0" ]] || fail "run with sudo/root"
for command_name in apt-get awk basename cat chmod chown cmp curl cut \
  dpkg-query flock getent grep id install ip ln mktemp readlink rm scp seq \
  sha256sum tar systemctl systemd-analyze touch tr useradd visudo; do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "missing command: $command_name"
done
ip -4 address show | grep -Fq "$EXPECTED_PRIVATE_ADDRESS/" ||
  fail "expected dedicated-host private address is absent"

install_caddy_package

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
  "$SCRIPT_DIR/openqareer-activate" /usr/local/bin/openqareer-activate
install -o root -g root -m 0755 \
  "$SCRIPT_DIR/openqareer-rollback" /usr/local/bin/openqareer-rollback
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/openqareer-static.service" \
  /etc/systemd/system/openqareer-static.service

authorized_keys_temp="$(mktemp "$RELEASE_ROOT/.ssh/.authorized_keys.XXXXXX")"
awk -v blob="$public_key_blob" '$2 != blob && $3 != blob { print }' \
  "$RELEASE_ROOT/.ssh/authorized_keys" > "$authorized_keys_temp"
printf '%s\n' "$authorized_key" >> "$authorized_keys_temp"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0600 \
  "$authorized_keys_temp" "$RELEASE_ROOT/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/.ssh"

cat > /etc/sudoers.d/openqareer-deploy <<'EOF'
openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart openqareer-static.service
EOF
chmod 0440 /etc/sudoers.d/openqareer-deploy
visudo -cf /etc/sudoers.d/openqareer-deploy >/dev/null

if [[ ! -L "$RELEASE_ROOT/current" ]]; then
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
    "$RELEASE_ROOT/releases/bootstrap"
  printf '<!doctype html><title>OpenQareer deployment bootstrap</title>\n' \
    > "$RELEASE_ROOT/releases/bootstrap/index.html"
  printf 'bootstrap\n' > "$RELEASE_ROOT/releases/bootstrap/health"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" \
    "$RELEASE_ROOT/releases/bootstrap"
  ln -s releases/bootstrap "$RELEASE_ROOT/current"
  chown -h "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/current"
fi

systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/openqareer-static.service
systemctl enable openqareer-static.service
systemctl restart openqareer-static.service
expected_health="$(basename "$(readlink "$RELEASE_ROOT/current")")"
wait_for_static_health "$expected_health" ||
  fail "static service health failed after restart"

install_caddy_configuration
systemctl is-active --quiet openqareer-static.service ||
  fail "static service is not active"
systemctl is-active --quiet caddy ||
  fail "Caddy is not active"

printf 'bootstrap=ok health=%s listen=%s caddy=%s\n' \
  "$expected_health" "$LISTEN_ADDRESS" "$(caddy version | awk '{print $1}')"
