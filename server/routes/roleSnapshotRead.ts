import type { RouteDeps } from './deps';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import type { MatchedPoolReadOptions } from '../vacancies/matchedPoolSnapshot';
import { VacancyMatchUnavailable } from '../vacancies/vacancyMatchReader';
import { readRoleLevel } from './vacancyRoleContext';

export type MatchedRoleSnapshot =
  | { readonly state: 'source_unavailable' }
  | {
      readonly state: 'matched';
      readonly vacancies: Awaited<ReturnType<typeof readMatchedSnapshot>>;
    };

/**
 * B770 (prod 23.11 04:47Z): seven roles of «Карьера» right after a restart had no stored snapshot,
 * and each waited the full 12 s while the match reader was busy. The screen answers «считаем»
 * after this wait instead; the snapshot is built behind it.
 */
export const CURRENT_SNAPSHOT_WAIT_MS = 1_500;

const isMatchTimeout = (error: unknown): boolean =>
  error instanceof VacancyMatchUnavailable && error.message === 'vacancy_match_timeout';

export async function readRoleSnapshot(
  deps: RouteDeps,
  candidateId: string,
  roleTitle: string,
  options: MatchedPoolReadOptions = {},
): Promise<MatchedRoleSnapshot> {
  return (
    (await readRoleSnapshotOrCounting(deps, candidateId, roleTitle, options)) ?? {
      state: 'source_unavailable',
    }
  );
}

/** `undefined`: the reader named its own wait and the snapshot is still being built (B770). */
export async function readRoleSnapshotOrCounting(
  deps: RouteDeps,
  candidateId: string,
  roleTitle: string,
  options: MatchedPoolReadOptions,
): Promise<MatchedRoleSnapshot | undefined> {
  const targetRoles = [roleTitle];
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const targetLevel = readRoleLevel(deps.candidateStore, candidateId, roleTitle);
  try {
    const vacancies = await readMatchedSnapshot(
      deps.multiSourceEngine,
      candidateId,
      confirmedSkills,
      targetRoles,
      targetLevel,
      undefined,
      options,
    );
    return { state: 'matched', vacancies };
  } catch (error) {
    // Only a reader that named its own wait gets «counting»; the build goes on behind the answer.
    const counting = options.waitMs !== undefined && isMatchTimeout(error);
    return counting ? undefined : { state: 'source_unavailable' };
  }
}
