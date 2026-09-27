import type { ChangeEvent, Dispatch, SetStateAction } from 'react';
import type { CandidateRegion } from '../workspace/candidateRegions';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import { disconnectConnection } from '../coach/coachApi';
import { closeConnectorSession, resetConnectorSession } from '../connections/connectorSession';
import type { HhResumeItem } from '../connections/hhSessionPoll';
import { parseResumeContent } from '../workspace/resumeParser';
import type { ParsedResume } from '../workspace/resumeParserTypes';
import type { useResumeIngestion } from './useResumeIngestion';
import type { SourceChoice } from './IntakeSourceStep';
import type { ConnectedProfileSource } from './connectedProfileSource';
import type { OnboardingCampaignRole, OnboardingCampaignState } from './onboardingCampaignTypes';
import type { OnboardingFormat } from './onboardingFormat';
import { nextStep, previousStep, type OnboardingBranch, type OnboardingStepId } from './onboardingWizardSteps';

type Ingestion = ReturnType<typeof useResumeIngestion>;

export interface OnboardingWizardActionsInput {
  readonly isDesktop: boolean;
  readonly hasAccount: boolean;
  readonly onSignIn?: () => void;
  readonly onComplete: (input: WorkspaceInput) => void;
  readonly sourceChoice: SourceChoice;
  readonly setSourceChoice: (choice: SourceChoice) => void;
  readonly sourceLock: { readonly lockedTo?: SourceChoice; readonly reason?: string };
  readonly ingestion: Ingestion;
  readonly typedResume: string;
  readonly setTypedResume: (value: string) => void;
  readonly connectedSource?: ConnectedProfileSource;
  readonly setConnectedSource: (source: ConnectedProfileSource | undefined) => void;
  readonly isHhConnected: boolean;
  readonly setHhConnected: (value: boolean) => void;
  readonly setHhEmptyAccount: (value: boolean) => void;
  readonly isLinkedinConnected: boolean;
  readonly setLinkedinConnected: (value: boolean) => void;
  readonly setLinkedinUrl: (value: string) => void;
  readonly setHhUrl: (value: string) => void;
  readonly setLinkedinModalOpen: (value: boolean) => void;
  readonly setHhModalOpen: (value: boolean) => void;
  readonly quickRole: string;
  readonly regions: readonly CandidateRegion[];
  readonly setRegions: Dispatch<SetStateAction<readonly CandidateRegion[]>>;
  readonly format: OnboardingFormat;
  readonly setFormat: (value: OnboardingFormat) => void;
  readonly setError: (message: string | undefined) => void;
  readonly step: OnboardingStepId;
  readonly setStep: (step: OnboardingStepId) => void;
  readonly branch: OnboardingBranch;
  readonly buildWorkspaceInput: (primaryRole?: string) => WorkspaceInput;
  readonly selectedRoleTitle?: string;
  readonly selectedRoleIds: readonly string[];
  readonly campaignState: OnboardingCampaignState;
  readonly campaignRoles: readonly OnboardingCampaignRole[];
  readonly toggleRole: (roleId: string) => void;
  readonly addRole: (title: string) => void;
  readonly startCampaignRebuild: () => Promise<void>;
  readonly cancelCampaignRebuild: () => void;
  readonly persistCampaignSelection: (
    roles?: readonly OnboardingCampaignRole[],
    selectedRoleIds?: readonly string[],
    primaryRole?: string,
  ) => Promise<void>;
}

function chooseWizardSource(input: OnboardingWizardActionsInput, next: SourceChoice): void {
  if (next === input.sourceChoice) return;
  if (input.sourceLock.lockedTo && input.sourceLock.lockedTo !== next) return;
  input.setSourceChoice(next);
  input.setError(undefined);
  if (next !== 'text') input.setTypedResume('');
  input.ingestion.clear();
}

function clearPlatformState(input: OnboardingWizardActionsInput, platform: 'hh' | 'linkedin'): void {
  if (platform === 'hh') {
    input.setHhConnected(false);
    input.setHhEmptyAccount(false);
  } else {
    input.setLinkedinConnected(false);
  }
}

async function disconnectWizardPlatform(
  input: OnboardingWizardActionsInput,
  platform: 'hh' | 'linkedin',
): Promise<void> {
  const serverHeld = input.connectedSource?.platform === platform;
  try {
    await disconnectConnection(platform);
  } catch {
    if (serverHeld) input.setError(`Отключить ${platform === 'hh' ? 'hh.ru' : 'LinkedIn'} не удалось.`);
  }
  await resetConnectorSession(platform).catch(() => false);
  clearPlatformState(input, platform);
  input.setConnectedSource(undefined);
  input.setLinkedinModalOpen(false);
  input.setHhModalOpen(false);
  void closeConnectorSession('linkedin').catch(() => undefined);
  void closeConnectorSession('hh').catch(() => undefined);
  input.ingestion.clear();
}

function releaseWizardSource(input: OnboardingWizardActionsInput): void {
  input.setSourceChoice('pdf');
  input.setTypedResume('');
  input.ingestion.clear();
}

async function advanceWizardSource(input: OnboardingWizardActionsInput): Promise<void> {
  const { sourceChoice, ingestion, typedResume, connectedSource, isDesktop, branch, step, setStep, setError } = input;
  if (sourceChoice === 'profile-import' && !ingestion.result && !connectedSource) {
    setError(isDesktop
      ? 'Подключите профиль с площадки или выберите PDF, либо «Расскажу сам».'
      : 'Подключение площадок доступно в приложении для компьютера. Выберите PDF, либо «Расскажу сам».');
    return;
  }
  if (sourceChoice === 'pdf' && !ingestion.result) {
    setError('Загрузите PDF или выберите другой источник.');
    return;
  }
  if (sourceChoice === 'text') {
    if (typedResume.trim().length < 80) {
      setError('Добавьте хотя бы 80 знаков, чтобы собрать профиль из текста.');
      return;
    }
    await ingestion.acceptParsed(parseResumeContent(typedResume), 'text');
  }
  setStep(nextStep(branch, step) ?? step);
}

async function saveQuickWizardCampaign(input: OnboardingWizardActionsInput): Promise<void> {
  const title = input.quickRole.trim();
  if (!title) return input.setError('Укажите роль, по которой ищете работу.');
  if (input.regions.length === 0) return input.setError('Выберите хотя бы один регион.');
  if (!input.hasAccount) {
    input.setError('Войдите, чтобы сохранить роли и открыть подборку.');
    input.onSignIn?.();
    return;
  }
  const role: OnboardingCampaignRole = { id: 'candidate-quick-role', title, source: 'candidate' };
  try {
    await input.persistCampaignSelection([role], [role.id], title);
    input.setStep('done');
  } catch {
    input.setError('Не удалось сохранить кампанию. Проверьте соединение и повторите.');
  }
}

async function confirmWizardCampaign(input: OnboardingWizardActionsInput): Promise<void> {
  if (input.campaignState === 'loading') return;
  if (input.selectedRoleIds.length === 0) return input.setError('Выберите или добавьте хотя бы одну роль.');
  if (input.regions.length === 0) return input.setError('Выберите хотя бы один регион.');
  if (!input.hasAccount) {
    input.setError('Войдите, чтобы сохранить кампанию и открыть подборку.');
    input.onSignIn?.();
    return;
  }
  try {
    await input.persistCampaignSelection();
    input.setStep('done');
  } catch {
    input.setError('Не удалось сохранить кампанию. Проверьте соединение и повторите.');
  }
}

async function advanceWizard(input: OnboardingWizardActionsInput): Promise<void> {
  input.setError(undefined);
  if (input.step === 'source') return advanceWizardSource(input);
  if (input.step === 'talk') return saveQuickWizardCampaign(input);
  if (input.step === 'review') {
    input.setStep('campaign');
    void input.startCampaignRebuild();
    return;
  }
  if (input.step === 'campaign') return confirmWizardCampaign(input);
  input.setStep(nextStep(input.branch, input.step) ?? input.step);
}

function goBackWizard(input: OnboardingWizardActionsInput): void {
  input.setError(undefined);
  if (input.step === 'campaign') input.cancelCampaignRebuild();
  const previous = previousStep(input.branch, input.step);
  if (previous) input.setStep(previous);
}

export function useOnboardingWizardActions(input: OnboardingWizardActionsInput) {
  return {
    chooseSource: (choice: SourceChoice) => chooseWizardSource(input, choice),
    disconnectPlatform: (platform: 'hh' | 'linkedin') => disconnectWizardPlatform(input, platform),
    releaseSource: () => releaseWizardSource(input),
    onPickPdf: (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void input.ingestion.readPdf(file);
    },
    onLinkedinImported: async (parsed: ParsedResume, url: string) => {
      input.setLinkedinUrl(url);
      await input.ingestion.acceptParsed(parsed, 'linkedin-pdf', {
        platform: 'linkedin',
        accessMode: 'native_session_snapshot',
        sourceUrl: url,
        capturedAt: new Date().toISOString(),
      });
      input.setLinkedinConnected(true);
    },
    onHhConnected: async (
      _resumes: readonly HhResumeItem[],
      parsed: ParsedResume,
      url: string,
    ) => {
      input.setHhEmptyAccount(false);
      await input.ingestion.acceptParsed(parsed, 'hh-pdf', {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: url,
        capturedAt: new Date().toISOString(),
      });
      input.setHhConnected(true);
      input.setHhUrl(url);
    },
    onHhAuthenticatedEmpty: () => {
      input.setHhConnected(true);
      input.setHhEmptyAccount(true);
    },
    toggleRegion: (region: CandidateRegion) => {
      input.setRegions((current) =>
        current.includes(region) ? current.filter((item) => item !== region) : [...current, region],
      );
    },
    goNext: () => advanceWizard(input),
    goBack: () => goBackWizard(input),
    complete: () => input.onComplete(input.buildWorkspaceInput()),
  };
}
