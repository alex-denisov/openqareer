import { ontology } from '../../shared/roleOntology';
import { careerRoleId } from '../../shared/roleProposals';
import { rejectedCareerRoleIds } from '../routes/campaignContext';
import type { RouteDeps } from '../routes/deps';
import { candidateHasLlmAccess } from '../routes/helpers';
import type { StoredMemory } from '../data/candidateStore';
import { isVacancyFitEvidence } from '../domain/vacancyFit';
import {
  buildCampaignRoleSet,
  campaignFactsDigest,
  type CampaignRoleFact,
  type CampaignRoleLog,
} from './campaignRoleSet';

/** `resumeImport` names an imported place of work `<prefix>-exp-<n>`. */
const IMPORTED_POSITION_ID = /-exp-\d+$/u;

/**
 * Only evidence builds roles (03.11): consultant hypotheses and open questions named CTO forty
 * times for adenisov.test and counted like the candidate's own facts.
 */
export function campaignRoleFacts(memory: readonly StoredMemory[]): CampaignRoleFact[] {
  return memory.filter(isVacancyFitEvidence).map((fact) => ({
    ref: `memory:${fact.id}`,
    statement: fact.statement,
    domain: fact.domain,
    ...(IMPORTED_POSITION_ID.test(fact.id) ? { position: true } : {}),
  }));
}

/**
 * What the candidate declined: earlier dismissals plus roles removed on «Карьера». That removal is
 * stored by title (`career-role:<id>`), so it is matched against the role's names here.
 */
function declinedRoleIds(
  store: RouteDeps['candidateStore'],
  candidateId: string,
  dismissed: readonly string[] | undefined,
): string[] {
  const rejected = rejectedCareerRoleIds(store, candidateId);
  const removed = [...ontology.rolesById.values()]
    .filter((role) =>
      [role.titleEn, role.titleRu, ...role.variants.en, ...role.variants.ru].some((title) =>
        rejected.has(careerRoleId(title)),
      ),
    )
    .map((role) => role.id);
  return [...new Set([...(dismissed ?? []), ...removed])];
}

/** Пересборка меняет только машинную часть кампании. */
export async function rebuildCampaignRoles(
  deps: Pick<RouteDeps, 'candidateStore' | 'campaignRoleModel' | 'matchedPoolPrecompute'> &
    Partial<Pick<RouteDeps, 'config' | 'billingRepository'>>,
  candidateId: string,
  options: { readonly force?: boolean; readonly log?: CampaignRoleLog } = {},
): Promise<void> {
  const before = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!before) return;
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const facts = campaignRoleFacts(snapshot?.memory ?? []);
  if (!options.force && before.campaign?.auto?.factsDigest === campaignFactsDigest(facts)) return;
  const auto = await buildCampaignRoleSet({
    facts,
    // Заголовок импортированного профиля главнее: `targetDirection` — ответ
    // мастера первого запуска и бывает устаревшим («Product Manager» у VP, 25.09).
    profileTitle:
      snapshot?.resume?.draft.candidate?.headline?.trim() ||
      snapshot?.resume?.draft.targetRole?.trim() ||
      before.targetDirection,
    dismissed: declinedRoleIds(deps.candidateStore, candidateId, before.campaign?.dismissed),
    model: candidateHasLlmAccess(deps, candidateId) ? deps.campaignRoleModel : undefined,
    ...(options.log ? { log: options.log } : {}),
  });
  const latest = deps.candidateStore.getCandidateWorkspace(candidateId);
  if (!latest) return;
  deps.candidateStore.saveCandidateWorkspace(candidateId, {
    ...latest,
    campaign: {
      // Остальные поля кампании (remoteOnly и будущие) — выбор кандидата, пересборка их не трогает.
      ...latest.campaign,
      // Без явного выбора кандидата его поля остаются пустыми: иначе регионы
      // рабочего пространства выглядели бы правкой кандидата (origin explicit).
      roles: latest.campaign?.roles ?? [],
      regions: latest.campaign?.regions ?? [],
      revision: latest.campaign?.revision ?? 1,
      updatedAt: latest.campaign?.updatedAt ?? new Date().toISOString(),
      ...(latest.campaign?.dismissed ? { dismissed: latest.campaign.dismissed } : {}),
      auto: {
        ...auto,
        roles: auto.roles.map((role) => ({
          ...role,
          functions: [...role.functions],
          synonyms: [...role.synonyms],
          evidenceRefs: [...role.evidenceRefs],
        })),
      },
    },
  });
  options.log?.({ builtBy: auto.model, roles: auto.roles.length }, 'campaign-roles-rebuilt');
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidateId);
}
