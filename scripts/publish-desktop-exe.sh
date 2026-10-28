#!/usr/bin/env bash
# B576: publish the Windows installer built by the "Desktop app for Windows"
# workflow to the production host, next to the macOS image.
# Usage: scripts/publish-desktop-exe.sh <OpenQareer_X_x64-setup.exe> [host]
#   (default host: openqareer-de-1, owner key, sudo)
# Fetch the installer first: gh run download <run-id> -n openqareer-windows-x64
set -euo pipefail
EXE="${1:?path to OpenQareer_<version>_x64-setup.exe}"
HOST="${2:-openqareer-de-1}"
[[ -f "$EXE" ]] || { echo "no installer at $EXE" >&2; exit 1; }
NAME="$(basename "$EXE")"
[[ "$NAME" =~ ^OpenQareer_([0-9A-Za-z.+-]+)_x64-setup\.exe$ ]] || { echo "unexpected name $NAME" >&2; exit 1; }
VERSION="${BASH_REMATCH[1]}"
SHA="$(shasum -a 256 "$EXE" | cut -d' ' -f1)"
DIR=/var/lib/openqareer/downloads
scp -q "$EXE" "$HOST:/tmp/$NAME.part"
ssh "$HOST" "sudo bash -s" <<REMOTE
set -euo pipefail
[[ -d $DIR ]] || { echo "$DIR missing: run deploy/bootstrap.sh first" >&2; exit 1; }
install -o openqareer-deploy -g openqareer-deploy -m 0644 /tmp/$NAME.part $DIR/$NAME.new
rm -f /tmp/$NAME.part
mv $DIR/$NAME.new $DIR/$NAME
printf '{"version":"%s","sha256":"%s","fileName":"%s"}\n' '$VERSION' '$SHA' '$NAME' > $DIR/desktop-windows.json.new
chown openqareer-deploy:openqareer-deploy $DIR/desktop-windows.json.new
mv $DIR/desktop-windows.json.new $DIR/desktop-windows.json
find $DIR -name 'OpenQareer_*-setup.exe' ! -name '$NAME' -delete
REMOTE
echo "published $NAME sha256=$SHA"
