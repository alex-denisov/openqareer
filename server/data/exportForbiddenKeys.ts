/**
 * B738: в выгрузке нет секретов и служебного чужого: ни хешей паролей и кодов, ни токенов
 * сессий, OAuth, hh.ru, LinkedIn и Telegram, ни cookies, ни ключей партнёров.
 */
export const FORBIDDEN_EXPORT_KEY = /hash|token|secret|cookie|password|passwd|session_?key|api_?key/iu;

/** Пути полей, чьё имя похоже на секрет: пустой список — выгрузка чистая. */
export function forbiddenExportKeys(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenExportKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return [...(FORBIDDEN_EXPORT_KEY.test(key) ? [here] : []), ...forbiddenExportKeys(child, here)];
  });
}
