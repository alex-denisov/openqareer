import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  GlobeHemisphereWest,
  Question,
  Target,
  type Icon,
} from '@phosphor-icons/react';
import { disconnectConnection, getConnections } from '../coach/coachApi';
import {
  connectedProfileSource,
  type ConnectedProfileSource,
} from './connectedProfileSource';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  closeConnectorSession,
  resetConnectorSession,
} from '../connections/connectorSession';

import {
  validateWorkspaceInput,
  type CareerGoal,
  type ResumeSource,
  type SearchUrgency,
  type WorkspaceInput,
} from '../workspace/workspaceStorage';
import type { CandidateRegion } from '../workspace/candidateRegions';
import { IntakeContextStep, type IntakeContextValues } from './IntakeContextStep';
import { IntakeSourceStep, type SourceChoice } from './IntakeSourceStep';
import { intakeSourceLock } from './intakeSourceLock';
import { useResumeIngestion } from './useResumeIngestion';

export type IntakeStep = 'intent' | 'source' | 'context';
export type { SourceChoice } from './IntakeSourceStep';

export const IMPORT_ACTION_LABEL = 'Импортировать';
export const PRESS_IMPORT_FIRST_MESSAGE = `Сначала нажмите «${IMPORT_ACTION_LABEL}».`;

interface CareerIntakeProps {
  onComplete: (input: WorkspaceInput) => void;
  hasAccount?: boolean;
  /** Opens the account panel, so the wizard never names a door it cannot open. */
  onOpenAccount?: () => void;
  /**
   * Tells the shell a diagnostic is under way, so the session arriving next is
   * recognised as an unfinished diagnostic rather than a returning candidate
   * opening their cabinet (B141). The wizard is under way from its first
   * paint, because it no longer has a screen in front of its first question.
   */
  onStartedChange?: (started: boolean) => void;
  initialStep?: IntakeStep;
  initialSourceChoice?: SourceChoice;
}

const goalOptions: Array<{
  id: CareerGoal;
  title: string;
  detail: string;
  icon: Icon;
}> = [
  {
    id: 'find-job',
    title: 'Хочу найти работу',
    detail: 'Поймём, что мешает получать подходящие интервью.',
    icon: Briefcase,
  },
  {
    id: 'choose-role',
    title: 'Не понимаю, какая роль мне подходит',
    detail: 'Разберём реальные задачи, уровень и смежные направления.',
    icon: Question,
  },
  {
    id: 'positioning',
    title: 'Хочу проверить резюме и позиционирование',
    detail: 'Отделим проблемы документа от проблем роли и рынка.',
    icon: Target,
  },
  {
    id: 'market',
    title: 'Хочу понять рынки и релокацию',
    detail: 'Сравним формат работы, страны и практические ограничения.',
    icon: GlobeHemisphereWest,
  },
];

const emptyContext: IntakeContextValues = {
  currentSituation: '',
  targetDirection: '',
  regions: [],
  urgency: 'active',
  conditions: [],
  otherConstraint: '',
};

// The wizard keeps one state machine; each step renders from its own module.
export function CareerIntake({
  onComplete,
  hasAccount = false,
  onStartedChange,
  initialStep = 'intent',
  initialSourceChoice,
}: CareerIntakeProps) {
  const isDesktop = isTauriEnvironment();
  const ingestion = useResumeIngestion(hasAccount);
  const [step, setStep] = useState<IntakeStep>(initialStep);
  const [goal, setGoal] = useState<CareerGoal>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(
    () => initialSourceChoice ?? (isDesktop ? 'profile-import' : 'pdf'),
  );
  const [typedResume, setTypedResume] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [isLinkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setHhModalOpen] = useState(false);
  const [isHhConnected, setHhConnected] = useState(false);
  /** hh.ru itself said this account holds no resume. Only hh.ru can say that. */
  const [isHhEmptyAccount, setHhEmptyAccount] = useState(false);
  const [isLinkedinConnected, setLinkedinConnected] = useState(false);
  const [connectedSource, setConnectedSource] = useState<ConnectedProfileSource>();
  const [context, setContext] = useState<IntakeContextValues>(emptyContext);
  /**
   * A release is in flight. The wizard restores a connected source from the
   * server on every render pass that has none; without this gate that read
   * races the release and puts the connection straight back
   * (owner report, 2026-08-26).
   */
  const [isReleasing, setReleasing] = useState(false);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  const ingested = ingestion.result;
  /**
   * One capture fixes the source the career picture is built from; the rest
   * close until it is released. Stacking a profile, a PDF and typed text left
   * nothing to say which account of the career wins (B169 §8).
   */
  const sourceLock = intakeSourceLock({
    ingestedSource: ingested?.source,
    ingestedImported: ingested?.imported,
    connectedPlatform:
      connectedSource?.platform ??
      // An hh.ru account with no resume fixes nothing: locking the wizard to
      // profile-import there shut the PDF the note was recommending in the
      // same breath (owner report, 2026-08-26).
      (isHhConnected && !isHhEmptyAccount
        ? 'hh'
        : isLinkedinConnected
          ? 'linkedin'
          : undefined),
    typedLength: typedResume.trim().length,
  });

  /**
   * The wizard used to sit behind a welcome screen whose only action was
   * «Начать диагностику». It restated the first question without asking it,
   * and the owner could not tell what it was for, so it is gone and the
   * diagnostic is under way from the first paint (B169 §4).
   */
  useEffect(() => {
    onStartedChange?.(true);
  }, [onStartedChange]);

  /**
   * On a phone the action bar is sticky, so a refusal rendered above it is
   * painted over: the candidate presses «Продолжить», nothing appears to
   * happen, and the sentence saying why sits under the bar.
   */
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [error]);

  /**
   * A platform already connected on this account carries a profile the wizard
   * must not ask for a second time. Two shapes reach this point: an
   * official-API connection, whose facts travel with it and can be re-ingested,
   * and a native session snapshot, whose facts are already in the candidate's
   * profile and only need to be acknowledged (B157).
   */
  useEffect(() => {
    if (!hasAccount || isReleasing || sourceChoice !== 'profile-import' || ingested) {
      return;
    }
    let active = true;
    void getConnections()
      .then((connections) => {
        if (!active) return;
        const snapshot = connectedProfileSource(connections);
        if (snapshot) {
          setConnectedSource(snapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hasAccount, isReleasing, sourceChoice, ingested, ingestion]);

  useEffect(() => {
    if (!ingested?.parsed.targetRole || context.targetDirection) return;
    setContext((current) =>
      current.targetDirection
        ? current
        : { ...current, targetDirection: ingested.parsed.targetRole ?? '' },
    );
  }, [ingested, context.targetDirection]);

  function chooseSource(next: SourceChoice) {
    if (next === sourceChoice) return;
    if (sourceLock.lockedTo && sourceLock.lockedTo !== next) return;
    setSourceChoice(next);
    setError(undefined);
    if (next !== 'text') setTypedResume('');
    if (next !== 'profile-import') {
      setLinkedinUrl('');
      setHhUrl('');
      setLinkedinModalOpen(false);
      setHhModalOpen(false);
      void closeConnectorSession('linkedin').catch(() => undefined);
      void closeConnectorSession('hh').catch(() => undefined);
    }
    ingestion.clear();
  }

  /**
   * Opening a connector dialog drops whatever the last attempt left on screen.
   * A refusal from a previous try used to sit under the wizard through the
   * next, successful one — «получить данные профиля не удалось» next to a
   * resume the candidate had just picked (owner report, 2026-08-26).
   */
  function openConnectorModal(setOpen: (open: boolean) => void) {
    return (open: boolean) => {
      if (open) setError(undefined);
      setOpen(open);
    };
  }

  /** Forgets everything this wizard is holding about a captured source. */
  function clearLocalSource() {
    setError(undefined);
    setTypedResume('');
    setLinkedinUrl('');
    setHhUrl('');
    setHhConnected(false);
    setHhEmptyAccount(false);
    setLinkedinConnected(false);
    setConnectedSource(undefined);
    setLinkedinModalOpen(false);
    setHhModalOpen(false);
    void closeConnectorSession('linkedin').catch(() => undefined);
    void closeConnectorSession('hh').catch(() => undefined);
    ingestion.clear();
  }

  /**
   * Releases the fixed source deliberately. Without this the first capture
   * would be a trap: a candidate who picked the wrong file could never reach
   * any other source again.
   *
   * Clearing local state alone was that trap wearing a button: the account's
   * own connection stayed on the server, the wizard's very next read restored
   * it, and «Сменить источник» looked like it did nothing at all (owner
   * report, 2026-08-26). A source the server is holding has to be released
   * there too.
   */
  async function releaseSource() {
    const platform = connectedSourcePlatform();
    if (!platform) {
      clearLocalSource();
      return;
    }
    await disconnectPlatform(platform);
  }

  /** The platform whose connection this account is actually holding, if any. */
  function connectedSourcePlatform(): 'hh' | 'linkedin' | undefined {
    if (connectedSource) return connectedSource.platform;
    if (isHhConnected) return 'hh';
    if (isLinkedinConnected) return 'linkedin';
    return undefined;
  }

  /**
   * Signs this account out of a platform: the stored connection goes, and the
   * sign-in the desktop shell is holding in its own window goes with it. This
   * is the sign-out the owner asked to live on the platform card rather than
   * inside the session dialog's toolbar.
   */
  /**
   * The release is local first: what the wizard is holding is always let go.
   * The server is told too, but a failed `DELETE` is only worth a sentence when
   * the server was the one holding the connection — «Сменить источник» on a
   * source the server never stored used to end in «Отключить hh.ru не удалось»
   * over a release that had in fact happened (owner report, 2026-08-26).
   */
  async function forgetPlatform(platform: 'hh' | 'linkedin', serverHeld: boolean) {
    try {
      await disconnectConnection(platform);
    } catch {
      if (serverHeld) {
        setError(
          `Отключить ${platform === 'hh' ? 'hh.ru' : 'LinkedIn'} не удалось. Проверьте соединение и повторите попытку.`,
        );
      }
    }
    await resetConnectorSession(platform).catch(() => false);
  }

  async function disconnectPlatform(platform: 'hh' | 'linkedin') {
    const serverHeld = connectedSource?.platform === platform;
    setReleasing(true);
    clearLocalSource();
    try {
      await forgetPlatform(platform, serverHeld);
    } finally {
      setReleasing(false);
    }
  }

  function moveFromSource() {
    if (sourceChoice === 'profile-import' && !ingested && !connectedSource) {
      setError(
        isDesktop
          ? 'Подключите LinkedIn или hh.ru либо выберите другой источник: «PDF», «Текстом» или «Без документов».'
          : 'В веб-версии импорт профилей недоступен. Выберите «PDF», «Текстом» или «Без документов».',
      );
      return;
    }
    if (
      sourceChoice === 'text' &&
      typedResume.trim().length > 0 &&
      typedResume.trim().length < 80
    ) {
      setError('Добавьте чуть больше контекста или продолжите без документа.');
      return;
    }
    setError(undefined);
    setStep('context');
  }

  function complete() {
    const input = buildWorkspaceInput({
      goal,
      sourceChoice,
      ingested,
      typedResume,
      linkedinUrl,
      hhUrl,
      context,
    });
    const errors = validateWorkspaceInput(input);
    const firstError =
      errors.currentSituation ??
      errors.linkedinUrl ??
      errors.hhUrl ??
      errors.resumeText;
    if (errors.currentSituation) {
      setError('Добавьте пару предложений о вашей ситуации. Это заменяет длинную анкету.');
      return;
    }
    if (firstError) {
      setError(firstError);
      return;
    }
    onComplete(input);
  }

  const hasDocument =
    Boolean(ingested) || Boolean(connectedSource) || typedResume.trim().length >= 80;

  return (
    <section className="career-intake" aria-labelledby="intake-title">
      <IntakeHeader step={step} />

      {step === 'intent' ? (
        <div className="career-intent-list">
          {goalOptions.map((item) => {
            const ItemIcon = item.icon;
            const selected = goal === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={selected ? 'is-selected' : ''}
                aria-pressed={selected}
                onClick={() => {
                  setGoal(item.id);
                  setError(undefined);
                }}
              >
                <ItemIcon size={22} weight={selected ? 'fill' : 'regular'} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                {selected ? <Check size={18} weight="bold" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {step === 'source' ? (
        <IntakeSourceStep
          isDesktop={isDesktop}
          sourceChoice={sourceChoice}
          onChooseSource={chooseSource}
          lock={sourceLock}
          onReleaseSource={() => void releaseSource()}
          onDisconnectPlatform={(platform) => void disconnectPlatform(platform)}
          ingested={ingested}
          busy={ingestion.busy || isReleasing}
          notice={ingestion.notice}
          resumeText={typedResume}
          onResumeText={setTypedResume}
          onPickPdf={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) void ingestion.readPdf(file);
          }}
          linkedinOpen={isLinkedinModalOpen}
          hhOpen={isHhModalOpen}
          onLinkedinOpen={openConnectorModal(setLinkedinModalOpen)}
          onHhOpen={openConnectorModal(setHhModalOpen)}
          onLinkedinImported={async (parsed, url) => {
            setLinkedinUrl(url);
            const stored = await ingestion.acceptParsed(parsed, 'linkedin-pdf', {
              platform: 'linkedin',
              accessMode: 'native_session_snapshot',
              sourceUrl: url,
              capturedAt: new Date().toISOString(),
            });
            if (!stored.imported || !stored.connection) {
              throw new Error('linkedin_native_connection_not_persisted');
            }
            setLinkedinConnected(true);
          }}
          onProviderConnectionFailure={setError}
          onHhConnected={async (_resumes, parsed, url) => {
            setHhEmptyAccount(false);
            const stored = await ingestion.acceptParsed(parsed, 'hh-pdf', {
              platform: 'hh',
              accessMode: 'native_session_snapshot',
              sourceUrl: url,
              capturedAt: new Date().toISOString(),
            });
            if (!stored.imported || !stored.connection) {
              // The server's own sentence, so the dialog can say what really
              // happened rather than «не подтвердил сохранение» over anything.
              throw new Error(
                stored.storeFailure ?? 'hh_native_connection_not_persisted',
              );
            }
            // Only a stored import is a connection. Claiming one before the
            // server agreed is what put «Не подключено» next to «в профиле
            // hh.ru не нашлось резюме» (owner report, 2026-08-26).
            setHhConnected(true);
            setHhUrl(url);
          }}
          onHhAuthenticatedEmpty={() => {
            setError(undefined);
            setHhConnected(true);
            setHhEmptyAccount(true);
          }}
          hhConnected={isHhConnected || connectedSource?.platform === 'hh'}
          hhEmptyAccount={isHhEmptyAccount}
          linkedinConnected={
            isLinkedinConnected || connectedSource?.platform === 'linkedin'
          }
          connectedSource={connectedSource}
        />
      ) : null}

      {step === 'context' ? (
        <IntakeContextStep
          {...context}
          optional={hasDocument}
          onChange={(patch) => setContext((current) => ({ ...current, ...patch }))}
        />
      ) : null}

      {ingestion.error ? (
        <p className="career-intake-error" role="alert">
          {ingestion.error}
        </p>
      ) : null}
      {error ? (
        <p className="career-intake-error" role="alert" ref={errorRef}>
          {error}
        </p>
      ) : null}

      <footer className="career-intake-actions">
        {step === 'intent' ? (
          <span />
        ) : (
          <button
            className="career-quiet-button"
            type="button"
            onClick={() => {
              setError(undefined);
              setStep(step === 'context' ? 'source' : 'intent');
            }}
          >
            <ArrowLeft size={18} />
            Назад
          </button>
        )}
        <button
          className="career-primary-button"
          type="button"
          onClick={() => {
            if (step === 'intent') {
              if (!goal) {
                setError('Выберите ближайшую задачу или начните с собственного описания.');
                return;
              }
              setError(undefined);
              setStep('source');
              return;
            }
            if (step === 'source') {
              moveFromSource();
              return;
            }
            complete();
          }}
        >
          {step === 'context' ? 'Собрать карьерную картину' : 'Продолжить'}
          <ArrowRight size={18} weight="bold" />
        </button>
      </footer>
    </section>
  );
}

function IntakeHeader({ step }: { step: IntakeStep }) {
  const title =
    step === 'intent'
      ? 'С чем разобраться?'
      : step === 'source'
        ? 'Что уже есть?'
        : 'Что должно измениться?';
  const lead =
    step === 'intent'
      ? 'Начните с вопроса. Платформа сама выберет, что уточнить дальше.'
      : step === 'source'
        ? 'Добавьте резюме или профиль, либо продолжите разговор без документов.'
        : 'Достаточно нескольких фактов. Неизвестный ответ можно оставить неизвестным.';
  return (
    <header className="career-intake-header">
      <div>
        <p className="career-eyebrow">Карьерная диагностика</p>
        <h1 id="intake-title">{title}</h1>
        <p className="career-lead">{lead}</p>
      </div>
      <ol className="career-intake-progress" aria-label="Прогресс консультации">
        {(['intent', 'source', 'context'] as IntakeStep[]).map((item, index) => (
          <li
            key={item}
            className={item === step ? 'is-current' : ''}
            aria-current={item === step ? 'step' : undefined}
          >
            {String(index + 1).padStart(2, '0')}
          </li>
        ))}
      </ol>
    </header>
  );
}

function buildWorkspaceInput(state: {
  goal?: CareerGoal;
  sourceChoice: SourceChoice;
  ingested?: ReturnType<typeof useResumeIngestion>['result'];
  typedResume: string;
  linkedinUrl: string;
  hhUrl: string;
  context: IntakeContextValues;
}): WorkspaceInput {
  const { ingested, sourceChoice, context } = state;
  const resumeSource: ResumeSource =
    sourceChoice === 'none'
      ? 'text'
      : sourceChoice === 'text'
        ? 'text'
        : (ingested?.source ?? 'text');
  return {
    careerGoal: state.goal,
    resumeText:
      sourceChoice === 'none'
        ? ''
        : sourceChoice === 'text'
          ? state.typedResume
          : (ingested?.text ?? ''),
    resumeSource,
    resumeFileName: ingested?.file?.name,
    resumePageCount: ingested?.file?.pages,
    targetDirection: context.targetDirection,
    regions: context.regions as readonly CandidateRegion[],
    currentSituation: context.currentSituation.trim(),
    constraints: [...context.conditions, context.otherConstraint.trim()]
      .filter(Boolean)
      .join('. '),
    urgency: context.urgency as SearchUrgency,
    linkedinUrl:
      sourceChoice === 'profile-import' && state.linkedinUrl.trim()
        ? state.linkedinUrl.trim()
        : undefined,
    hhUrl:
      sourceChoice === 'profile-import' && state.hhUrl.trim()
        ? state.hhUrl.trim()
        : undefined,
    resumeDraft: ingested?.draft,
    parsedResume: ingested?.parsed,
    resumeImported: ingested?.imported,
  };
}

