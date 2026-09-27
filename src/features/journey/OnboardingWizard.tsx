import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { disconnectConnection, getConnections, putCandidateWorkspace } from '../coach/coachApi';
import {
  getCandidateCampaign,
  rebuildCandidateCampaignRoles,
  saveCandidateCampaign,
  type CandidateCampaignUpdate,
  type CampaignMetaView,
} from '../coach/matchedVacancyApi';
import { closeConnectorSession, resetConnectorSession } from '../connections/connectorSession';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import { isCandidateRegion, type CandidateRegion } from '../workspace/candidateRegions';
import { parseResumeContent } from '../workspace/resumeParser';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import { connectedProfileSource, type ConnectedProfileSource } from './connectedProfileSource';
import { IntakeSourceStep, type SourceChoice } from './IntakeSourceStep';
import { intakeSourceLock } from './intakeSourceLock';
import { OnboardingSourceCards } from './OnboardingSourceCards';
import { OnboardingProgressStep } from './OnboardingProgressStep';
import { type OnboardingTalkValues } from './OnboardingTalkStep';
import { OnboardingReviewStep } from './OnboardingReviewStep';
import { ONBOARDING_FORMAT_OPTIONS, type OnboardingFormat } from './onboardingFormat';
import {
  OnboardingCampaignStep,
  OnboardingQuickStartStep,
  type OnboardingCampaignRole,
  type OnboardingCampaignState,
} from './OnboardingCampaignStep';
import { rebuildAndWaitForModelCampaign } from './onboardingCampaign';
import { OnboardingDoneStep } from './OnboardingDoneStep';
import { OnboardingWizardChrome } from './OnboardingWizardChrome';
import { buildParseProgressCounts, buildProfileReviewRows } from './profileFactReviewRows';
import { buildOnboardingRoleCards } from './onboardingRoleCards';
import { buildOnboardingWorkspaceInput } from './onboardingWorkspaceInput';
import { formatOnboardingDuration, startOnboardingTimer } from './onboardingTimer';
import {
  nextStep as nextStepId,
  previousStep as previousStepId,
  stepInfo,
  type OnboardingBranch,
  type OnboardingStepId,
} from './onboardingWizardSteps';
import { useResumeIngestion } from './useResumeIngestion';

interface OnboardingWizardProps {
  readonly onComplete: (input: WorkspaceInput) => void;
  readonly hasAccount?: boolean;
  readonly onStartedChange?: (started: boolean) => void;
  readonly onSignIn?: () => void;
}

const emptyTalk: OnboardingTalkValues = { tasks: '', change: '', successMeasure: '' };

function sourceLabelFor(sourceChoice: SourceChoice, ingestedSource?: string): string {
  if (ingestedSource === 'linkedin-pdf') return 'из LinkedIn';
  if (ingestedSource === 'hh-pdf') return 'из hh.ru';
  if (sourceChoice === 'none') return 'со слов кандидата';
  return 'из резюме';
}

// One state machine drives the profile and profileless paths.
// eslint-disable-next-line max-lines-per-function
export function OnboardingWizard({
  onComplete,
  hasAccount = false,
  onStartedChange,
  onSignIn,
}: OnboardingWizardProps) {
  const isDesktop = isTauriEnvironment();
  const ingestion = useResumeIngestion(hasAccount);
  const timer = useRef(startOnboardingTimer());
  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState<OnboardingStepId>('source');
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(() =>
    isDesktop ? 'profile-import' : 'pdf',
  );
  const [typedResume, setTypedResume] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [isLinkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setHhModalOpen] = useState(false);
  const [isHhConnected, setHhConnected] = useState(false);
  const [isHhEmptyAccount, setHhEmptyAccount] = useState(false);
  const [isLinkedinConnected, setLinkedinConnected] = useState(false);
  const [connectedSource, setConnectedSource] = useState<ConnectedProfileSource>();
  const [quickRole, setQuickRole] = useState('');
  const [campaignRoles, setCampaignRoles] = useState<readonly OnboardingCampaignRole[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<readonly string[]>([]);
  const [campaignState, setCampaignState] = useState<OnboardingCampaignState>('loading');
  const [campaignStartedAt, setCampaignStartedAt] = useState(0);
  const [campaignError, setCampaignError] = useState<string>();
  const campaignRunId = useRef(0);
  const [regions, setRegions] = useState<readonly CandidateRegion[]>([]);
  const [format, setFormat] = useState<OnboardingFormat>(ONBOARDING_FORMAT_OPTIONS[0]);
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, string>>({});
  const [reviewEditingId, setReviewEditingId] = useState<string>();
  const [reviewDraft, setReviewDraft] = useState('');
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  const branch: OnboardingBranch = sourceChoice === 'none' ? 'talk' : 'file';
  const ingested = ingestion.result;
  const profileRoleTitle = ingested?.parsed.targetRole ?? ingested?.parsed.experience[0]?.title;
  const selectedRoleTitle =
    campaignRoles.find((role) => selectedRoleIds.includes(role.id))?.title ??
    (quickRole.trim() || profileRoleTitle);

  // The account door on the rail is the only way an anonymous candidate can
  // register, and the first step (source choice) does not need an account
  // yet — only the import step after it does. So the shell keeps its chrome
  // until the candidate actually leaves the source step (B249).
  useEffect(() => {
    if (step !== 'source') onStartedChange?.(true);
  }, [step, onStartedChange]);

  useEffect(() => {
    if (step !== 'done' && !(step === 'campaign' && campaignState === 'loading')) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step, campaignState]);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [error]);

  useEffect(() => {
    if (!hasAccount || sourceChoice !== 'profile-import' || ingested) return;
    let active = true;
    void getConnections()
      .then((connections) => {
        if (!active) return;
        const snapshot = connectedProfileSource(connections);
        if (snapshot) setConnectedSource(snapshot);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hasAccount, sourceChoice, ingested]);

  const sourceLock = intakeSourceLock({
    ingestedSource: ingested?.source,
    ingestedImported: ingested?.imported,
    connectedPlatform:
      connectedSource?.platform ??
      (isHhConnected && !isHhEmptyAccount ? 'hh' : isLinkedinConnected ? 'linkedin' : undefined),
    typedLength: typedResume.trim().length,
  });

  function chooseSource(next: SourceChoice) {
    if (next === sourceChoice) return;
    if (sourceLock.lockedTo && sourceLock.lockedTo !== next) return;
    setSourceChoice(next);
    setError(undefined);
    if (next !== 'text') setTypedResume('');
    ingestion.clear();
  }

  async function disconnectPlatform(platform: 'hh' | 'linkedin') {
    const serverHeld = connectedSource?.platform === platform;
    try {
      await disconnectConnection(platform);
    } catch {
      if (serverHeld) {
        setError(`Отключить ${platform === 'hh' ? 'hh.ru' : 'LinkedIn'} не удалось.`);
      }
    }
    await resetConnectorSession(platform).catch(() => false);
    setIsPlatformConnectedFalse(platform);
    setConnectedSource(undefined);
    setLinkedinModalOpen(false);
    setHhModalOpen(false);
    void closeConnectorSession('linkedin').catch(() => undefined);
    void closeConnectorSession('hh').catch(() => undefined);
    ingestion.clear();
  }

  function setIsPlatformConnectedFalse(platform: 'hh' | 'linkedin') {
    if (platform === 'hh') {
      setHhConnected(false);
      setHhEmptyAccount(false);
    } else {
      setLinkedinConnected(false);
    }
  }

  const reviewRows = useMemo(
    () =>
      buildProfileReviewRows({
        experience: ingested?.parsed.experience ?? [],
        sourceLabel: sourceLabelFor(sourceChoice, ingested?.source),
        geoSummary: ingested?.parsed.contact.location,
        geoSourceLabel: sourceLabelFor(sourceChoice, ingested?.source),
      }),
    [ingested, sourceChoice],
  );

  const roleCards = useMemo(
    () =>
      buildOnboardingRoleCards({
        targetRole: profileRoleTitle,
        experience: ingested?.parsed.experience ?? [],
      }),
    [ingested, profileRoleTitle],
  );

  const profileRoleOptions = useMemo(
    () =>
      roleCards.map((card) => ({
        id: `profile-${card.id}`,
        title: card.title,
        titleRu: card.title,
        source: 'profile' as const,
        reason: 'Роль предложена по должностям из профиля.',
        evidence: card.evidenceTags,
      })),
    [roleCards],
  );

  function buildWorkspaceInput(primaryRole = selectedRoleTitle): WorkspaceInput {
    return buildOnboardingWorkspaceInput({
      sourceChoice,
      ingested,
      talk: emptyTalk,
      selectedRoleTitle: primaryRole,
      regions,
      format,
      reviewOverrides,
      linkedinUrl,
      hhUrl,
    });
  }

  function setProfileRoleFallback(message?: string) {
    setCampaignRoles(profileRoleOptions);
    setSelectedRoleIds(profileRoleOptions.map((role) => role.id));
    setCampaignError(message);
    setCampaignState('fallback');
  }

  async function startCampaignRebuild() {
    const runId = ++campaignRunId.current;
    if (!hasAccount) {
      setProfileRoleFallback('Войдите, чтобы получить роли модели и сохранить подборку.');
      return;
    }

    try {
      const result = await rebuildAndWaitForModelCampaign({
        persistProfile: () => putCandidateWorkspace(buildWorkspaceInput()),
        requestRebuild: rebuildCandidateCampaignRoles,
        readCampaign: getCandidateCampaign,
      });
      if (runId !== campaignRunId.current) return;
      if (result.status === 'timeout') {
        setProfileRoleFallback();
        return;
      }

      const roles = campaignRolesFromMeta(result.campaign);
      setCampaignRoles(roles);
      setSelectedRoleIds(roles.map((role) => role.id));
      setCampaignError(undefined);
      setCampaignState('model');
      const inferredRegions = result.campaign.regions.value.filter(isCandidateRegion);
      if (regions.length === 0 && inferredRegions.length > 0) setRegions(inferredRegions);
    } catch {
      if (runId === campaignRunId.current) {
        setProfileRoleFallback('Не удалось получить роли модели. Продолжите с ролями из профиля.');
      }
    }
  }

  function toggleRegion(region: CandidateRegion) {
    setRegions((current) =>
      current.includes(region) ? current.filter((item) => item !== region) : [...current, region],
    );
  }

  function toggleRole(roleId: string) {
    setSelectedRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  }

  function addRole(title: string) {
    const normalized = title.trim();
    if (!normalized) return;
    const exists = campaignRoles.find(
      (role) => role.title.toLocaleLowerCase('ru') === normalized.toLocaleLowerCase('ru'),
    );
    if (exists) {
      setSelectedRoleIds((current) =>
        current.includes(exists.id) ? current : [...current, exists.id],
      );
      return;
    }
    const id = `candidate-${Date.now()}`;
    setCampaignRoles((current) => [...current, { id, title: normalized, source: 'candidate' }]);
    setSelectedRoleIds((current) => [...current, id]);
  }

  async function persistCampaignSelection(
    roles: readonly OnboardingCampaignRole[] = campaignRoles,
    selectedIds: readonly string[] = selectedRoleIds,
    primaryRole = selectedRoleTitle,
  ) {
    const payload: CandidateCampaignUpdate = {
      roles: roles
        .filter((role) => selectedIds.includes(role.id))
        .map((role) => (role.source === 'model' ? { id: role.id, title: role.title } : role.title)),
      regions,
      remoteOnly: false,
    };
    await putCandidateWorkspace(buildWorkspaceInput(primaryRole));
    await saveCandidateCampaign(payload);
  }

  async function advanceSource() {
    if (sourceChoice === 'profile-import' && !ingested && !connectedSource) {
      setError(
        isDesktop
          ? 'Подключите профиль с площадки или выберите PDF, либо «Расскажу сам».'
          : 'Подключение площадок доступно в приложении для компьютера. Выберите PDF, либо «Расскажу сам».',
      );
      return;
    }
    if (sourceChoice === 'pdf' && !ingested) {
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
    setStep(nextStepId(branch, step) ?? step);
  }

  async function saveQuickCampaign() {
    const title = quickRole.trim();
    if (!title) return setError('Укажите роль, по которой ищете работу.');
    if (regions.length === 0) return setError('Выберите хотя бы один регион.');
    if (!hasAccount) {
      setError('Войдите, чтобы сохранить роли и открыть подборку.');
      onSignIn?.();
      return;
    }

    const role: OnboardingCampaignRole = { id: 'candidate-quick-role', title, source: 'candidate' };
    try {
      await persistCampaignSelection([role], [role.id], title);
      setCampaignRoles([role]);
      setSelectedRoleIds([role.id]);
      setStep('done');
    } catch {
      setError('Не удалось сохранить кампанию. Проверьте соединение и повторите.');
    }
  }

  function requestModelRoles() {
    setCampaignStartedAt(Date.now());
    setCampaignError(undefined);
    setCampaignState('loading');
    setStep('campaign');
    void startCampaignRebuild();
  }

  async function confirmCampaign() {
    if (campaignState === 'loading') return;
    if (selectedRoleIds.length === 0) return setError('Выберите или добавьте хотя бы одну роль.');
    if (regions.length === 0) return setError('Выберите хотя бы один регион.');
    if (!hasAccount) {
      setError('Войдите, чтобы сохранить кампанию и открыть подборку.');
      onSignIn?.();
      return;
    }
    try {
      await persistCampaignSelection();
      setStep('done');
    } catch {
      setError('Не удалось сохранить кампанию. Проверьте соединение и повторите.');
    }
  }

  async function goNext() {
    setError(undefined);
    if (step === 'source') return advanceSource();
    if (step === 'talk') return saveQuickCampaign();
    if (step === 'review') return requestModelRoles();
    if (step === 'campaign') return confirmCampaign();
    setStep(nextStepId(branch, step) ?? step);
  }

  function goBack() {
    setError(undefined);
    if (step === 'campaign' && campaignState === 'loading') campaignRunId.current += 1;
    const previous = previousStepId(branch, step);
    if (previous) setStep(previous);
  }

  function complete() {
    onComplete(buildWorkspaceInput());
  }

  return (
    <section
      className="career-intake career-onboarding"
      data-step={step}
      aria-labelledby="onboarding-title"
    >
      <OnboardingWizardChrome
        step={stepInfo(branch, step)}
        title={titleFor(step)}
        description={descriptionFor(step)}
        onSkip={() => onComplete(buildDeferredWorkspaceInput())}
        onSignIn={hasAccount ? undefined : onSignIn}
      />

      {step === 'source' ? (
        <>
          <OnboardingSourceCards
            active={
              sourceChoice === 'pdf' || sourceChoice === 'text'
                ? 'pdf'
                : sourceChoice === 'none'
                  ? 'none'
                  : 'profile-import'
            }
            linkedinSelected={
              isLinkedinConnected || connectedSource?.platform === 'linkedin' || isLinkedinModalOpen
            }
            hhSelected={isHhConnected || connectedSource?.platform === 'hh' || isHhModalOpen}
            lockedTo={
              sourceLock.lockedTo === 'text'
                ? 'pdf'
                : sourceLock.lockedTo === 'profile-import' || sourceLock.lockedTo === 'pdf'
                  ? sourceLock.lockedTo
                  : undefined
            }
            lockReason={sourceLock.reason}
            onChoosePdf={() => chooseSource('pdf')}
            onChooseLinkedin={() => chooseSource('profile-import')}
            onChooseHh={() => chooseSource('profile-import')}
            onChooseTalk={() => chooseSource('none')}
          />
          {sourceChoice === 'pdf' ? (
            <button
              type="button"
              className="career-text-button"
              onClick={() => chooseSource('text')}
            >
              Нет PDF под рукой — вставить текст резюме
            </button>
          ) : null}
          {sourceChoice === 'text' ? (
            <button
              type="button"
              className="career-quiet-button"
              onClick={() => chooseSource('pdf')}
            >
              <ArrowLeft size={16} />
              Вернуться к PDF
            </button>
          ) : null}
          {sourceChoice === 'pdf' ||
          sourceChoice === 'profile-import' ||
          sourceChoice === 'text' ? (
            <IntakeSourceStep
              hideChoiceRow
              isDesktop={isDesktop}
              sourceChoice={sourceChoice}
              onChooseSource={chooseSource}
              lock={sourceLock}
              onReleaseSource={() => {
                setSourceChoice('pdf');
                setTypedResume('');
                ingestion.clear();
              }}
              onDisconnectPlatform={(platform) => void disconnectPlatform(platform)}
              ingested={ingested}
              busy={ingestion.busy}
              notice={ingestion.notice}
              resumeText={typedResume}
              onResumeText={setTypedResume}
              onPickPdf={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) void ingestion.readPdf(file);
              }}
              linkedinOpen={isLinkedinModalOpen}
              hhOpen={isHhModalOpen}
              onLinkedinOpen={setLinkedinModalOpen}
              onHhOpen={setHhModalOpen}
              onLinkedinImported={async (parsed, url) => {
                setLinkedinUrl(url);
                await ingestion.acceptParsed(parsed, 'linkedin-pdf', {
                  platform: 'linkedin',
                  accessMode: 'native_session_snapshot',
                  sourceUrl: url,
                  capturedAt: new Date().toISOString(),
                });
                setLinkedinConnected(true);
              }}
              onProviderConnectionFailure={setError}
              onHhConnected={async (_resumes, parsed, url) => {
                setHhEmptyAccount(false);
                await ingestion.acceptParsed(parsed, 'hh-pdf', {
                  platform: 'hh',
                  accessMode: 'native_session_snapshot',
                  sourceUrl: url,
                  capturedAt: new Date().toISOString(),
                });
                setHhConnected(true);
                setHhUrl(url);
              }}
              onHhAuthenticatedEmpty={() => {
                setHhConnected(true);
                setHhEmptyAccount(true);
              }}
              hhConnected={isHhConnected || connectedSource?.platform === 'hh'}
              hhEmptyAccount={isHhEmptyAccount}
              linkedinConnected={isLinkedinConnected || connectedSource?.platform === 'linkedin'}
              connectedSource={connectedSource}
            />
          ) : null}
        </>
      ) : null}

      {step === 'progress' ? (
        <OnboardingProgressStep
          busy={ingestion.busy}
          error={ingestion.error}
          counts={buildParseProgressCounts({
            experience: ingested?.parsed.experience ?? [],
            education: ingested?.parsed.education ?? [],
            skills: ingested?.parsed.skills ?? [],
          })}
        />
      ) : null}

      {step === 'talk' ? (
        <OnboardingQuickStartStep
          roleTitle={quickRole}
          regions={regions}
          format={format}
          onRoleChange={setQuickRole}
          onToggleRegion={toggleRegion}
          onChangeFormat={setFormat}
        />
      ) : null}

      {step === 'review' ? (
        <OnboardingReviewStep
          rows={reviewRows}
          editingId={reviewEditingId}
          onStartEdit={(id, title) => {
            setReviewEditingId(id);
            setReviewDraft(reviewOverrides[id] ?? title);
          }}
          onCancelEdit={() => setReviewEditingId(undefined)}
          draftValue={reviewDraft}
          onDraftChange={setReviewDraft}
          onSaveEdit={(id) => {
            setReviewOverrides((current) => ({ ...current, [id]: reviewDraft }));
            setReviewEditingId(undefined);
          }}
        />
      ) : null}

      {step === 'campaign' ? (
        <OnboardingCampaignStep
          state={campaignState}
          roles={campaignRoles}
          selectedRoleIds={selectedRoleIds}
          regions={regions}
          format={format}
          elapsedSeconds={Math.max(0, Math.floor((now - campaignStartedAt) / 1000))}
          error={campaignError}
          onToggleRole={toggleRole}
          onAddRole={addRole}
          onToggleRegion={toggleRegion}
          onChangeFormat={setFormat}
        />
      ) : null}

      {step === 'done' ? (
        <OnboardingDoneStep
          roleTitle={selectedRoleTitle}
          durationLabel={formatOnboardingDuration(timer.current, now)}
        />
      ) : null}

      {error ? (
        <p className="career-intake-error" role="alert" ref={errorRef}>
          {error}
        </p>
      ) : null}

      <footer className="career-intake-actions">
        {step === 'source' ? (
          <span />
        ) : (
          <button className="career-quiet-button" type="button" onClick={goBack}>
            <ArrowLeft size={18} />
            Назад
          </button>
        )}
        <button
          className="career-primary-button"
          type="button"
          disabled={
            (step === 'progress' && ingestion.busy) ||
            (step === 'campaign' && campaignState === 'loading')
          }
          onClick={() => (step === 'done' ? complete() : void goNext())}
        >
          {step === 'done' ? 'Перейти в «Вакансии»' : 'Продолжить'}
          <ArrowRight size={18} weight="bold" />
        </button>
      </footer>
    </section>
  );

  function buildDeferredWorkspaceInput(): WorkspaceInput {
    return buildWorkspaceInput();
  }
}

function titleFor(step: OnboardingStepId): string {
  switch (step) {
    case 'source':
      return 'С чем разбираемся?';
    case 'progress':
      return 'Разбираем резюме';
    case 'talk':
      return 'Роль и регион';
    case 'review':
      return 'Проверьте профиль';
    case 'campaign':
      return 'Роли и регионы';
    case 'done':
      return 'Первая подборка готова';
  }
}

function descriptionFor(step: OnboardingStepId): string {
  switch (step) {
    case 'source':
      return 'Выберите то, что у вас уже есть. Мы используем это сразу — без анкеты на 20 полей.';
    case 'progress':
      return 'Обычно занимает меньше минуты. Ничего подтверждать пока не нужно.';
    case 'talk':
      return 'Если профиля пока нет, укажите роль и регион — подбор начнётся с этих условий.';
    case 'review':
      return 'Подтвердите одним экраном — это войдёт в письма и подбор. Можно поправить конкретный пункт, не отвечая заново на всё.';
    case 'campaign':
      return 'Подтвердите или измените роли с уровнями и основаниями из профиля, затем выберите регионы.';
    case 'done':
      return 'Кампания собрана — откройте подходящие вакансии.';
  }
}

function campaignRolesFromMeta(campaign: CampaignMetaView): OnboardingCampaignRole[] {
  return (campaign.autoRoles ?? []).map((role) => ({
    id: role.id,
    title: role.title,
    titleRu: role.titleRu,
    level: role.level,
    kind: role.kind,
    reason: role.reason,
    evidence: role.evidence,
    source: 'model' as const,
  }));
}
