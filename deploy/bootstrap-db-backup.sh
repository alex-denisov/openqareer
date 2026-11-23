#!/usr/bin/env bash
# B777: ночные зашифрованные копии базы в S3 Cloud.ru (данные — каждую ночь, вся база — по
# воскресеньям). Идемпотентно:
#  1. пакеты age, rclone, zstd (только недостающие);
#  2. скрипты /usr/local/sbin/openqareer-db-backup и -restore-drill; в /usr/local/lib/openqareer —
#     ротация, копия незаменимых данных и список таблиц, собираемых заново;
#  3. публичный ключ age /etc/openqareer/backup-age.pub (закрытый — только у владельца);
#  4. openqareer-db-backup.service + .timer (02:30 МСК), timer enable --now.
# Секреты S3 кладутся отдельно в /etc/openqareer/backup.env (0600 root): CLOUDRU_PROJECT_ID,
# CLOUDRU_S3_KEY_ID, CLOUDRU_S3_KEY_SECRET. Без файла таймер не включается.
# Откат: systemctl disable --now openqareer-db-backup.timer; rm юниты, скрипт, daemon-reload.
set -Eeuo pipefail

[[ "${EUID}" -eq 0 ]] || { printf 'run as root\n' >&2; exit 1; }

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly UNIT_DIR=/etc/systemd/system

install_if_changed() {
  local -r candidate="$1" target="$2" mode="$3"
  if ! cmp -s "$candidate" "$target" 2>/dev/null; then
    install -o root -g root -m "$mode" "$candidate" "$target"
    return 0
  fi
  return 1
}

missing=()
for tool in age rclone zstd; do command -v "$tool" >/dev/null || missing+=("$tool"); done
if (( ${#missing[@]} )); then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi

[[ -f /etc/openqareer/backup.env ]] || { printf 'missing /etc/openqareer/backup.env\n' >&2; exit 1; }
chown root:root /etc/openqareer/backup.env
chmod 0600 /etc/openqareer/backup.env

install -d -o root -g root -m 0755 /usr/local/lib/openqareer
install -d -o root -g root -m 0700 /var/lib/openqareer-backup
changed=0
install_if_changed "$SCRIPT_DIR/openqareer-db-backup" /usr/local/sbin/openqareer-db-backup 0755 || true
install_if_changed "$SCRIPT_DIR/openqareer-db-restore-drill" /usr/local/sbin/openqareer-db-restore-drill 0755 || true
install_if_changed "$SCRIPT_DIR/dbBackupRotation.mjs" /usr/local/lib/openqareer/dbBackupRotation.mjs 0644 || true
install_if_changed "$SCRIPT_DIR/dbBackupUserData.mjs" /usr/local/lib/openqareer/dbBackupUserData.mjs 0644 || true
install_if_changed "$SCRIPT_DIR/db-backup-recollectable.txt" /usr/local/lib/openqareer/db-backup-recollectable.txt 0644 || true
install_if_changed "$SCRIPT_DIR/backup-age.pub" /etc/openqareer/backup-age.pub 0644 || true
install_if_changed "$SCRIPT_DIR/openqareer-db-backup.service" "$UNIT_DIR/openqareer-db-backup.service" 0644 && changed=1
install_if_changed "$SCRIPT_DIR/openqareer-db-backup.timer" "$UNIT_DIR/openqareer-db-backup.timer" 0644 && changed=1

systemd-analyze verify "$UNIT_DIR/openqareer-db-backup.service" "$UNIT_DIR/openqareer-db-backup.timer"
if (( changed )); then systemctl daemon-reload; fi
systemctl enable --now openqareer-db-backup.timer
systemctl list-timers openqareer-db-backup.timer --no-pager
printf 'units_changed=%s\n' "$changed"
