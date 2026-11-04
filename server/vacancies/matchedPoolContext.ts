import { createHash } from 'node:crypto';
import type { RouteDeps } from '../routes/deps';
import type { deriveCandidateTargetLevel } from './candidateLevel';
import { MatchedPoolSnapshots, type MatchedPoolReadOptions } from './matchedPoolSnapshot';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { matchGeographyKey, type MatchGeography } from './matchGeography';
import { candidateGradeRange, type GradeRange } from './titleParse/gradeRange';

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
  geography?: MatchGeography,
  gradeRange?: GradeRange | null,
): string {
  const base = `${matchProfileKey(confirmedSkills, targetRoles)}:${targetLevel ?? ''}`;
  const placed = geography ? `${base}:${matchGeographyKey(geography)}` : base;
  return gradeRange ? `${placed}:g${gradeRange.min}-${gradeRange.max}` : placed;
}

/**
 * Пилот диапазонов грейдов (этап 1, 04.11): сначала для adenisov.test. Для всех — отдельной правкой,
 * после защиты от массовых пересчётов: новые строки в окне подбора ставят процент в очередь.
 */
const GRADE_RANGE_PILOT: ReadonlySet<string> = new Set(['81d104dc-b165-4042-a1f9-ee4f316ecbfd']);

type RecentTitlesReader = (candidateId: string) => readonly string[];
const recentTitlesReaders = new WeakMap<RouteDeps['multiSourceEngine'], RecentTitlesReader>();

/** Последние места работы для диапазона грейда: их знает хранилище кандидата, а не движок подбора. */
export function setMatchedRecentTitlesReader(
  engine: RouteDeps['multiSourceEngine'],
  reader: RecentTitlesReader,
): void {
  recentTitlesReaders.set(engine, reader);
}

function gradeRangeOf(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
  targetRoles: readonly string[],
): GradeRange | null {
  if (!GRADE_RANGE_PILOT.has(candidateId)) return null;
  return candidateGradeRange({
    targetRoles,
    recentTitles: recentTitlesReaders.get(engine)?.(candidateId) ?? [],
  });
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
  geography?: MatchGeography,
): MatchedVacancyItem[] | undefined {
  const snapshots = matchedPoolSnapshots.get(engine);
  if (!snapshots) return undefined;
  return snapshots.peek(
    candidateId,
    matchedSnapshotKey(confirmedSkills, targetRoles, targetLevel, geography),
  );
}

/** Кампания сохранена — снимок прежней кампании не должен пережить запись. */
export function invalidateMatchedVacancies(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
): void {
  matchedPoolSnapshots.get(engine)?.deleteCandidate(candidateId);
}

/** A shared pool enrichment can change ranking for every candidate; reads keep the old list. */
export function markMatchedVacanciesStale(engine: RouteDeps['multiSourceEngine']): void {
  matchedPoolSnapshots.get(engine)?.markAllStale();
}

function snapshotsOf(engine: RouteDeps['multiSourceEngine']): MatchedPoolSnapshots {
  const known = matchedPoolSnapshots.get(engine);
  if (known) return known;
  const created = new MatchedPoolSnapshots();
  matchedPoolSnapshots.set(engine, created);
  return created;
}

/** A rebuild behind an expired snapshot has no request to fail: its failure goes here. */
export function setMatchedSnapshotFailureLog(
  engine: RouteDeps['multiSourceEngine'],
  log: (error: unknown) => void,
): void {
  snapshotsOf(engine).setRebuildFailureLog(log);
}

export function readMatchedSnapshot(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
  confirmedSkills: string[],
  targetRoles: string[],
  targetLevel: ReturnType<typeof deriveCandidateTargetLevel>,
  geography?: MatchGeography,
  options: MatchedPoolReadOptions = {},
): Promise<MatchedVacancyItem[]> {
  const gradeRange = gradeRangeOf(engine, candidateId, targetRoles);
  return snapshotsOf(engine).readAsync(
    candidateId,
    matchedSnapshotKey(confirmedSkills, targetRoles, targetLevel, geography, gradeRange),
    () =>
      engine.getMatchedVacanciesAsync({
        candidateId,
        targetRoles,
        confirmedSkills,
        confirmedFacts: confirmedSkills,
        preferredRemote: true,
        ...(targetLevel ? { targetLevel } : {}),
        ...(geography ? { matchGeography: geography } : {}),
        ...(gradeRange ? { gradeRange } : {}),
      }),
    options,
  );
}
