import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { buildOnboardingWorkspaceInput } from './onboardingWorkspaceInput';
import { useOnboardingCampaign } from './useOnboardingCampaign';
import { useOnboardingWizardActions } from './useOnboardingWizardActions';
import { useOnboardingWizardDerived } from './useOnboardingWizardDerived';
import {
  useWizardClock,
  useWizardProfileInputState,
  useWizardReviewState,
  useWizardSourceState,
  useWizardStepState,
} from './useOnboardingWizardState';
import { useResumeIngestion } from './useResumeIngestion';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import { emptyTalk, type OnboardingWizardProps } from './onboardingWizardTypes';
import { stepInfo, type OnboardingBranch } from './onboardingWizardSteps';
import type { OnboardingCampaignRole } from './onboardingCampaignTypes';

function useWizardCore(props: OnboardingWizardProps) {
  const isDesktop = isTauriEnvironment();
  const hasAccount = props.hasAccount ?? false;
  const ingestion = useResumeIngestion(hasAccount);
  const steps = useWizardStepState(props.onStartedChange);
  const source = useWizardSourceState(isDesktop, hasAccount, ingestion.result);
  const profile = useWizardProfileInputState();
  const review = useWizardReviewState();
  const derived = useOnboardingWizardDerived({
    sourceChoice: source.sourceChoice,
    ingestion,
    connectedSource: source.connectedSource,
    isHhConnected: source.isHhConnected,
    isHhEmptyAccount: source.isHhEmptyAccount,
    isLinkedinConnected: source.isLinkedinConnected,
    typedResume: profile.typedResume,
  });
  const branch: OnboardingBranch = source.sourceChoice === 'none' ? 'talk' : 'file';
  return { props, isDesktop, hasAccount, ingestion, steps, source, profile, review, derived, branch };
}

function buildWorkspaceInput(
  core: ReturnType<typeof useWizardCore>,
  selectedRoleTitle?: string,
): WorkspaceInput {
  return buildOnboardingWorkspaceInput({
    sourceChoice: core.source.sourceChoice,
    ingested: core.derived.ingested,
    talk: emptyTalk,
    selectedRoleTitle,
    regions: core.profile.regions,
    format: core.profile.format,
    reviewOverrides: core.review.reviewOverrides,
    linkedinUrl: core.profile.linkedinUrl,
    hhUrl: core.profile.hhUrl,
  });
}

function buildActionInput(
  core: ReturnType<typeof useWizardCore>,
  campaign: ReturnType<typeof useOnboardingCampaign>,
  selectedRoleTitle: string | undefined,
  createWorkspaceInput: (role?: string) => WorkspaceInput,
) {
  return {
    ...core.props,
    hasAccount: core.hasAccount,
    ...core.source,
    ...core.steps,
    ...core.profile,
    isDesktop: core.isDesktop,
    sourceLock: core.derived.sourceLock,
    ingestion: core.ingestion,
    branch: core.branch,
    buildWorkspaceInput: createWorkspaceInput,
    selectedRoleTitle,
    selectedRoleIds: campaign.selectedRoleIds,
    campaignState: campaign.state,
    campaignRoles: campaign.roles,
    toggleRole: campaign.toggleRole,
    addRole: campaign.addRole,
    startCampaignRebuild: campaign.startCampaignRebuild,
    cancelCampaignRebuild: campaign.cancelCampaignRebuild,
    persistCampaignSelection: (
      roles?: readonly OnboardingCampaignRole[],
      selectedRoleIds?: readonly string[],
      primaryRole?: string,
    ) =>
      campaign.persistSelection(roles, selectedRoleIds, primaryRole ?? selectedRoleTitle),
  };
}

export function useOnboardingWizardModel(props: OnboardingWizardProps) {
  const core = useWizardCore(props);
  const createWorkspaceInput = (role?: string) =>
    buildWorkspaceInput(core, role ?? selectedRoleTitle);
  const campaign = useOnboardingCampaign({
    hasAccount: core.hasAccount,
    profileRoleOptions: core.derived.profileRoleOptions,
    regions: core.profile.regions,
    setRegions: core.profile.setRegions,
    buildWorkspaceInput: createWorkspaceInput,
  });
  const selectedRoleTitle = getSelectedRoleTitle(core, campaign);
  const actions = useOnboardingWizardActions(
    buildActionInput(core, campaign, selectedRoleTitle, createWorkspaceInput),
  );
  const clock = useWizardClock(core.steps.step, campaign.state);
  return {
    ...core.props,
    ...core.steps,
    ...core.source,
    ...core.profile,
    ...core.review,
    ...core.derived,
    ...clock,
    isDesktop: core.isDesktop,
    ingestion: core.ingestion,
    branch: core.branch,
    stepInfo: stepInfo(core.branch, core.steps.step),
    campaign,
    selectedRoleTitle,
    buildWorkspaceInput: createWorkspaceInput,
    actions,
    props: core.props,
  };
}

function getSelectedRoleTitle(
  core: ReturnType<typeof useWizardCore>,
  campaign: ReturnType<typeof useOnboardingCampaign>,
): string | undefined {
  return (
    campaign.roles.find((role) => campaign.selectedRoleIds.includes(role.id))?.title ??
    (core.profile.quickRole.trim() || core.derived.profileRoleTitle)
  );
}
