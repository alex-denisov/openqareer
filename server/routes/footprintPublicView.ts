import type { FootprintStep } from '../../shared/footprintSteps';

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

/** Инструмент сервера → шаг, который видит клиент. Неизвестное — «Другие проверки». */
const STEP_OF_TOOL: Readonly<Record<string, FootprintStep>> = {
  sherlock: 'nickname',
  maigret: 'nickname_extended',
  hibp: 'leaks',
  wayback: 'archive',
  exa: 'web',
  youtube: 'video',
  documentMetadata: 'files',
  exiftool: 'files',
  githubSecrets: 'code',
  github: 'code',
};

export function footprintStepOf(tool: string): FootprintStep {
  return STEP_OF_TOOL[tool] ?? 'other';
}

function availabilityByStep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const steps = new Map<FootprintStep, boolean>();
  for (const [tool, available] of Object.entries(value)) {
    const step = footprintStepOf(tool);
    steps.set(step, Boolean(available) || (steps.get(step) ?? false));
  }
  return Object.fromEntries(steps);
}

function publicField(key: string, field: unknown): unknown {
  if ((key === 'adapterId' || key === 'adapter') && typeof field === 'string') {
    return footprintStepOf(field);
  }
  if (key === 'sources' && Array.isArray(field)) {
    return [...new Set(field.map((tool) => footprintStepOf(String(tool))))];
  }
  if (key === 'sourceAvailability') return availabilityByStep(field);
  return toPublicFootprint(field);
}

/**
 * B740: ответ о цифровом следе для любого клиента и выгрузки — коды шагов вместо
 * инструментов; квитанции (способ запроса и источник) не уходят с сервера вовсе.
 */
export function toPublicFootprint<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => toPublicFootprint(item)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'receipt' && key !== 'receipts')
      .map(([key, field]) => [key, publicField(key, field)]),
  ) as T;
}
