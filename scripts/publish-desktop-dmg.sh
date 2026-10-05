#!/usr/bin/env bash
# B334: publish the freshly built macOS .dmg to the production host.
# Usage: scripts/publish-desktop-dmg.sh [host]   (default: openqareer-de-1, owner key, sudo)
# Run after `npm run tauri:build`. The file is copied to a temp name, then
# moved into place together with its manifest so the route never sees a half-written pair.
set -euo pipefail
HOST="${1:-openqareer-de-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DMG="$(ls -t "$ROOT"/src-tauri/target/release/bundle/dmg/OpenQareer_*.dmg 2>/dev/null | head -1)"
[[ -n "$DMG" ]] || { echo "no .dmg: run npm run tauri:build first" >&2; exit 1; }
NAME="$(basename "$DMG")"
[[ "$NAME" =~ ^OpenQareer_([0-9A-Za-z.+-]+)_(aarch64|x64)\.dmg$ ]] || { echo "unexpected name $NAME" >&2; exit 1; }
VERSION="${BASH_REMATCH[1]}"
SHA="$(shasum -a 256 "$DMG" | cut -d' ' -f1)"
DIR=/var/lib/openqareer/downloads
scp -q "$DMG" "$HOST:/tmp/$NAME.part"
ssh "$HOST" "sudo bash -s" <<REMOTE
set -euo pipefail
[[ -d $DIR ]] || { echo "$DIR missing: run deploy/bootstrap.sh first" >&2; exit 1; }
install -o openqareer-deploy -g openqareer-deploy -m 0644 /tmp/$NAME.part $DIR/$NAME.new
rm -f /tmp/$NAME.part
mv $DIR/$NAME.new $DIR/$NAME
printf '{"version":"%s","sha256":"%s","fileName":"%s"}\n' '$VERSION' '$SHA' '$NAME' > $DIR/desktop-macos.json.new
chown openqareer-deploy:openqareer-deploy $DIR/desktop-macos.json.new
mv $DIR/desktop-macos.json.new $DIR/desktop-macos.json
find $DIR -name 'OpenQareer_*.dmg' ! -name '$NAME' -delete
REMOTE
echo "published $NAME sha256=$SHA"
