import type { FastifyRequest } from 'fastify';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { resolveRoleNameLanguage, type RoleNameLanguage } from '../domain/roleNameLanguage';
import { dropOrganisationTitles } from '../domain/roleNaming';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { NamedRole, ProposedRole } from '../../shared/roleProposals';
import { WORK_PREFERENCE_KEY_VERSION } from '../../shared/workPreferences';
import type { StrategyConstraints } from '../../shared/careerStrategy';
import type { RoleNamingStageFailure } from '../providers/roleNamer';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { buildRoleProposals } from '../vacancies/roleHypotheses';
import { sameCareerRole } from '../vacancies/careerRoleKey';
import { deriveCandidateTargetLevel } from '../vacancies/candidateLevel';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import { candidateHasLlmAccess } from './helpers';

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
  const workspace = candidateStore.getCandidateWorkspace(candidateId);
  const automaticRoles = workspace?.campaign?.auto?.roles ?? [];
  const automaticPrimary = automaticRoles.find((role) => role.kind === 'primary') ?? automaticRoles[0];
  return deriveCandidateTargetLevel({
    targetRoles,
    experience,
    ...(automaticPrimary?.level ? { campaignLevel: automaticPrimary.level } : {}),
  });
}

// Ответы на задания меняют порядок ролей одного яруса и никогда — состав
// (B180, срез 3). Прогон по прежней версии ключа в счёт не идёт: смена
// формулировок меняет смысл сохранённых ответов.
/** Факты-места работы: одной ссылки на такой факт роли модели хватает (28.10). */
function workplaceMemoryRefs(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): Set<string> {
  const experience = candidateStore.getSnapshot(candidateId).resume?.draft.experience ?? [];
  return new Set(
    experience
      .flatMap((place) => [place.chronologyMemoryId, place.descriptionMemoryId])
      .filter((id): id is string => Boolean(id))
      .map((id) => (id.startsWith('memory:') ? id : `memory:${id}`)),
  );
}

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
  const naming = roleNamer && candidateHasLlmAccess(deps, candidateId)
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

/**
 * Рынки для языка названий ролей. Пустой список регионов кампании — «без
 * ограничения», а не «рынок неизвестен»: тогда язык решает регион из города
 * профиля, иначе руководителю из Кирова модель называла роли по-английски (29.10).
 */
export function roleLanguageRegions(
  campaign: Pick<ReturnType<typeof readCampaign>, 'regions' | 'suggestedRegions'>,
): CandidateRegion[] {
  const explicit = campaign.regions.value as CandidateRegion[];
  return explicit.length > 0
    ? explicit
    : ([...(campaign.suggestedRegions ?? [])] as CandidateRegion[]);
}

/**
 * Проверка навыков хранится под названием роли на момент проверки. Модель
 * может назвать ту же роль иначе («Операционный директор (COO)» →
 * «Операционный директор»), и проверка терялась бы: её название становится
 * синонимом роли той же функции и уровня (29.10).
 */
export function withCheckedRoleAliases(
  proposals: readonly ProposedRole[],
  checkedTitles: readonly string[],
): ProposedRole[] {
  return proposals.map((proposal) => {
    const known = new Set(
      [proposal.title, ...(proposal.aliases ?? [])].map((name) => name.trim().toLowerCase()),
    );
    const added = checkedTitles.filter(
      (title) => !known.has(title.trim().toLowerCase()) && sameCareerRole(title, proposal.title),
    );
    return added.length
      ? { ...proposal, aliases: [...(proposal.aliases ?? [proposal.title]), ...added] }
      : proposal;
  });
}

function completedCheckTitles(deps: RouteDeps, candidateId: string): string[] {
  return (deps.candidateStore.roleSkillAssessments?.list(candidateId) ?? [])
    .filter((run) => run.status === 'complete' && run.completedAt)
    .map((run) => run.roleTitle);
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
    roleLanguageRegions(campaign),
  );

  const preferences = currentWorkPreferences(candidateStore, candidateId);
  const workplaceRefs = workplaceMemoryRefs(candidateStore, candidateId);

  return {
    proposals: withCheckedRoleAliases(
      buildRoleProposals({
        matched,
        named,
        candidateSkills: confirmedSkills,
        workplaceRefs,
        ...(preferences ? { preferences } : {}),
      }),
      completedCheckTitles(deps, candidateId),
    ),
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
