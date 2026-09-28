import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

/**
 * Хранилище решений по предложениям консультанта на «Сегодня» (C57).
 * Принятое или отклонённое предложение не возвращается в очередь кандидата.
 */

function actionStorageKey(candidateId: string | undefined, action: ReasonedCareerAction): string {
  const scope = candidateId?.trim() || 'anonymous';
  return `career-today-consultant-resolved:${scope}:${action.headline}`;
}

const memoryStorage = new Map<string, string>();
const fallbackStorage: Storage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value));
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key);
  },
  clear: () => {
    memoryStorage.clear();
  },
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
  get length() {
    return memoryStorage.size;
  },
};

function getStorage(): Storage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  return fallbackStorage;
}

export function isConsultantActionResolved(
  candidateId: string | undefined,
  action: ReasonedCareerAction,
  storage: Storage | undefined = getStorage(),
): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(actionStorageKey(candidateId, action));
    return value === 'accepted' || value === 'dismissed' || value === '1';
  } catch {
    return false;
  }
}

export function resolveConsultantAction(
  candidateId: string | undefined,
  action: ReasonedCareerAction,
  resolution: 'accepted' | 'dismissed',
  storage: Storage | undefined = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(actionStorageKey(candidateId, action), resolution);
  } catch {
    // quota or private mode: state still updates in-memory
  }
}

export function clearConsultantActionResolution(
  candidateId: string | undefined,
  action: ReasonedCareerAction,
  storage: Storage | undefined = getStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(actionStorageKey(candidateId, action));
  } catch {
    // quota or private mode
  }
}
