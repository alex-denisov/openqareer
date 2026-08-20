#!/usr/bin/env bash
set -Eeuo pipefail

readonly VERSION="1.13.19"
readonly OUTPUT_DIR="${1:-src-tauri/binaries}"
readonly BASE_URL="https://github.com/SagerNet/sing-box/releases/download/v${VERSION}"
readonly TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT

download_and_verify() {
  local -r archive="$1"
  local -r expected_sha="$2"
  local -r source_path="$TEMP_DIR/$archive"
  curl --fail --location --silent --show-error "$BASE_URL/$archive" --output "$source_path"
  printf '%s  %s\n' "$expected_sha" "$source_path" | shasum -a 256 --check --status
}

mkdir -p "$OUTPUT_DIR"

if [[ -x "$OUTPUT_DIR/sing-box-x86_64-apple-darwin" && -x "$OUTPUT_DIR/sing-box-aarch64-apple-darwin" && -f "$OUTPUT_DIR/sing-box-x86_64-pc-windows-msvc.exe" ]]; then
  printf 'sing-box sidecars %s already present in %s\n' "$VERSION" "$OUTPUT_DIR"
  exit 0
fi

readonly DARWIN_AMD64="sing-box-${VERSION}-darwin-amd64.tar.gz"
download_and_verify "$DARWIN_AMD64" "31ee722237d95774e101fbffeae6be6776249c5f7db229ad8ff00b45b22e6a00"
tar -xzf "$TEMP_DIR/$DARWIN_AMD64" -C "$TEMP_DIR"
install -m 0755 "$TEMP_DIR/sing-box-${VERSION}-darwin-amd64/sing-box" "$OUTPUT_DIR/sing-box-x86_64-apple-darwin"

readonly DARWIN_ARM64="sing-box-${VERSION}-darwin-arm64.tar.gz"
download_and_verify "$DARWIN_ARM64" "23bf191906f2dfc9f00e9f0092f274f3426ba9377327e903ff94e636b64d0997"
tar -xzf "$TEMP_DIR/$DARWIN_ARM64" -C "$TEMP_DIR"
install -m 0755 "$TEMP_DIR/sing-box-${VERSION}-darwin-arm64/sing-box" "$OUTPUT_DIR/sing-box-aarch64-apple-darwin"

readonly WINDOWS_AMD64="sing-box-${VERSION}-windows-amd64.zip"
download_and_verify "$WINDOWS_AMD64" "e011a4def2f5e2b143ed54adb2b1a20a6be407806ab4442f3667f1dd817a2c8d"
unzip -q "$TEMP_DIR/$WINDOWS_AMD64" -d "$TEMP_DIR/windows-amd64"
install -m 0755 "$TEMP_DIR/windows-amd64/sing-box-${VERSION}-windows-amd64/sing-box.exe" "$OUTPUT_DIR/sing-box-x86_64-pc-windows-msvc.exe"

printf 'sing-box sidecars %s installed in %s\n' "$VERSION" "$OUTPUT_DIR"
