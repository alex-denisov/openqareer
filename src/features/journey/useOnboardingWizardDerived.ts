import { useMemo } from 'react';
import { intakeSourceLock } from './intakeSourceLock';
import type { ConnectedProfileSource } from './connectedProfileSource';
import type { SourceChoice } from './IntakeSourceStep';
import type { useResumeIngestion } from './useResumeIngestion';
import { buildOnboardingRoleCards } from './onboardingRoleCards';
import { buildProfileReviewRows } from './profileFactReviewRows';

type Ingestion = ReturnType<typeof useResumeIngestion>;

function sourceLabelFor(sourceChoice: SourceChoice, ingestedSource?: string): string {
  if (ingestedSource === 'linkedin-pdf') return 'из LinkedIn';
  if (ingestedSource === 'hh-pdf') return 'из hh.ru';
  if (sourceChoice === 'none') return 'со слов кандидата';
  return 'из резюме';
}

export function useOnboardingWizardDerived(input: {
  readonly sourceChoice: SourceChoice;
  readonly ingestion: Ingestion;
  readonly connectedSource?: ConnectedProfileSource;
  readonly isHhConnected: boolean;
  readonly isHhEmptyAccount: boolean;
  readonly isLinkedinConnected: boolean;
  readonly typedResume: string;
}) {
  const ingested = input.ingestion.result;
  const profileRoleTitle = ingested?.parsed.targetRole ?? ingested?.parsed.experience[0]?.title;
  const sourceLock = intakeSourceLock({
    ingestedSource: ingested?.source,
    ingestedImported: ingested?.imported,
    connectedPlatform:
      input.connectedSource?.platform ??
      (input.isHhConnected && !input.isHhEmptyAccount
        ? 'hh'
        : input.isLinkedinConnected
          ? 'linkedin'
          : undefined),
    typedLength: input.typedResume.trim().length,
  });
  const reviewRows = useMemo(() => buildReviewRows(input.sourceChoice, ingested), [ingested, input.sourceChoice]);
  const roleCards = useMemo(() => buildRoleCards(profileRoleTitle, ingested), [ingested, profileRoleTitle]);
  const profileRoleOptions = useMemo(() => buildProfileRoleOptions(roleCards), [roleCards]);

  return { ingested, profileRoleTitle, sourceLock, reviewRows, profileRoleOptions };
}

function buildReviewRows(sourceChoice: SourceChoice, ingested: Ingestion['result']) {
  return buildProfileReviewRows({
    experience: ingested?.parsed.experience ?? [],
    sourceLabel: sourceLabelFor(sourceChoice, ingested?.source),
    geoSummary: ingested?.parsed.contact.location,
    geoSourceLabel: sourceLabelFor(sourceChoice, ingested?.source),
  });
}

function buildRoleCards(profileRoleTitle: string | undefined, ingested: Ingestion['result']) {
  return buildOnboardingRoleCards({
    targetRole: profileRoleTitle,
    experience: ingested?.parsed.experience ?? [],
  });
}

function buildProfileRoleOptions(roleCards: ReturnType<typeof buildOnboardingRoleCards>) {
  return roleCards.map((card) => ({
    id: `profile-${card.id}`,
    title: card.title,
    titleRu: card.title,
    source: 'profile' as const,
    reason: 'Роль предложена по должностям из профиля.',
    evidence: card.evidenceTags,
  }));
}
