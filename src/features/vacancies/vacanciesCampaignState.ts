import { useEffect, useState } from 'react';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import type { VacanciesScreenState } from './VacanciesScreenFilters';

type SetScreenState = (update: (current: VacanciesScreenState) => VacanciesScreenState) => void;

/** The campaign the screen shows: the server's one, replaced at once by a local update. */
export function useActiveCampaign(campaign?: CampaignMetaView) {
  const [active, setActive] = useState(campaign);
  useEffect(() => {
    if (campaign) setActive(campaign);
  }, [campaign]);
  return [active, setActive] as const;
}

function applyCampaignUpdate(
  campaign: CampaignMetaView,
  addedRole: string | undefined,
  setCampaign: ReturnType<typeof useActiveCampaign>[1],
  setScreenState: SetScreenState,
) {
  setCampaign(campaign);
  setScreenState((current: VacanciesScreenState) => ({
    ...current,
    roles: addedRole ? [...current.roles, addedRole] : current.roles,
    regions: current.regions,
    remoteOnly: current.remoteOnly,
  }));
}

export function campaignUpdateHandler(
  setCampaign: ReturnType<typeof useActiveCampaign>[1],
  setScreenState: SetScreenState,
) {
  return (updated: CampaignMetaView, addedRole: string | undefined) =>
    applyCampaignUpdate(updated, addedRole, setCampaign, setScreenState);
}

