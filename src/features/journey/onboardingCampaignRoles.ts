import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { OnboardingCampaignRole } from './onboardingCampaignTypes';

export interface CampaignRoleTitle {
  readonly title: string;
  readonly titleRu?: string;
}

export function campaignRolesFromMeta(campaign: CampaignMetaView): OnboardingCampaignRole[] {
  return (campaign.autoRoles ?? []).map((role) => ({
    id: role.id,
    title: role.title,
    titleRu: role.titleRu,
    level: role.level,
    kind: role.kind,
    reason: role.reason,
    evidence: role.evidence,
    source: 'model',
  }));
}

export function findCampaignRoleByTitle<T extends CampaignRoleTitle>(
  roles: readonly T[],
  title: string,
): T | undefined {
  const wanted = normalizeTitle(title);
  if (!wanted) return undefined;
  return roles.find((role) => [role.title, role.titleRu].some((label) => normalizeTitle(label ?? '') === wanted));
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
}
