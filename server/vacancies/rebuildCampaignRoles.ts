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
    dismissed: before.campaign?.dismissed,
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
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidateId);
}
