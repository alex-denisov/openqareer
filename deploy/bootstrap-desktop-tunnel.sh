#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }

readonly VERSION="1.13.19"
readonly ARCHIVE="sing-box-${VERSION}-linux-amd64.tar.gz"
readonly ARCHIVE_SHA="ef88a9e577d474210867bd708933d042e9b70106529df2656182c9db90106aa1"
readonly DOWNLOAD_URL="https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${ARCHIVE}"
readonly ENV_FILE="/etc/openqareer/openqareer.env"
readonly TUNNEL_USER="openqareer-tunnel"
readonly TUNNEL_HOME="/var/lib/openqareer-tunnel"
readonly CLIENT_KEY="/etc/openqareer/desktop-tunnel-client-ed25519"
readonly SINGBOX_DIR="/etc/sing-box"
readonly SINGBOX_CONFIG="$SINGBOX_DIR/openqareer-desktop.json"
readonly PROXY_SECRET="$SINGBOX_DIR/openqareer-desktop-proxy.env"
readonly CADDY_FILE="/etc/caddy/Caddyfile"
readonly TEMP_DIR="$(mktemp -d)"

cleanup() {
  [[ -z "${preflight_pid:-}" ]] || kill "$preflight_pid" 2>/dev/null || true
  rm -rf -- "$TEMP_DIR"
}
trap cleanup EXIT

read_env_value() {
  local -r key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

upsert_env_value() {
  local -r key="$1" value="$2" candidate="$TEMP_DIR/env-candidate"
  awk -F= -v key="$key" '$1 != key { print }' "$ENV_FILE" > "$candidate"
  printf '%s=%s\n' "$key" "$value" >> "$candidate"
  install -o root -g openqareer-deploy -m 0640 "$candidate" "$ENV_FILE"
}

remove_env_value() {
  local -r key="$1" candidate="$TEMP_DIR/env-candidate"
  awk -F= -v key="$key" '$1 != key { print }' "$ENV_FILE" > "$candidate"
  install -o root -g openqareer-deploy -m 0640 "$candidate" "$ENV_FILE"
}

curl --fail --location --silent --show-error "$DOWNLOAD_URL" --output "$TEMP_DIR/$ARCHIVE"
printf '%s  %s\n' "$ARCHIVE_SHA" "$TEMP_DIR/$ARCHIVE" | sha256sum --check --status
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"
install -o root -g root -m 0755 "$TEMP_DIR/sing-box-${VERSION}-linux-amd64/sing-box" /usr/local/bin/sing-box

id "$TUNNEL_USER" >/dev/null 2>&1 || useradd --system --user-group --home-dir "$TUNNEL_HOME" --create-home --shell /usr/sbin/nologin "$TUNNEL_USER"
install -d -o "$TUNNEL_USER" -g "$TUNNEL_USER" -m 0700 "$TUNNEL_HOME/.ssh"
if [[ ! -f "$CLIENT_KEY" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C openqareer-desktop-tunnel -f "$CLIENT_KEY"
fi
chmod 0600 "$CLIENT_KEY"
client_public_key="$(<"$CLIENT_KEY.pub")"
printf 'no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc,permitopen="127.0.0.1:18081" %s\n' "$client_public_key" > "$TEMP_DIR/authorized_keys"
install -o "$TUNNEL_USER" -g "$TUNNEL_USER" -m 0600 "$TEMP_DIR/authorized_keys" "$TUNNEL_HOME/.ssh/authorized_keys"

if [[ -f "$PROXY_SECRET" ]]; then
  proxy_username="$(awk -F= '$1 == "USERNAME" { print $2; exit }' "$PROXY_SECRET")"
  proxy_password="$(awk -F= '$1 == "PASSWORD" { print $2; exit }' "$PROXY_SECRET")"
else
  proxy_username="oq_$(openssl rand -hex 8)"
  proxy_password="$(openssl rand -hex 32)"
  printf 'USERNAME=%s\nPASSWORD=%s\n' "$proxy_username" "$proxy_password" > "$TEMP_DIR/proxy.env"
  install -d -o root -g nogroup -m 0750 "$SINGBOX_DIR"
  install -o root -g root -m 0600 "$TEMP_DIR/proxy.env" "$PROXY_SECRET"
fi

ssh_private_key_base64="$(base64 -w 0 "$CLIENT_KEY")"
ssh_host_key="$(awk '{ print $1 " " $2 }' /etc/ssh/ssh_host_ed25519_key.pub)"
ssh_host_key_base64="$(printf '%s' "$ssh_host_key" | base64 -w 0)"
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_SERVER openqareer.com
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_PORT 22
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_SSH_USER "$TUNNEL_USER"
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_SSH_PRIVATE_KEY_BASE64 "$ssh_private_key_base64"
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY_BASE64 "$ssh_host_key_base64"
remove_env_value OPENQAREER_DESKTOP_TUNNEL_SSH_HOST_KEY
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_PROXY_USERNAME "$proxy_username"
upsert_env_value OPENQAREER_DESKTOP_TUNNEL_PROXY_PASSWORD "$proxy_password"
for obsolete in UUID SERVER_NAME REALITY_PUBLIC_KEY REALITY_SHORT_ID PATH; do
  remove_env_value "OPENQAREER_DESKTOP_TUNNEL_${obsolete}"
done

sed -e "s|__USERNAME__|$proxy_username|g" -e "s|__PASSWORD__|$proxy_password|g" > "$TEMP_DIR/sing-box.json" <<'JSON'
{
  "log": { "level": "warn", "timestamp": true },
  "inbounds": [{
    "type": "http",
    "tag": "restricted-http-in",
    "listen": "127.0.0.1",
    "listen_port": 18081,
    "users": [{ "username": "__USERNAME__", "password": "__PASSWORD__" }]
  }],
  "outbounds": [{ "type": "direct", "tag": "direct-out" }, { "type": "block", "tag": "block-out" }],
  "route": {
    "rules": [{
      "domain_suffix": [
        "linkedin.com", "licdn.com", "lnkd.in", "linkedin.cn",
        "microsoft.com", "microsoftonline.com", "live.com",
        "google.com", "gstatic.com", "recaptcha.net"
      ],
      "outbound": "direct-out"
    }],
    "final": "block-out",
    "auto_detect_interface": true
  }
}
JSON
install -d -o root -g nogroup -m 0750 "$SINGBOX_DIR"
install -o root -g nogroup -m 0640 "$TEMP_DIR/sing-box.json" "$SINGBOX_CONFIG"
/usr/local/bin/sing-box check -c "$SINGBOX_CONFIG"

sed -n '2,$p' > "$TEMP_DIR/openqareer-desktop-tunnel.service" <<'UNIT'
discard-this-line
[Unit]
Description=OpenQareer restricted LinkedIn egress proxy
After=network-online.target ssh.service
Wants=network-online.target

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/local/bin/sing-box run -c /etc/sing-box/openqareer-desktop.json
Restart=on-failure
RestartSec=2s
TimeoutStopSec=5s
NoNewPrivileges=true
PrivateDevices=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
install -o root -g root -m 0644 "$TEMP_DIR/openqareer-desktop-tunnel.service" /etc/systemd/system/openqareer-desktop-tunnel.service
systemctl daemon-reload
systemctl enable openqareer-desktop-tunnel.service
systemctl restart openqareer-desktop-tunnel.service
sleep 1
systemctl is-active --quiet openqareer-desktop-tunnel.service
ss -lnt | grep -q '127.0.0.1:18081'

# Exercise the same sing-box SSH -> restricted HTTP chain the desktop uses.
sed -e "s|__HOST_KEY__|$ssh_host_key|g" -e "s|__USERNAME__|$proxy_username|g" -e "s|__PASSWORD__|$proxy_password|g" > "$TEMP_DIR/preflight.json" <<'JSON'
{
  "log": { "level": "debug" },
  "inbounds": [{ "type": "http", "listen": "127.0.0.1", "listen_port": 11887 }],
  "outbounds": [
    { "type": "ssh", "tag": "ssh-out", "server": "127.0.0.1", "server_port": 22, "user": "openqareer-tunnel", "private_key_path": "/etc/openqareer/desktop-tunnel-client-ed25519", "host_key": ["__HOST_KEY__"], "host_key_algorithms": ["ssh-ed25519"] },
    { "type": "http", "tag": "proxy-out", "server": "127.0.0.1", "server_port": 18081, "username": "__USERNAME__", "password": "__PASSWORD__", "detour": "ssh-out" }
  ],
  "route": { "final": "proxy-out" }
}
JSON
/usr/local/bin/sing-box check -c "$TEMP_DIR/preflight.json"
/usr/local/bin/sing-box run -c "$TEMP_DIR/preflight.json" > "$TEMP_DIR/preflight.log" 2>&1 &
preflight_pid=$!
sleep 1
if ! curl --fail --silent --show-error --max-time 15 --proxy http://127.0.0.1:11887 https://www.linkedin.com/login --output /dev/null; then
  sed -n '1,120p' "$TEMP_DIR/preflight.log" >&2
  exit 1
fi
if curl --silent --max-time 5 --proxy http://127.0.0.1:11887 https://example.com/ --output /dev/null; then
  printf 'restricted proxy allowed a non-LinkedIn destination\n' >&2
  exit 1
fi
kill "$preflight_pid" 2>/dev/null || true
wait "$preflight_pid" 2>/dev/null || true
preflight_pid=""

# Remove the superseded WebSocket tunnel route while preserving the current site config.
if grep -q '# openqareer-desktop-tunnel-begin' "$CADDY_FILE"; then
  cp -p "$CADDY_FILE" "$CADDY_FILE.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  awk '
    /# openqareer-desktop-tunnel-begin/ { old_tunnel=1; next }
    /# openqareer-desktop-tunnel-end/ { old_tunnel=0; next }
    old_tunnel { next }
    /@not_desktop_tunnel/ { next }
    /^\t\tConnection "close"$/ { next }
    {
      gsub(/ \/desktop-tunnel-[^ ]+\*/, "")
    }
    /^\theader \{$/ { print; print "\t\tConnection \"close\""; next }
    { print }
  ' "$CADDY_FILE" > "$TEMP_DIR/Caddyfile"
  /usr/bin/caddy validate --config "$TEMP_DIR/Caddyfile"
  install -o root -g caddy -m 0644 "$TEMP_DIR/Caddyfile" "$CADDY_FILE"
  systemctl reload caddy
  curl --fail --silent --show-error --max-time 10 https://openqareer.com/health > /dev/null
fi

printf 'desktop_tunnel=ready transport=restricted-ssh sing_box=%s\n' "$VERSION"
