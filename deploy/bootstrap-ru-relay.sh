#!/usr/bin/env bash
# Russian-reachable relay for openqareer.com (2026-10-01).
#
# Russian networks drop traffic to the Hostkey DE origin, while the relay host
# stays reachable. The relay terminates TLS for openqareer.com inside the
# Caddy that already owns :80/:443 there and proxies to the origin; a socat
# unit forwards the desktop tunnel's SSH port unchanged, so the app keeps
# pinning the origin's own SSH host key.
#
# Idempotent: the Caddy block lives between markers and is replaced in place
# (the Caddyfile is a single-file bind mount, so its inode must not change);
# the unit is rewritten and restarted only when it differs.
#
# Usage, from the repository root:
#   ssh eterapy-3 'ORIGIN=151.243.169.140 bash -s' < deploy/bootstrap-ru-relay.sh
set -euo pipefail

readonly ORIGIN="${ORIGIN:?ORIGIN (origin IPv4) is required}"
readonly SITE="${SITE:-openqareer.com}"
readonly TUNNEL_PORT="${TUNNEL_PORT:-2222}"
readonly CADDYFILE="${CADDYFILE:-/opt/eterapy/Caddyfile}"
readonly CADDY_CONTAINER="${CADDY_CONTAINER:-eterapy-caddy-1}"
readonly UNIT=/etc/systemd/system/openqareer-relay-ssh.service
readonly BEGIN_MARK='# openqareer-relay BEGIN (deploy/bootstrap-ru-relay.sh)'
readonly END_MARK='# openqareer-relay END'

[[ "$ORIGIN" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "bad ORIGIN" >&2; exit 1; }
[[ -f "$CADDYFILE" ]] || { echo "no $CADDYFILE" >&2; exit 1; }

command -v socat >/dev/null || { apt-get update -qq && apt-get install -y -qq socat >/dev/null; }
SOCAT="$(command -v socat)" || { echo "socat install failed" >&2; exit 1; }
readonly SOCAT

block="$(cat <<EOF
$BEGIN_MARK
$SITE {
	# The origin renews its own certificate over HTTP-01 through this relay.
	handle /.well-known/acme-challenge/* {
		reverse_proxy http://$ORIGIN
	}
	handle {
		reverse_proxy https://$ORIGIN {
			header_up Host {host}
			transport http {
				tls_server_name $SITE
			}
		}
	}
}
$END_MARK
EOF
)"

candidate="$(mktemp)"
backup="$CADDYFILE.bak-openqareer-$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -f "$candidate"' EXIT
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
  $0 == b { skip = 1; next }
  $0 == e { skip = 0; next }
  !skip { print }
' "$CADDYFILE" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$candidate"
printf '\n%s\n' "$block" >> "$candidate"

if ! cmp -s "$candidate" "$CADDYFILE"; then
  cp -p "$CADDYFILE" "$backup"
  cat "$candidate" > "$CADDYFILE"   # in place: keeps the bind-mounted inode
  if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    cat "$backup" > "$CADDYFILE"
    echo "caddy validate failed; restored $backup" >&2
    exit 1
  fi
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "caddy: relay block applied (backup $backup)"
else
  echo "caddy: unchanged"
fi

unit_candidate="$(cat <<EOF
[Unit]
Description=openqareer desktop tunnel SSH relay ($TUNNEL_PORT -> $ORIGIN:22)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$SOCAT TCP-LISTEN:$TUNNEL_PORT,fork,reuseaddr,keepalive TCP:$ORIGIN:22,keepalive
Restart=always
RestartSec=2
DynamicUser=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
)"
if [[ ! -f "$UNIT" ]] || [[ "$(cat "$UNIT")" != "$unit_candidate" ]]; then
  printf '%s\n' "$unit_candidate" > "$UNIT"
  systemctl daemon-reload
  systemctl enable --now openqareer-relay-ssh.service >/dev/null
  systemctl restart openqareer-relay-ssh.service
  echo "socat: unit applied"
else
  systemctl enable openqareer-relay-ssh.service >/dev/null
  systemctl is-active --quiet openqareer-relay-ssh.service || {
    systemctl reset-failed openqareer-relay-ssh.service
    systemctl restart openqareer-relay-ssh.service
  }
  echo "socat: unchanged"
fi
systemctl is-active openqareer-relay-ssh.service
