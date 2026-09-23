import type { ApplicationView } from './applicationsApi';
import { APPLICATION_VERSION_CONFLICT_CODE } from './applicationsApi';
import { CoachApiError } from '../coach/apiClient';

/**
 * Pure list/error helpers behind `useApplications`, split out so the state
 * machine around a stage change (optimistic update, rollback, 409 vs. plain
 * failure) is unit-tested without mounting React or mocking `fetch`.
 */

/** Replaces the card with the same `id`; leaves the list untouched otherwise. */
export function replaceApplication(
  list: readonly ApplicationView[],
  updated: ApplicationView,
): readonly ApplicationView[] {
  return list.map((application) => (application.id === updated.id ? updated : application));
}

/** Optimistic local patch, applied before the server confirms it. */
export function optimisticStagePatch(
  list: readonly ApplicationView[],
  id: string,
  patch: Partial<Pick<ApplicationView, 'stage'>>,
): readonly ApplicationView[] {
  return list.map((application) =>
    application.id === id ? { ...application, ...patch } : application,
  );
}

/** True once the server rejected a write because another device won the race (architecture.md §4). */
export function isVersionConflict(reason: unknown): boolean {
  return reason instanceof CoachApiError && reason.code === APPLICATION_VERSION_CONFLICT_CODE;
}

export function withoutKey<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

export function withKey<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

export function apiErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof CoachApiError ? reason.message : fallback;
}
