import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { disconnectConnection, getConnections } from '../coach/coachApi';
import {
  closeConnectorSession,
  resetConnectorSession,
} from '../connections/connectorSession';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import type { CandidateRegion } from '../workspace/candidateRegions';
import { parseResumeContent } from '../workspace/resumeParser';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import {
  connectedProfileSource,
  type ConnectedProfileSource,
} from './connectedProfileSource';
import { IntakeSourceStep, type SourceChoice } from './IntakeSourceStep';
import { intakeSourceLock } from './intakeSourceLock';
import { OnboardingSourceCards } from './OnboardingSourceCards';
import { OnboardingProgressStep } from './OnboardingProgressStep';
import { OnboardingTalkStep, type OnboardingTalkValues } from './OnboardingTalkStep';
import { OnboardingReviewStep } from './OnboardingReviewStep';
import { OnboardingRolesStep } from './OnboardingRolesStep';
import {
  OnboardingGeoStep,
  ONBOARDING_FORMAT_OPTIONS,
  type OnboardingFormat,
} from './OnboardingGeoStep';
import { OnboardingDoneStep } from './OnboardingDoneStep';
import { OnboardingWizardChrome } from './OnboardingWizardChrome';
import {
  buildParseProgressCounts,
  buildProfileReviewRows,
} from './profileFactReviewRows';
import { buildOnboardingRoleCards } from './onboardingRoleCards';
import { buildOnboardingWorkspaceInput } from './onboardingWorkspaceInput';
import {
  formatOnboardingDuration,
  startOnboardingTimer,
} from './onboardingTimer';
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
}

const emptyTalk: OnboardingTalkValues = { tasks: '', change: '', successMeasure: '' };

function sourceLabelFor(sourceChoice: SourceChoice, ingestedSource?: string): string {
  if (ingestedSource === 'linkedin-pdf') return 'из LinkedIn';
  if (ingestedSource === 'hh-pdf') return 'из hh.ru';
  if (sourceChoice === 'none') return 'со слов кандидата';
  return 'из резюме';
}

// One state machine drives every step; splitting it would scatter the
// transition rules the mockup fixes as one flow (onboarding.html).
// eslint-disable-next-line max-lines-per-function
export function OnboardingWizard({
  onComplete,
  hasAccount = false,
  onStartedChange,
}: OnboardingWizardProps) {
  const isDesktop = isTauriEnvironment();
  const ingestion = useResumeIngestion(hasAccount);
  const timer = useRef(startOnboardingTimer());
  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState<OnboardingStepId>('source');
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>('pdf');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [isLinkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setHhModalOpen] = useState(false);
  const [isHhConnected, setHhConnected] = useState(false);
  const [isHhEmptyAccount, setHhEmptyAccount] = useState(false);
  const [isLinkedinConnected, setLinkedinConnected] = useState(false);
  const [connectedSource, setConnectedSource] = useState<ConnectedProfileSource>();
  const [talk, setTalk] = useState<OnboardingTalkValues>(emptyTalk);
  const [selectedRoleTitle, setSelectedRoleTitle] = useState<string>();
  const [regions, setRegions] = useState<readonly CandidateRegion[]>([]);
  const [format, setFormat] = useState<OnboardingFormat>(ONBOARDING_FORMAT_OPTIONS[0]);
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, string>>({});
  const [reviewEditingId, setReviewEditingId] = useState<string>();
  const [reviewDraft, setReviewDraft] = useState('');
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  const branch: OnboardingBranch = sourceChoice === 'none' ? 'talk' : 'file';
  const ingested = ingestion.result;

  useEffect(() => onStartedChange?.(true), [onStartedChange]);

  useEffect(() => {
    if (step !== 'done') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

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
    typedLength: 0,
  });

  function chooseSource(next: SourceChoice) {
    if (next === sourceChoice) return;
    if (sourceLock.lockedTo && sourceLock.lockedTo !== next) return;
    setSourceChoice(next);
    setError(undefined);
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
        targetRole: ingested?.parsed.targetRole,
        experience: ingested?.parsed.experience ?? [],
      }),
    [ingested],
  );

  useEffect(() => {
    if (!selectedRoleTitle && roleCards.length > 0) setSelectedRoleTitle(roleCards[0].title);
  }, [roleCards, selectedRoleTitle]);

  async function goNext() {
    setError(undefined);
    if (step === 'source') {
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
      setStep(nextStepId(branch, step) ?? step);
      return;
    }
    if (step === 'talk') {
      if (talk.tasks.trim().length < 20) {
        setError('Добавьте пару предложений о том, чем вы реально занимались.');
        return;
      }
      const combined = [
        `Что делал(а): ${talk.tasks}`,
        `Что хочет изменить: ${talk.change}`,
        `Результат через год: ${talk.successMeasure}`,
      ].join('\n');
      await ingestion.acceptParsed(parseResumeContent(combined), 'text');
      setStep(nextStepId(branch, step) ?? step);
      return;
    }
    setStep(nextStepId(branch, step) ?? step);
  }

  function goBack() {
    setError(undefined);
    const previous = previousStepId(branch, step);
    if (previous) setStep(previous);
  }

  function complete() {
    onComplete(
      buildOnboardingWorkspaceInput({
        sourceChoice,
        ingested,
        talk,
        selectedRoleTitle,
        regions,
        format,
        reviewOverrides,
        linkedinUrl,
        hhUrl,
      }),
    );
  }

  return (
    <section className="career-intake career-onboarding" aria-labelledby="onboarding-title">
      <OnboardingWizardChrome
        step={stepInfo(branch, step)}
        title={titleFor(step)}
        description={descriptionFor(step)}
        onSkip={() => onComplete(buildDeferredWorkspaceInput())}
      />

      {step === 'source' ? (
        <>
          <OnboardingSourceCards
            active={
              sourceChoice === 'pdf' ? 'pdf' : sourceChoice === 'none' ? 'none' : 'profile-import'
            }
            linkedinSelected={
              isLinkedinConnected || connectedSource?.platform === 'linkedin' || isLinkedinModalOpen
            }
            hhSelected={isHhConnected || connectedSource?.platform === 'hh' || isHhModalOpen}
            onChoosePdf={() => chooseSource('pdf')}
            onChooseLinkedin={() => {
              chooseSource('profile-import');
              setLinkedinModalOpen(true);
            }}
            onChooseHh={() => {
              chooseSource('profile-import');
              setHhModalOpen(true);
            }}
            onChooseTalk={() => chooseSource('none')}
          />
          {sourceChoice === 'pdf' || sourceChoice === 'profile-import' ? (
            <IntakeSourceStep
              hideChoiceRow
              isDesktop={isDesktop}
              sourceChoice={sourceChoice}
              onChooseSource={chooseSource}
              lock={sourceLock}
              onReleaseSource={() => {
                setSourceChoice('pdf');
                ingestion.clear();
              }}
              onDisconnectPlatform={(platform) => void disconnectPlatform(platform)}
              ingested={ingested}
              busy={ingestion.busy}
              notice={ingestion.notice}
              resumeText=""
              onResumeText={() => undefined}
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
        <OnboardingTalkStep {...talk} onChange={(patch) => setTalk((c) => ({ ...c, ...patch }))} />
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

      {step === 'roles' ? (
        <OnboardingRolesStep
          cards={roleCards}
          selectedIds={roleCards.filter((c) => c.title === selectedRoleTitle).map((c) => c.id)}
          onToggle={(id) => {
            const card = roleCards.find((c) => c.id === id);
            if (card) setSelectedRoleTitle(card.title);
          }}
        />
      ) : null}

      {step === 'geo' ? (
        <OnboardingGeoStep
          regions={regions}
          prefilledRegion={undefined}
          format={format}
          onToggleRegion={(region) =>
            setRegions((current) =>
              current.includes(region) ? current.filter((r) => r !== region) : [...current, region],
            )
          }
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
        {step === 'source' ? <span /> : (
          <button className="career-quiet-button" type="button" onClick={goBack}>
            <ArrowLeft size={18} />
            Назад
          </button>
        )}
        <button
          className="career-primary-button"
          type="button"
          disabled={step === 'progress' && ingestion.busy}
          onClick={() => (step === 'done' ? complete() : void goNext())}
        >
          {step === 'done' ? 'Перейти в «Сегодня»' : 'Продолжить'}
          <ArrowRight size={18} weight="bold" />
        </button>
      </footer>
    </section>
  );

  function buildDeferredWorkspaceInput(): WorkspaceInput {
    return buildOnboardingWorkspaceInput({
      sourceChoice,
      ingested,
      talk,
      selectedRoleTitle,
      regions,
      format,
      reviewOverrides,
      linkedinUrl,
      hhUrl,
    });
  }
}

function titleFor(step: OnboardingStepId): string {
  switch (step) {
    case 'source':
      return 'С чем разбираемся?';
    case 'progress':
      return 'Разбираем резюме';
    case 'talk':
      return 'Три вопроса о последней роли';
    case 'review':
      return 'Проверьте профиль';
    case 'roles':
      return 'На какие роли вас купят';
    case 'geo':
      return 'География и формат';
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
      return 'Без готового резюме начнём с задач, а не с должностей — так честнее видно, что переносится в новую роль.';
    case 'review':
      return 'Подтвердите одним экраном — это войдёт в письма и подбор. Можно поправить конкретный пункт, не отвечая заново на всё.';
    case 'roles':
      return 'Выберите роль. По каждой — сколько вакансий уже в источниках и чем роль подтверждена в вашем опыте.';
    case 'geo':
      return 'Отметьте, где готовы искать, и формат занятости.';
    case 'done':
      return 'Кампания собрана — дальше подбор продолжается в «Сегодня».';
  }
}
