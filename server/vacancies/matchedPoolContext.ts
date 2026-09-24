import { createHash } from 'node:crypto';
import type { RouteDeps } from '../routes/deps';
import type { deriveCandidateTargetLevel } from './candidateLevel';
import { MatchedPoolSnapshots } from './matchedPoolSnapshot';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/** Подтверждённые навыки кандидата — то, по чему вообще можно сопоставлять. */
export function readMatchProfile(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): { confirmedSkills: string[] } {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const memory = snapshot?.memory ?? [];
  const confirmedSkills = memory
    .filter(
      (m) => m.kind === 'fact' && (m.domain === 'skill' || m.confidence === 'candidate-confirmed'),
    )
    .map((m) => m.statement);

  return { confirmedSkills };
}

/**
 * Отпечаток того, из чего считается подбор.
 *
 * Сменился профиль — сменился и снимок: иначе кандидат, подтвердивший навык,
 * дочитывал бы старый подбор до конца срока жизни снимка.
 */
function matchProfileKey(
  confirmedSkills: readonly string[],
  targetRoles: readonly string[],
): string {
  return createHash('sha256')
    .update(
      [[...confirmedSkills].sort().join('\u0000'), [...targetRoles].sort().join('\u0000')].join(
        '\u0001',
      ),
    )
    .digest('hex')
    .slice(0, 16);
}

/**
 * Уровень входит в отпечаток снимка: смена целевой роли меняет и уровень,
 * и старый снимок с прежним fit-dot «уровень» не должен пережить это.
 */
export function matchedSnapshotKey(
  confirmedSkills: readonly string[],
  targetRoles: readonly string[],
  targetLevel: ReturnType<typeof deriveCandidateTargetLevel>,
): string {
  return `${matchProfileKey(confirmedSkills, targetRoles)}:${targetLevel ?? ''}`;
}

/**
 * Снимки подбора живут на процессе: одно чтение пула — один список.
 *
 * Кабинет читает пул шестьюдесятью запросами (PRB-023), и пересчёт на каждый из
 * них стоил и времени, и правды: между страницами проходит опрос площадок, и
 * то же смещение указывает уже на другую запись (B211).
 */
const matchedPoolSnapshots = new WeakMap<RouteDeps['multiSourceEngine'], MatchedPoolSnapshots>();

/**
 * `GET /today` (architecture.md §4, §57, §97): читает тот же снимок подбора,
 * что и кабинет, ничего не считая. Холодный кэш — `undefined`, а не
 * синхронный подбор в HTTP-обработчике (B230).
 */
export function peekMatchedVacancies(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
  confirmedSkills: string[],
  targetRoles: string[],
  targetLevel: ReturnType<typeof deriveCandidateTargetLevel>,
): MatchedVacancyItem[] | undefined {
  const snapshots = matchedPoolSnapshots.get(engine);
  if (!snapshots) return undefined;
  return snapshots.peek(candidateId, matchedSnapshotKey(confirmedSkills, targetRoles, targetLevel));
}

export function readMatchedSnapshot(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
  confirmedSkills: string[],
  targetRoles: string[],
  targetLevel: ReturnType<typeof deriveCandidateTargetLevel>,
): Promise<MatchedVacancyItem[]> {
  let snapshots = matchedPoolSnapshots.get(engine);
  if (!snapshots) {
    snapshots = new MatchedPoolSnapshots();
    matchedPoolSnapshots.set(engine, snapshots);
  }
  return snapshots.readAsync(
    candidateId,
    matchedSnapshotKey(confirmedSkills, targetRoles, targetLevel),
    () =>
      engine.getMatchedVacanciesAsync({
        candidateId,
        targetRoles,
        confirmedSkills,
        confirmedFacts: confirmedSkills,
        preferredRemote: true,
        ...(targetLevel ? { targetLevel } : {}),
      }),
  );
}
