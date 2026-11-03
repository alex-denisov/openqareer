#!/usr/bin/env bash
# Запуск MCP Google Search Console + PageSpeed (только чтение) для агентов.
#
# Ключ сервисного аккаунта лежит вне репозитория; путь к нему берётся из
# `~/.openqareer/openqareer.env`. Отсутствие файла или ключа — явная ошибка,
# а не тихий запуск без доступа (как в scripts/yandex-mcp.sh).
set -Eeuo pipefail

PROJECT_ENV="${OPENQAREER_ENV_FILE:-$HOME/.openqareer/openqareer.env}"
UV_BIN="${UV_BIN:-$HOME/.local/bin/uv}"
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/gsc-mcp" && pwd)"

if [[ ! -r "$PROJECT_ENV" ]]; then
  printf 'gsc-mcp: файл с учётными данными недоступен: %s\n' "$PROJECT_ENV" >&2
  exit 1
fi
if [[ ! -x "$UV_BIN" ]]; then
  printf 'gsc-mcp: не найден uv: %s (переопределяется UV_BIN)\n' "$UV_BIN" >&2
  exit 1
fi

# Читаем только путь к ключу: `source` всего файла отдал бы процессу MCP
# ключи всех провайдеров, которые там лежат.
KEY_LINE="$(grep -m1 '^GOOGLE_APPLICATION_CREDENTIALS=' "$PROJECT_ENV" || true)"
KEY_PATH="${KEY_LINE#GOOGLE_APPLICATION_CREDENTIALS=}"
KEY_PATH="${KEY_PATH%[\"\']}"
KEY_PATH="${KEY_PATH#[\"\']}"
if [[ -z "$KEY_LINE" || ! -r "$KEY_PATH" ]]; then
  printf 'gsc-mcp: в %s нет GOOGLE_APPLICATION_CREDENTIALS или файл ключа недоступен\n' "$PROJECT_ENV" >&2
  exit 1
fi
export GOOGLE_APPLICATION_CREDENTIALS="$KEY_PATH"

exec "$UV_BIN" run --quiet --script "$SERVER_DIR/server.py"
