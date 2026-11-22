/**
 * B740: экран B640 не называет инструменты и способ поиска (B667, решение владельца об OSINT).
 * Прежний экран без флага читает `adapterId` и `sourceAvailability`, поэтому ответы без флага
 * остаются как были, а с флагом из них убираются поля, где живут названия инструментов.
 */
const TOOL_FIELDS: ReadonlySet<string> = new Set([
  'adapterId',
  'adapter',
  'receipt',
  'receipts',
  'sources',
  'sourceAvailability',
]);

export function hideFootprintTools<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => hideFootprintTools(item)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !TOOL_FIELDS.has(key))
      .map(([key, field]) => [key, hideFootprintTools(field)]),
  ) as T;
}
