/**
 * B738: в выгрузке нет секретов и служебного чужого: ни хешей паролей и кодов, ни токенов
 * сессий, OAuth, hh.ru, LinkedIn и Telegram, ни cookies, ни ключей партнёров, ни соли, ключа
 * идемпотентности и ссылки оплаты у провайдера, ни шифротекстов и номера чата бота, ни кодов
 * ошибок и названия модели, ни учётных данных и заголовков авторизации.
 */
export const FORBIDDEN_EXPORT_KEY =
  /hash|token|secret|cookie|password|passwd|salt|session_?key|api_?key|idempoten|payment_?url|cipher|chat_?id|failure_?code|answered_?by|credential|bearer|authorization|jwt|one_?time_?code/iu;

/**
 * Поля, чьё имя похоже на запретное, но это не секрет: счётчики токенов модели в ходах
 * консультанта. Точные пути, индексы массивов записаны как `[]`.
 */
export const ALLOWED_EXPORT_PATHS: ReadonlySet<string> = new Set(
  ['turns[].provenance.usage', 'turns[].result.intelligence.roleContributions[].usage'].flatMap((usage) =>
    ['inputTokens', 'outputTokens', 'totalTokens'].map((counter) => `${usage}.${counter}`),
  ),
);

/** Путь без номеров элементов: `turns[3].id` → `turns[].id`. */
export function exportPathPattern(path: string): string {
  return path.replace(/\[\d+\]/gu, '[]');
}

/** Запрет проверяет только имя поля, значение (текст кандидата) не смотрит. */
function isForbidden(key: string, path: string): boolean {
  return FORBIDDEN_EXPORT_KEY.test(key) && !ALLOWED_EXPORT_PATHS.has(exportPathPattern(path));
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Пути полей, чьё имя похоже на секрет: пустой список — выгрузка чистая. */
export function forbiddenExportKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenExportKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = childPath(path, key);
    return isForbidden(key, here) ? [here] : forbiddenExportKeys(child, here);
  });
}

/**
 * Последний шаг выгрузки: копия без полей с запретным именем на любой глубине.
 * Так служебное не уходит и из старых разделов (ключи идемпотентности ходов и команд,
 * идентификатор одобрения, хеш входа подсказки). Значения не проверяются и не меняются.
 */
export function withoutForbiddenKeys<T>(value: T, path = ''): T {
  if (Array.isArray(value)) return value.map((item: unknown, index) => withoutForbiddenKeys(item, `${path}[${index}]`)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date || ArrayBuffer.isView(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isForbidden(key, childPath(path, key)))
      .map(([key, child]) => [key, withoutForbiddenKeys(child, childPath(path, key))]),
  ) as T;
}

/** Что убрал последний шаг: шаблоны путей без повторов, по алфавиту. */
export function strippedExportPaths(value: unknown): string[] {
  return [...new Set(forbiddenExportKeys(value).map(exportPathPattern))].sort();
}
