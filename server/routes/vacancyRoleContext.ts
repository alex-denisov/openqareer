import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { resolveRoleNameLanguage, type RoleNameLanguage } from '../domain/roleNameLanguage';
import { dropOrganisationTitles } from '../domain/roleNaming';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { NamedRole, ProposedRole } from '../../shared/roleProposals';
import { WORK_PREFERENCE_KEY_VERSION } from '../../shared/workPreferences';
import type { StrategyConstraints } from '../../shared/careerStrategy';
import type { RoleNamingStageFailure } from '../providers/roleNamer';
import { MatchedPoolSnapshots } from '../vacancies/matchedPoolSnapshot';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { buildRoleProposals } from '../vacancies/roleHypotheses';
import { deriveCandidateTargetLevel } from '../vacancies/candidateLevel';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';

/**
 * Роли и всё, что о них известно, — один расчёт на два маршрута.
 *
 * Панель их показывает, выбор стратегии из них выбирает (B180, срез 2), и
 * считаться они обязаны одинаково: иначе кандидат выберет одну роль, а
 * сохранится другая. `null` означает ровно одно — спрашивать некого, потому
 * что профиль ещё не подтверждён (B161).
 */
export interface RoleContext {
  readonly proposals: readonly ProposedRole[];
  readonly matched: readonly MatchedVacancyItem[];
  readonly poolSize: number;
  readonly namedBy: string | null;
  readonly language: RoleNameLanguage;
  readonly confirmedSkills: readonly string[];
  readonly constraints: StrategyConstraints;
}

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
 * Целевой уровень кандидата (B248, срез «подключение уровня»): роль кампании
 * важнее прошлой должности — кандидат вправе целиться выше своего опыта, и
 * fit-dot «уровень» обязан мерить его заявленную цель, а не только прошлое.
 */
export function readTargetLevel(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  targetRoles: readonly string[],
) {
  const experience = candidateStore.getSnapshot(candidateId)?.resume?.draft.experience ?? [];
  return deriveCandidateTargetLevel({ targetRoles, experience });
}

/**
 * Отпечаток того, из чего считается подбор.
 *
 * Сменился профиль — сменился и снимок: иначе кандидат, подтвердивший навык,
 * дочитывал бы старый подбор до конца срока жизни снимка.
 */
function matchProfileKey(confirmedSkills: readonly string[], targetRoles: readonly string[]): string {
  return createHash('sha256')
    .update(
      [[...confirmedSkills].sort().join('\u0000'), [...targetRoles].sort().join('\u0000')].join(
        '\u0001',
      ),
    )
    .digest('hex')
    .slice(0, 16);
}

// Ответы на задания меняют порядок ролей одного яруса и никогда — состав
// (B180, срез 3). Прогон по прежней версии ключа в счёт не идёт: смена
// формулировок меняет смысл сохранённых ответов.
function currentWorkPreferences(candidateStore: RouteDeps['candidateStore'], candidateId: string) {
  const run = candidateStore.getWorkPreferenceRun(candidateId);
  return run && run.keyVersion === WORK_PREFERENCE_KEY_VERSION ? run.result : undefined;
}

/** Ограничения кандидата — его собственный текст; пусто честнее выдуманного. */
function readConstraintNote(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): string | null {
  const stored = candidateStore.getCandidateWorkspace(candidateId);
  if (!stored) return null;
  const parsed = candidateWorkspaceSchema.safeParse(stored);
  const note = parsed.success ? parsed.data.constraints.trim() : '';
  return note.length > 0 ? note : null;
}

/**
 * Молчание ступени не роняет панель, но безымянным быть не должно: без кода
 * ответа исчерпанную квоту не отличить от таймаута тоннеля (INC-035).
 *
 * Кандидату причина не нужна — она уходит в лог сервера и в окно последних
 * отказов для администратора: прод-лог снаружи не читается.
 */
function reportRoleNamingFailures(
  request: FastifyRequest,
  log: RouteDeps['roleNamingFailures'],
  failures: readonly RoleNamingStageFailure[],
): void {
  for (const failure of failures) {
    request.log.warn(failure, 'role-naming-stage-failed');
  }
  log.record(failures);
}

/** Организации кандидата по сохранённому резюме: работодатели и вузы. */
function candidateOrganisations(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): string[] {
  const draft = candidateStore.getSnapshot(candidateId)?.resume?.draft;
  if (!draft) return [];
  return [
    ...draft.experience.map((entry) => entry.employer ?? ''),
    ...draft.education.map((entry) => entry.institution ?? ''),
  ].filter((name) => name.trim().length > 0);
}

/** Факты, по которым модель называет роль: своя ссылка у каждого. */
function candidateFacts(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): Array<{ ref: string; statement: string }> {
  return (candidateStore.getSnapshot(candidateId)?.memory ?? [])
    .filter((memory) => memory.status !== 'corrected')
    .map((memory) => ({ ref: `memory:${memory.id}`, statement: memory.statement }));
}

/**
 * Снимки подбора живут на процессе: одно чтение пула — один список.
 *
 * Кабинет читает пул шестьюдесятью запросами (PRB-023), и пересчёт на каждый из
 * них стоил и времени, и правды: между страницами проходит опрос площадок, и
 * то же смещение указывает уже на другую запись (B211).
 */
const matchedPoolSnapshots = new WeakMap<RouteDeps['multiSourceEngine'], MatchedPoolSnapshots>();

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
    // Уровень входит в отпечаток снимка: смена целевой роли меняет и уровень,
    // и старый снимок с прежним fit-dot «уровень» не должен пережить это.
    `${matchProfileKey(confirmedSkills, targetRoles)}:${targetLevel ?? ''}`,
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

/**
 * Имя роли даёт модель, читающая факты кандидата; пул приписывает к нему
 * доказательство или честное «пока не найдено» (B180, срез 1в). Роль без
 * вакансий с экрана не убирается: отсутствие вакансий — состояние наших
 * источников, а не приговор роли (решение владельца 2026-09-03).
 * Язык названия решает код, а не модель: иначе смена провайдера переписывает
 * кандидату его же роли (B180, решение владельца 2026-09-03).
 */
async function nameCandidateRoles(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  targetRoles: readonly string[],
  regions: readonly CandidateRegion[],
): Promise<{ language: RoleNameLanguage; named: NamedRole[]; namedBy: string | null }> {
  const { candidateStore, roleNamer, roleNamingFailures } = deps;
  const facts = candidateFacts(candidateStore, candidateId);
  const { language } = resolveRoleNameLanguage({
    searchRegions: regions,
    targetRoles,
    resumeText: facts.map((fact) => fact.statement).join(' '),
  });
  const naming = roleNamer
    ? await roleNamer.nameRoles(facts, language)
    : { roles: [] as NamedRole[] };
  reportRoleNamingFailures(request, roleNamingFailures, naming.failures ?? []);
  // Работодатель из резюме — не роль, что бы модель ни ответила (PRB-039).
  const named = dropOrganisationTitles(
    naming.roles,
    candidateOrganisations(candidateStore, candidateId),
  );
  return { language, named, namedBy: naming.stage ?? null };
}

export async function readRoleContext(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<RoleContext | null> {
  const { candidateStore, multiSourceEngine } = deps;
  const { confirmedSkills } = readMatchProfile(candidateStore, candidateId);
  const campaign = readCampaign(candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  // Без подтверждённого профиля подбора нет вовсе, а значит нет и рынка, по
  // которому можно назвать роль. Молчаливый пустой список сказал бы «рынок
  // ничего не назвал» там, где на самом деле некого спрашивать (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) return null;

  const targetLevel = readTargetLevel(candidateStore, candidateId, targetRoles);
  const matched = await readMatchedSnapshot(
    multiSourceEngine,
    candidateId,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );

  const regions = campaign.regions.value as CandidateRegion[];
  const { language, named, namedBy } = await nameCandidateRoles(
    deps,
    request,
    candidateId,
    targetRoles,
    regions,
  );

  const preferences = currentWorkPreferences(candidateStore, candidateId);

  return {
    proposals: buildRoleProposals({
      matched,
      named,
      candidateSkills: confirmedSkills,
      ...(preferences ? { preferences } : {}),
    }),
    matched,
    poolSize: matched.length,
    namedBy,
    language,
    confirmedSkills,
    constraints: {
      regions,
      // Дословно то, что кандидат написал; код это не разбирает и не толкует.
      note: readConstraintNote(candidateStore, candidateId),
    },
  };
}
