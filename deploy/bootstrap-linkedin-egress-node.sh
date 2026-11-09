#!/usr/bin/env bash
# B625: LinkedIn egress node on the relay VM (eterapy-3).
#
# Runs as root on the relay. Installs a sing-box Shadowsocks-2022 inbound that
# only the prod origin may reach (iptables chain + sing-box source rule) and
# that only forwards LinkedIn sign-in domains; everything else is blocked.
# Prod's restricted LinkedIn proxy (deploy/bootstrap-desktop-tunnel.sh) uses it
# as its outbound, so LinkedIn sees the relay's IP, not the origin's.
#
# Usage: ORIGIN_IP=151.247.208.53 bash bootstrap-linkedin-egress-node.sh
# Prints the line `EGRESS_KEY_FILE=<path>`; the key itself stays in that
# root-only file and is copied to prod by the operator without printing it.
#
# Rollback: systemctl disable --now openqareer-linkedin-egress.service
#           (its ExecStopPost removes the iptables chain), then on prod delete
#           /etc/sing-box/openqareer-egress-upstream.env and rerun
#           bootstrap-desktop-tunnel.sh, which restores direct egress.
# Touches only openqareer-* files; the VM is shared, nothing else changes.
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }
[[ "${ORIGIN_IP:-}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { printf 'ORIGIN_IP required\n' >&2; exit 1; }

readonly VERSION="1.13.19"
readonly ARCHIVE="sing-box-${VERSION}-linux-amd64.tar.gz"
readonly ARCHIVE_SHA="ef88a9e577d474210867bd708933d042e9b70106529df2656182c9db90106aa1"
readonly DOWNLOAD_URL="https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${ARCHIVE}"
readonly PORT="${EGRESS_PORT:-8443}"
readonly DIR="/etc/sing-box"
readonly CONFIG="$DIR/openqareer-linkedin-egress.json"
readonly SECRET="$DIR/openqareer-linkedin-egress.env"
readonly FW="/usr/local/sbin/openqareer-linkedin-egress-fw"
readonly UNIT="/etc/systemd/system/openqareer-linkedin-egress.service"
readonly TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

if [[ "$(/usr/local/bin/sing-box version 2>/dev/null | awk 'NR==1 { print $3 }')" != "$VERSION" ]]; then
  curl --fail --location --silent --show-error "$DOWNLOAD_URL" --output "$TEMP_DIR/$ARCHIVE"
  printf '%s  %s\n' "$ARCHIVE_SHA" "$TEMP_DIR/$ARCHIVE" | sha256sum --check --status
  tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"
  install -o root -g root -m 0755 "$TEMP_DIR/sing-box-${VERSION}-linux-amd64/sing-box" /usr/local/bin/sing-box
fi

install -d -o root -g nogroup -m 0750 "$DIR"
if [[ ! -f "$SECRET" ]]; then
  printf 'KEY=%s\n' "$(openssl rand -base64 16)" > "$TEMP_DIR/secret.env"
  install -o root -g root -m 0600 "$TEMP_DIR/secret.env" "$SECRET"
fi
key="$(awk -F= '$1 == "KEY" { sub(/^KEY=/, ""); print; exit }' "$SECRET")"

sed -e "s|__KEY__|$key|g" -e "s|__PORT__|$PORT|g" -e "s|__ORIGIN__|$ORIGIN_IP|g" > "$TEMP_DIR/config.json" <<'JSON'
{
  "log": { "level": "warn", "timestamp": true },
  "inbounds": [{
    "type": "shadowsocks",
    "tag": "origin-in",
    "listen": "0.0.0.0",
    "listen_port": __PORT__,
    "method": "2022-blake3-aes-128-gcm",
    "password": "__KEY__"
  }],
  "outbounds": [{ "type": "direct", "tag": "direct-out" }, { "type": "block", "tag": "block-out" }],
  "route": {
    "rules": [
      { "source_ip_cidr": ["__ORIGIN__/32"], "invert": true, "outbound": "block-out" },
      {
        "domain_suffix": [
          "linkedin.com", "licdn.com", "lnkd.in", "linkedin.cn",
          "microsoft.com", "microsoftonline.com", "live.com",
          "google.com", "gstatic.com", "recaptcha.net",
          "ipinfo.io"
        ],
        "outbound": "direct-out"
      }
    ],
    "final": "block-out"
  }
}
JSON
/usr/local/bin/sing-box check -c "$TEMP_DIR/config.json"
install -o root -g nogroup -m 0640 "$TEMP_DIR/config.json" "$CONFIG"

# Idempotent firewall: own chain, rebuilt on every start, removed on stop.
cat > "$TEMP_DIR/fw" <<SH
#!/usr/bin/env bash
set -Eeuo pipefail
chain=OQ_LINKEDIN_EGRESS
while iptables -D INPUT -p tcp --dport $PORT -j \$chain 2>/dev/null; do :; done
while iptables -D INPUT -p udp --dport $PORT -j \$chain 2>/dev/null; do :; done
iptables -F \$chain 2>/dev/null || true
iptables -X \$chain 2>/dev/null || true
[[ "\${1:-up}" == "down" ]] && exit 0
iptables -N \$chain
iptables -A \$chain -s $ORIGIN_IP/32 -j ACCEPT
iptables -A \$chain -j DROP
iptables -I INPUT -p tcp --dport $PORT -j \$chain
iptables -I INPUT -p udp --dport $PORT -j \$chain
SH
install -o root -g root -m 0755 "$TEMP_DIR/fw" "$FW"

cat > "$TEMP_DIR/unit" <<UNIT
[Unit]
Description=OpenQareer LinkedIn egress node (B625, origin $ORIGIN_IP only)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=+$FW up
ExecStart=/usr/local/bin/sing-box run -c $CONFIG
ExecStopPost=+$FW down
User=nobody
Group=nogroup
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=on-failure
RestartSec=2s
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
UNIT
install -o root -g root -m 0644 "$TEMP_DIR/unit" "$UNIT"
systemctl daemon-reload
systemctl enable openqareer-linkedin-egress.service >/dev/null
systemctl restart openqareer-linkedin-egress.service
sleep 1
systemctl is-active --quiet openqareer-linkedin-egress.service
ss -lnt | grep -q ":$PORT "
printf 'linkedin_egress_node=ready port=%s origin=%s\nEGRESS_KEY_FILE=%s\n' "$PORT" "$ORIGIN_IP" "$SECRET"
