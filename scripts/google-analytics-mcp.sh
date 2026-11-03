#!/usr/bin/env bash
# Запуск официального MCP Google Analytics 4 (googleanalytics/google-analytics-mcp).
#
# Сервер ставится отдельно: `uv tool install analytics-mcp==0.8.0`. Без флага
# --allow-write он запрашивает только scope analytics.readonly
# (analytics_mcp/tools/client.py), поэтому записать в GA не может. Ключ лежит
# вне репозитория, путь — в openqareer.env; GOOGLE_PROJECT_ID — проект Google
# Cloud, где включены Analytics Admin и Data API.
set -Eeuo pipefail

PROJECT_ENV="${OPENQAREER_ENV_FILE:-$HOME/.openqareer/openqareer.env}"
SERVER_BIN="${ANALYTICS_MCP_BIN:-$HOME/.local/bin/analytics-mcp}"

if [[ ! -r "$PROJECT_ENV" ]]; then
  printf 'analytics-mcp: файл с учётными данными недоступен: %s\n' "$PROJECT_ENV" >&2
  exit 1
fi
if [[ ! -x "$SERVER_BIN" ]]; then
  printf 'analytics-mcp: сервер не установлен: %s (uv tool install analytics-mcp==0.8.0)\n' "$SERVER_BIN" >&2
  exit 1
fi

# Читаем только путь к ключу: `source` всего файла отдал бы процессу MCP
# ключи всех провайдеров, которые там лежат.
KEY_LINE="$(grep -m1 '^GOOGLE_APPLICATION_CREDENTIALS=' "$PROJECT_ENV" || true)"
KEY_PATH="${KEY_LINE#GOOGLE_APPLICATION_CREDENTIALS=}"
KEY_PATH="${KEY_PATH%[\"\']}"
KEY_PATH="${KEY_PATH#[\"\']}"
if [[ -z "$KEY_LINE" || ! -r "$KEY_PATH" ]]; then
  printf 'analytics-mcp: в %s нет GOOGLE_APPLICATION_CREDENTIALS или файл ключа недоступен\n' "$PROJECT_ENV" >&2
  exit 1
fi
export GOOGLE_APPLICATION_CREDENTIALS="$KEY_PATH"
export GOOGLE_PROJECT_ID="${GOOGLE_PROJECT_ID:-openqareer}"

exec "$SERVER_BIN"
