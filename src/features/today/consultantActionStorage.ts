import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';

/**
 * Хранилище решений по предложениям консультанта на «Сегодня» (C57).
 * Принятое или отклонённое предложение не возвращается в очередь кандидата.
 */

export function todayActionId(action: ReasonedCareerAction): string {
  const identity = JSON.stringify({
    revision: action.revision,
    type: action.type,
    destination: action.destination,
    findingIds: [...action.findingIds].sort(),
    roleIds: [...action.roleIds].sort(),
    marketIds: [...action.marketIds].sort(),
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identity)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

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
  now = new Date(),
): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(actionStorageKey(candidateId, action));
    if (value?.startsWith('deferred:')) {
      const deferredUntil = Date.parse(value.slice('deferred:'.length));
      if (Number.isNaN(deferredUntil) || now.getTime() >= deferredUntil) {
        storage.removeItem(actionStorageKey(candidateId, action));
        return false;
      }
      return true;
    }
    return value === 'accepted' || value === 'dismissed' || value === '1';
  } catch {
    return false;
  }
}

export function deferConsultantActionUntilTomorrow(
  candidateId: string | undefined,
  action: ReasonedCareerAction,
  storage: Storage | undefined = getStorage(),
  now = new Date(),
): void {
  if (!storage) return;
  const nextLocalDay = new Date(now);
  nextLocalDay.setHours(24, 0, 0, 0);
  try {
    storage.setItem(
      actionStorageKey(candidateId, action),
      `deferred:${nextLocalDay.toISOString()}`,
    );
  } catch {
    // quota or private mode: state still updates in-memory
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
