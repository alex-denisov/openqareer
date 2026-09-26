import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import {
  resolveCampaign,
  type CampaignResolution,
  type StoredCampaignSelection,
} from '../vacancies/campaign';
import { regionOfVacancy } from '../vacancies/vacancyGeography';
import type { RouteDeps } from './deps';

/**
 * Кампания = одна явная запись {роль(и), география} — не сборка из трёх
 * независимых источников (B247, срез 1). Явный выбор кандидата живёт в
 * `candidateWorkspace.campaign`; при его отсутствии `resolveCampaign` берёт
 * только принятые кандидатом роли (`confirmed`/`corrected`) и черновик
 * резюме — роли, лишь предложенные моделью и не принятые, подбор больше не
 * задают (найдено попутно к решению архитектора).
 *
 * Общий вход для `vacancyRoutes.ts` (подбор) и `campaignRoutes.ts` (чтение и
 * запись явного выбора) — оба обязаны видеть одну и ту же кампанию.
 */
export function readCampaign(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  /** Порог значимости роли (B247, срез 2) — есть только после чтения пула. */
  vacancyCountsByRole?: Readonly<Record<string, number>>,
): CampaignResolution {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const memory = snapshot?.memory ?? [];
  const resumeTargetRole = snapshot?.resume?.draft?.targetRole ?? null;
  const profileLocation = snapshot?.resume?.draft.candidate.contact?.location;

  const stored = candidateStore.getCandidateWorkspace(candidateId);
  const parsed = stored ? candidateWorkspaceSchema.safeParse(stored) : null;
  const inferredRegion = regionOfVacancy({ location: profileLocation });
  const profileRegions = inferredRegion
    ? [inferredRegion]
    : parsed?.success
      ? [...parsed.data.regions]
      : [];
  const explicit: StoredCampaignSelection | null =
    parsed?.success && parsed.data.campaign ? parsed.data.campaign : null;

  return resolveCampaign({
    memory: memory.map((m) => ({
      domain: m.domain,
      kind: m.kind,
      statement: m.statement,
      status: m.status,
    })),
    resumeTargetRole,
    profileRegions,
    explicit,
    auto: parsed?.success ? (parsed.data.campaign?.auto ?? null) : null,
    ...(vacancyCountsByRole ? { vacancyCountsByRole } : {}),
  });
}

/**
 * Плоский, сериализуемый вид кампании для ответа маршрута — баннер
 * расхождения профиль/кампания читает конкретные значения обеих сторон
 * отсюда, а не пересчитывает их сам (B247, срез 1).
 */
export function campaignMeta(campaign: CampaignResolution) {
  return {
    roles: { value: [...campaign.roles.value], origin: campaign.roles.origin },
    regions: { value: [...campaign.regions.value], origin: campaign.regions.origin },
    remoteOnly: campaign.remoteOnly,
    autoRoles: campaign.autoRoles.map((role) => ({ ...role })),
    divergence: {
      roles: campaign.divergence.roles
        ? {
            campaign: [...campaign.divergence.roles.campaign],
            profile: [...campaign.divergence.roles.profile],
          }
        : null,
      regions: campaign.divergence.regions
        ? {
            campaign: [...campaign.divergence.regions.campaign],
            profile: [...campaign.divergence.regions.profile],
          }
        : null,
    },
    ...(campaign.roleHypotheses
      ? { roleHypotheses: campaign.roleHypotheses.map((flag) => ({ ...flag })) }
      : {}),
  };
}

export type CampaignMeta = ReturnType<typeof campaignMeta>;
