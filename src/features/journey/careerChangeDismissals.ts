import { useEffect, useSyncExternalStore } from 'react';
import { computeProposalKey } from '../../../shared/consultantProposalKey';
import { apiFetch, readData } from '../coach/apiClient';
import { rejectCoachProposal } from '../coach/coachApi';
import type { CareerChangeKind } from '../coach/careerChangeView';

/**
 * «Не сейчас» у изменения «Карьеры» хранится на сервере в отказах консультанта;
 * панель читает их один раз за страницу, иначе после перезагрузки прошлый ответ
 * консультанта снова предлагал отложенное (замечание владельца 26.10).
 */
let dismissed: ReadonlySet<string> = new Set();
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  dismissed = next;
  listeners.forEach((listener) => listener());
}

export function careerChangeKey(kind: CareerChangeKind, lines: readonly string[]): string {
  return computeProposalKey(kind, lines.join('; '));
}

export function loadCareerChangeDismissals(): Promise<void> {
  loaded ??= apiFetch('/api/v1/coach/proposals/career-rejections')
    .then((response) => readData<string[] | null>(response))
    .then((keys) => publish(new Set([...dismissed, ...(keys ?? [])])))
    .catch(() => {
      // Не прочиталось — карточка остаётся видимой; повторим при следующем показе.
      loaded = null;
    });
  return loaded;
}

export async function dismissCareerChange(key: string): Promise<void> {
  publish(new Set([...dismissed, key]));
  await rejectCoachProposal({ proposalKey: key, reason: 'Кандидат отложил изменение «Карьеры»' });
}

/** Отложенные изменения «Карьеры» целиком: список предложений прячет пустой заголовок. */
export function useCareerChangeDismissals(): ReadonlySet<string> {
  const snapshot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dismissed,
    () => dismissed,
  );
  useEffect(() => {
    void loadCareerChangeDismissals();
  }, []);
  return snapshot;
}

export function useCareerChangeDismissed(key: string): boolean {
  return useCareerChangeDismissals().has(key);
}

/** Только для тестов. */
export function resetCareerChangeDismissals(keys: readonly string[] = []): void {
  loaded = null;
  publish(new Set(keys));
}
