import { useState } from 'react';
import {
  saveCandidateCampaign,
  type CampaignMetaView,
  type CandidateCampaignUpdate,
} from '../coach/matchedVacancyApi';
import type { CandidateRegion } from '../workspace/candidateRegions';

interface CampaignUpdateCallbacks {
  readonly onCampaignUpdated: (campaign: CampaignMetaView, selectedRole?: string) => void;
  readonly onRetry?: () => void;
}

export function useVacancyCampaignActions(
  campaign: CampaignMetaView | undefined,
  callbacks: CampaignUpdateCallbacks,
) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const roles = campaign?.roles.value ?? [];
  const regions = campaign?.regions.value ?? [];
  const remoteOnly = campaign?.remoteOnly ?? false;

  async function save(
    roles: readonly string[],
    regions: readonly string[],
    remoteOnly: boolean,
    selectedRole?: string,
  ): Promise<boolean> {
    if (!campaign) return false;
    setSaving(true);
    setError(undefined);
    try {
      const updated = await saveCandidateCampaign({
        roles: roleChoices(roles, campaign),
        regions,
        remoteOnly,
      });
      callbacks.onCampaignUpdated(updated, selectedRole);
      callbacks.onRetry?.();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить кампанию.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  const addAdjacentRole = (role: { readonly id: string; readonly title: string }) =>
    save([...roles, role.title], regions, remoteOnly, role.title);
  const addRegion = (region: CandidateRegion) => save(roles, [...regions, region], remoteOnly);
  const toggleRemote = () => save(roles, regions, !remoteOnly);
  const addCustomRole = (title: string): Promise<boolean> => {
    const trimmed = title.trim();
    if (!trimmed || roles.length >= 10 || roles.includes(trimmed)) return Promise.resolve(false);
    return save([...roles, trimmed], regions, remoteOnly, trimmed);
  };
  const removeRole = (title: string): Promise<boolean> => {
    const nextRoles = roles.filter((r) => r !== title);
    return save(nextRoles, regions, remoteOnly);
  };

  return { saving, error, addAdjacentRole, addRegion, toggleRemote, addCustomRole, removeRole };
}

function roleChoices(
  roles: readonly string[],
  campaign: CampaignMetaView,
): CandidateCampaignUpdate['roles'] {
  return roles.map((title) => {
    const proposal = campaign.autoRoles?.find((role) => role.title === title);
    return proposal ? { id: proposal.id, title: proposal.title } : title;
  });
}
