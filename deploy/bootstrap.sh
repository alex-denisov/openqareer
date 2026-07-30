#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEPLOY_USER=openqareer-deploy
readonly RELEASE_ROOT=/srv/openqareer
readonly LISTEN_ADDRESS=172.31.34.140:3210
readonly CADDY_CONTAINER=eterapy-caddy-1
readonly CADDYFILE=/opt/eterapy/Caddyfile
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PUBLIC_KEY_FILE="${1:-}"
candidate_file=""
authorized_keys_temp=""

fail() {
  printf 'openqareer-bootstrap: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  [[ -z "$candidate_file" ]] || rm -f -- "$candidate_file"
  [[ -z "$authorized_keys_temp" ]] || rm -f -- "$authorized_keys_temp"
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

[[ "$(id -u)" == "0" ]] || fail "run with sudo/root"
for command in awk cmp docker curl busybox flock mktemp scp sha256sum tar \
  systemctl systemd-analyze visudo; do
  command -v "$command" >/dev/null 2>&1 || fail "missing command: $command"
done
ip -4 address show | grep -Fq '172.31.34.140/' ||
  fail "expected AWS private address is absent"
docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1 ||
  fail "eTerapy Caddy container is absent"
[[ -f "$CADDYFILE" ]] || fail "eTerapy Caddyfile is absent"

pre_health="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://eterapy.com/api/health)"
[[ "$pre_health" == "200" ]] || fail "eTerapy preflight health is $pre_health"

[[ ! -L "$RELEASE_ROOT" ]] || fail "$RELEASE_ROOT must not be a symbolic link"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$RELEASE_ROOT" --shell /bin/bash "$DEPLOY_USER"
else
  deploy_home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  [[ "$deploy_home" == "$RELEASE_ROOT" ]] ||
    fail "existing deploy user has unexpected home: $deploy_home"
fi

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 \
  "$RELEASE_ROOT" "$RELEASE_ROOT/releases" "$RELEASE_ROOT/incoming"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$RELEASE_ROOT/.ssh"

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
  "$SCRIPT_DIR/openqareer-httpd.conf" /etc/openqareer-httpd.conf
install -o root -g root -m 0644 \
  "$SCRIPT_DIR/openqareer-static.service" /etc/systemd/system/openqareer-static.service

authorized_keys_temp="$(mktemp "$RELEASE_ROOT/.ssh/.authorized_keys.XXXXXX")"
awk -v blob="$public_key_blob" '$2 != blob && $3 != blob { print }' \
  "$RELEASE_ROOT/.ssh/authorized_keys" > "$authorized_keys_temp"
printf '%s\n' "$authorized_key" >> "$authorized_keys_temp"
install -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0600 \
  "$authorized_keys_temp" "$RELEASE_ROOT/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/.ssh"

printf 'OPENQAREER_LISTEN=%s\n' "$LISTEN_ADDRESS" > /etc/openqareer-static.env
chmod 0644 /etc/openqareer-static.env

cat > /etc/sudoers.d/openqareer-deploy <<'EOF'
openqareer-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart openqareer-static.service
EOF
chmod 0440 /etc/sudoers.d/openqareer-deploy
visudo -cf /etc/sudoers.d/openqareer-deploy >/dev/null

if [[ ! -L "$RELEASE_ROOT/current" ]]; then
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0755 "$RELEASE_ROOT/releases/bootstrap"
  printf '<!doctype html><title>OpenQareer deployment bootstrap</title>\n' \
    > "$RELEASE_ROOT/releases/bootstrap/index.html"
  printf 'bootstrap\n' > "$RELEASE_ROOT/releases/bootstrap/health"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$RELEASE_ROOT/releases/bootstrap"
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
docker exec "$CADDY_CONTAINER" wget -qO- "http://$LISTEN_ADDRESS/health" |
  grep -Fqx "$expected_health"

begin_count="$(grep -Fc '# BEGIN OPENQAREER' "$CADDYFILE" || true)"
end_count="$(grep -Fc '# END OPENQAREER' "$CADDYFILE" || true)"
[[ "$begin_count" == "$end_count" ]] ||
  fail "Caddyfile has an incomplete OpenQareer managed block"
[[ "$begin_count" == "0" || "$begin_count" == "1" ]] ||
  fail "Caddyfile has duplicate OpenQareer managed blocks"

candidate_file="$(mktemp /opt/eterapy/.Caddyfile.openqareer.XXXXXX)"
awk '
  /^# BEGIN OPENQAREER/ { managed = 1; next }
  /^# END OPENQAREER/ { managed = 0; next }
  managed != 1 { print }
' "$CADDYFILE" > "$candidate_file"
cat "$SCRIPT_DIR/Caddyfile.openqareer" >> "$candidate_file"

if ! cmp -s "$candidate_file" "$CADDYFILE"; then
  backup_dir=/opt/eterapy/backups/caddy
  install -d -m 0700 "$backup_dir"
  backup_file="$backup_dir/Caddyfile.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$CADDYFILE" "$backup_file"
  cp "$candidate_file" "$CADDYFILE"
  if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile; then
    cp "$backup_file" "$CADDYFILE"
    fail "Caddy validation failed; original restored"
  fi
  if ! docker exec "$CADDY_CONTAINER" \
    caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    cp "$backup_file" "$CADDYFILE"
    docker exec "$CADDY_CONTAINER" \
      caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
    fail "Caddy reload failed; original restored"
  fi
fi

post_health="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://eterapy.com/api/health)"
[[ "$post_health" == "200" ]] || fail "eTerapy post-change health is $post_health"

printf 'bootstrap=ok eterapy_before=%s eterapy_after=%s listen=%s\n' \
  "$pre_health" "$post_health" "$LISTEN_ADDRESS"
