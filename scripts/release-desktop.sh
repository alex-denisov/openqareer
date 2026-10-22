#!/usr/bin/env bash
# B359: build, sign and publish a macOS desktop update (arm64 + x86_64).
# Usage: scripts/release-desktop.sh <semver> [--notes <text>] [--host <ssh-host>] [--no-publish]
# Idempotent: an architecture whose signed archive for this version already exists
# is not rebuilt, files already on the host with the same hash are not re-sent, and
# latest.json is replaced last, so the feed never names an archive that is not there.
# The signing key path and password come from ~/.openqareer/openqareer.env and are
# never printed.
set -euo pipefail

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 <semver> [--notes text] [--host host] [--no-publish]" >&2; exit 1; }
shift
NOTES="" HOST="openqareer-de-1" PUBLISH=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES="${2:?--notes needs text}"; shift 2 ;;
    --host) HOST="${2:?--host needs a host}"; shift 2 ;;
    --no-publish) PUBLISH=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${OPENQAREER_ENV_FILE:-$HOME/.openqareer/openqareer.env}"
FEED="$ROOT/src-tauri/target/desktop-feed/$VERSION"
REMOTE_DIR=/var/lib/openqareer/desktop
TARGETS=(aarch64-apple-darwin x86_64-apple-darwin)

read_env() {
  local value
  value="$(grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-)"
  value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
TAURI_SIGNING_PRIVATE_KEY="$(read_env TAURI_SIGNING_PRIVATE_KEY)"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(read_env TAURI_SIGNING_PRIVATE_KEY_PASSWORD)"
[[ -n "$TAURI_SIGNING_PRIVATE_KEY" ]] || { echo "TAURI_SIGNING_PRIVATE_KEY is not set in $ENV_FILE" >&2; exit 1; }
TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY/#\~/$HOME}"
export TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

cd "$ROOT"
COMMIT=""
[[ -z "$(git status --porcelain --untracked-files=no)" ]] && COMMIT="$(git rev-parse HEAD)"
CONFIG="$(mktemp -t openqareer-release-conf)"
trap 'rm -f "$CONFIG"' EXIT
node -e '
  const fs = require("fs");
  const release = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  fs.writeFileSync(process.argv[2], JSON.stringify({ ...release, version: process.argv[3] }));
' src-tauri/tauri.release.conf.json "$CONFIG" "$VERSION"
mkdir -p "$FEED"

for target in "${TARGETS[@]}"; do
  arch="${target%%-*}"
  archive="$FEED/OpenQareer_${VERSION}_${arch}.app.tar.gz"
  if [[ -s "$archive" && -s "$archive.sig" ]]; then
    echo "$arch: $VERSION already built, reusing"
    continue
  fi
  rustup target add "$target" >/dev/null
  started="$(date +%s)"
  OPENQAREER_COMMIT_SHA="$COMMIT" npx tauri build --target "$target" --bundles app --config "$CONFIG"
  built="src-tauri/target/$target/release/bundle/macos/OpenQareer.app.tar.gz"
  [[ -s "$built" && -s "$built.sig" && "$(stat -f %m "$built.sig")" -ge "$started" ]] ||
    { echo "$arch: no fresh signed updater archive at $built" >&2; exit 1; }
  cp "$built" "$archive.part" && cp "$built.sig" "$archive.sig.part"
  mv "$archive.part" "$archive" && mv "$archive.sig.part" "$archive.sig"
done

# A rerun keeps the published manifest (and its date) unless an archive was rebuilt.
[[ -s "$FEED/latest.json" && "$FEED/latest.json" -nt "$FEED/OpenQareer_${VERSION}_aarch64.app.tar.gz.sig" &&
   "$FEED/latest.json" -nt "$FEED/OpenQareer_${VERSION}_x86_64.app.tar.gz.sig" ]] ||
node scripts/build-update-manifest.mjs --version "$VERSION" --notes "$NOTES" \
  --artifact "darwin-aarch64=$FEED/OpenQareer_${VERSION}_aarch64.app.tar.gz" \
  --artifact "darwin-x86_64=$FEED/OpenQareer_${VERSION}_x86_64.app.tar.gz" \
  --output "$FEED/latest.json"

echo "feed $FEED (commit ${COMMIT:-unmarked}):"
(cd "$FEED" && shasum -a 256 OpenQareer_* latest.json)
[[ "$PUBLISH" == 1 ]] || exit 0

STAGE="/tmp/openqareer-desktop-$VERSION"
ssh "$HOST" "mkdir -p $STAGE"
scp -q "$FEED"/OpenQareer_* "$FEED/latest.json" "$HOST:$STAGE/"
ssh "$HOST" "sudo bash -s" <<REMOTE
set -euo pipefail
install -d -o openqareer-deploy -g openqareer-deploy -m 0755 $REMOTE_DIR
cd $STAGE
for file in OpenQareer_${VERSION}_*; do
  if ! cmp -s "\$file" "$REMOTE_DIR/\$file"; then
    install -o openqareer-deploy -g openqareer-deploy -m 0644 "\$file" "$REMOTE_DIR/\$file.new"
    mv "$REMOTE_DIR/\$file.new" "$REMOTE_DIR/\$file"
  fi
done
install -o openqareer-deploy -g openqareer-deploy -m 0644 latest.json $REMOTE_DIR/latest.json.new
mv $REMOTE_DIR/latest.json.new $REMOTE_DIR/latest.json
# Keep this version and the one before it, so a download already under way finishes.
ls -1 $REMOTE_DIR | grep -E '^OpenQareer_.*\.app\.tar\.gz$' | sed -E 's/^OpenQareer_([^_]+)_.*/\1/' |
  sort -u -V | { grep -vx '$VERSION' || true; } | head -n -1 | while read -r old; do
    rm -f $REMOTE_DIR/OpenQareer_\${old}_*
  done
rm -rf $STAGE
REMOTE
echo "published $VERSION to $HOST:$REMOTE_DIR"
