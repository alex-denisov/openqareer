import type { B640Match } from '../routes';

/** Список, оставленный открытым под другим экраном. */
export interface KeptEntry {
  readonly id: number;
  readonly keepKey: string;
  readonly path: string;
  readonly search: string;
  readonly match: B640Match;
}

export interface KeptScreens {
  readonly entries: readonly KeptEntry[];
  /** Ключ списка на экране; `null` — на экране не список. */
  readonly active: string | null;
  readonly nextId: number;
}

export const NO_KEPT: KeptScreens = { entries: [], active: null, nextId: 1 };

/** Больше списков под экраном не держим: закрывается самый давний. */
export const MAX_KEPT = 4;

export interface KeptTarget {
  readonly keepKey: string | null;
  readonly path: string;
  readonly search: string;
  readonly match: B640Match | null;
  /** Переход — возврат: список открывается в прежнем состоянии, иначе заново. */
  readonly returning: boolean;
}

/** Открытые списки после перехода; тот же объект, если ничего не изменилось. */
export function nextKept(kept: KeptScreens, target: KeptTarget): KeptScreens {
  const { keepKey, path, search, match, returning } = target;
  if (!keepKey || !match) return kept.active === null ? kept : { ...kept, active: null };
  const found = kept.entries.find((entry) => entry.keepKey === keepKey);
  const same = kept.active === keepKey;
  if (found && same && found.path === path && found.search === search) return kept;
  const reuse = found && (same || (returning && found.search === search));
  const entry: KeptEntry = {
    id: reuse ? found.id : kept.nextId,
    ...{ keepKey, path, search, match },
  };
  const rest = kept.entries.filter((item) => item.keepKey !== keepKey);
  return {
    entries: [...rest, entry].slice(-MAX_KEPT),
    active: keepKey,
    nextId: reuse ? kept.nextId : kept.nextId + 1,
  };
}
