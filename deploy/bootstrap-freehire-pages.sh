#!/usr/bin/env bash
# B645: freehire pages pass as its own unit instead of a maintenance step.
# Idempotent:
#  1. openqareer-freehire-pages.service from this directory;
#  2. maintenance drop-in OPENQAREER_FREEHIRE_PAGES_OFF=1 so only the unit runs the pass;
#  3. enable + start the unit; maintenance is restarted only when its drop-in changed.
# Rollback: systemctl disable --now openqareer-freehire-pages; rm the drop-in; restart maintenance.
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT=/etc/systemd/system/openqareer-freehire-pages.service
readonly DROPIN_DIR=/etc/systemd/system/openqareer-maintenance.service.d
readonly DROPIN="$DROPIN_DIR/b645-freehire-pages-off.conf"
readonly TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

[[ -f /srv/openqareer/current/freehire-pages-run.mjs ]] || { printf 'release has no freehire-pages-run.mjs\n' >&2; exit 1; }

install_if_changed() {
  local -r candidate="$1" target="$2"
  if ! cmp -s "$candidate" "$target" 2>/dev/null; then
    install -o root -g root -m 0644 "$candidate" "$target"
    return 0
  fi
  return 1
}

unit_changed=0
dropin_changed=0
install_if_changed "$SCRIPT_DIR/openqareer-freehire-pages.service" "$UNIT" && unit_changed=1
install -d -o root -g root -m 0755 "$DROPIN_DIR"
printf '[Service]\nEnvironment=OPENQAREER_FREEHIRE_PAGES_OFF=1\n' > "$TEMP_DIR/dropin.conf"
install_if_changed "$TEMP_DIR/dropin.conf" "$DROPIN" && dropin_changed=1

systemd-analyze verify "$UNIT"
if (( unit_changed || dropin_changed )); then systemctl daemon-reload; fi
# Maintenance first, so the pass never runs in two processes at once.
if (( dropin_changed )); then systemctl restart openqareer-maintenance.service; fi
systemctl enable openqareer-freehire-pages.service
if (( unit_changed )); then systemctl restart openqareer-freehire-pages.service; else systemctl start openqareer-freehire-pages.service; fi
systemctl is-active openqareer-freehire-pages.service
printf 'unit_changed=%s dropin_changed=%s\n' "$unit_changed" "$dropin_changed"
