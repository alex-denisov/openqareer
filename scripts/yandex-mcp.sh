#!/usr/bin/env bash
# Запуск yandex-mcp (Вебмастер · Вордстат · Метрика) для всех шести агентов — B209.
#
# Секрет живёт только в `~/.openqareer/openqareer.env` (0600, вне репозитория) и
# передаётся серверу через окружение: ни токен, ни путь к нему в репозиторий не
# попадают. Отсутствие файла или бинаря — явная ошибка, а не тихий запуск без
# доступа, иначе агент решит, что данных по индексации просто нет.
set -Eeuo pipefail

PROJECT_ENV="${OPENQAREER_ENV_FILE:-$HOME/.openqareer/openqareer.env}"
SERVER_BIN="${YANDEX_MCP_BIN:-$HOME/.local/share/eterapy-tools/yandex-mcp/.venv/bin/yandex-mcp}"

if [[ ! -r "$PROJECT_ENV" ]]; then
  printf 'yandex-mcp: файл с учётными данными недоступен: %s\n' "$PROJECT_ENV" >&2
  exit 1
fi

if [[ ! -x "$SERVER_BIN" ]]; then
  printf 'yandex-mcp: сервер не установлен: %s (переопределяется YANDEX_MCP_BIN)\n' "$SERVER_BIN" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$PROJECT_ENV"
set +a

: "${YANDEX_OAUTH_TOKEN:?yandex-mcp: в $PROJECT_ENV нет YANDEX_OAUTH_TOKEN}"
export YANDEX_TOKEN="$YANDEX_OAUTH_TOKEN"

exec "$SERVER_BIN"
