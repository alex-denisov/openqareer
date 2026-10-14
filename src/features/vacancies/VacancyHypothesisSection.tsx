import { useState } from 'react';
import type { CampaignMetaView } from '../coach/matchedVacancyApi';
import { CANDIDATE_REGION_CATALOGUE } from '../workspace/candidateRegions';
import { VacancyHypothesisBanner } from './VacancyHypothesisBanner';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';

interface VacancyHypothesisBoard {
  readonly primaryRole?: string;
  readonly regions: readonly string[];
}

export function VacancyHypothesisSection({
  campaign,
  board,
  actions,
}: {
  readonly campaign?: CampaignMetaView;
  readonly board: VacancyHypothesisBoard;
  readonly actions: ReturnType<typeof useVacancyCampaignActions>;
}) {
  const [regionsOpen, setRegionsOpen] = useState(false);
  const hypothesis = campaign?.roleHypotheses?.find(
    (item) => item.role === board.primaryRole && item.isHypothesis,
  );
  if (!hypothesis) return null;

  const adjacentRole = campaign?.autoRoles?.find(
    (role) => role.kind === 'adjacent' && !campaign.roles.value.includes(role.title),
  );
  const availableRegions = CANDIDATE_REGION_CATALOGUE.filter(
    (region) => !board.regions.includes(region.id),
  );
  return (
    <VacancyHypothesisBanner
      role={hypothesis.role}
      vacancyCount={hypothesis.vacancyCount}
      adjacentRole={adjacentRole}
      regionsChosenExplicitly={
        campaign?.regions.origin === 'explicit' && campaign.regions.value.length > 0
      }
      remoteOnly={campaign?.remoteOnly ?? false}
      saving={actions.saving}
      error={actions.error}
      onAddAdjacentRole={(role) => void actions.addAdjacentRole(role)}
      onAddRegion={(region) => {
        void actions.addRegion(region).then((saved) => {
          if (saved) setRegionsOpen(false);
        });
      }}
      onToggleRemote={() => void actions.toggleRemote()}
      regionsOpen={regionsOpen}
      onToggleRegions={() => setRegionsOpen((open) => !open)}
      availableRegions={availableRegions}
    />
  );
}
