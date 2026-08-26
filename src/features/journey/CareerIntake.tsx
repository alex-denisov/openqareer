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
import type { HhResumeItem } from '../connections/ProfileImportModals';
import {
  connectedProfileSource,
  type ConnectedProfileSource,
} from './connectedProfileSource';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  closeConnectorSession,
  readSessionPage,
  resetConnectorSession,
} from '../connections/connectorSession';
import { readHhResumeFromSession } from '../connections/hhSessionPoll';
import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
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
  const [hhResumes, setHhResumes] = useState<HhResumeItem[]>([]);
  const [selectedHhResumeId, setSelectedHhResumeId] = useState('');
  const [isHhConnected, setHhConnected] = useState(false);
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
      (isHhConnected ? 'hh' : isLinkedinConnected ? 'linkedin' : undefined),
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
          return;
        }
        const live = connections.find(
          (item) =>
            item.status === 'connected' &&
            item.accessMode !== 'native_session_snapshot' &&
            item.profile.facts.length > 0,
        );
        if (!live || live.status !== 'connected' || live.accessMode !== undefined) return;
        const parsed = parseResumeContent(
          live.profile.facts.map((fact) => fact.value).join('\n'),
        );
        void ingestion.acceptParsed(
          parsed,
          live.platform === 'hh' ? 'hh-pdf' : 'linkedin-pdf',
        );
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

  /** Forgets everything this wizard is holding about a captured source. */
  function clearLocalSource() {
    setError(undefined);
    setTypedResume('');
    setLinkedinUrl('');
    setHhUrl('');
    setHhResumes([]);
    setSelectedHhResumeId('');
    setHhConnected(false);
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
  async function forgetPlatform(platform: 'hh' | 'linkedin') {
    try {
      await disconnectConnection(platform);
    } catch {
      setError(
        `Отключить ${platform === 'hh' ? 'hh.ru' : 'LinkedIn'} не удалось. Проверьте соединение и повторите попытку.`,
      );
      return;
    }
    await resetConnectorSession(platform).catch(() => false);
  }

  async function disconnectPlatform(platform: 'hh' | 'linkedin') {
    setReleasing(true);
    clearLocalSource();
    try {
      await forgetPlatform(platform);
    } finally {
      setReleasing(false);
    }
  }

  async function importSelectedHhResume() {
    const selected =
      hhResumes.find((item) => item.id === selectedHhResumeId) ?? hhResumes[0];
    if (!selected) {
      setError('Выберите резюме для импорта.');
      return;
    }
    setError(undefined);
    try {
      const parsed = await readHhResume(selected.url);
      if (!parsed) {
        setError('Импортировать выбранное резюме не удалось.');
        return;
      }
      setHhUrl(selected.url);
      const stored = await ingestion.acceptParsed(parsed, 'hh-pdf', {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: selected.url,
        capturedAt: new Date().toISOString(),
      });
      if (!stored.imported || !stored.connection) {
        setError(
          'Резюме прочитано, но сервер не подтвердил сохранение. Повторите импорт или загрузите PDF.',
        );
        return;
      }
      setHhConnected(true);
      await closeConnectorSession('hh');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Импортировать выбранное резюме не удалось.',
      );
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
          onLinkedinOpen={setLinkedinModalOpen}
          onHhOpen={setHhModalOpen}
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
          onHhConnected={async (resumes, parsed, url) => {
            setHhResumes(resumes);
            setHhConnected(true);
            if (resumes.length > 0) setSelectedHhResumeId(resumes[0].id);
            if (url) setHhUrl(url);
            if (!parsed || !url) return;
            const stored = await ingestion.acceptParsed(parsed, 'hh-pdf', {
              platform: 'hh',
              accessMode: 'native_session_snapshot',
              sourceUrl: url,
              capturedAt: new Date().toISOString(),
            });
            if (!stored.imported || !stored.connection) {
              throw new Error('hh_native_connection_not_persisted');
            }
          }}
          onHhAuthenticatedEmpty={() => {
            setHhResumes([]);
            setSelectedHhResumeId('');
            setHhConnected(true);
          }}
          hhResumes={hhResumes}
          selectedHhResumeId={selectedHhResumeId}
          onSelectHhResume={setSelectedHhResumeId}
          onImportHhResume={() => void importSelectedHhResume()}
          hhConnected={isHhConnected || connectedSource?.platform === 'hh'}
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

async function readHhResume(url: string): Promise<ParsedResume | undefined> {
  if (!isTauriEnvironment()) return undefined;
  return readHhResumeFromSession(url, (selectedUrl) =>
    readSessionPage('hh', selectedUrl),
  );
}
