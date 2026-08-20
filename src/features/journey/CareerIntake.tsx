import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  GlobeHemisphereWest,
  Question,
  Sparkle,
  Target,
  type Icon,
} from '@phosphor-icons/react';
import { getConnections, importProfileUrl } from '../coach/coachApi';
import type { HhResumeItem } from '../connections/ProfileImportModals';
import {
  desktopNativeFetch,
  isTauriEnvironment,
} from '../../services/desktop/desktopBridge';
import { parseHhResumeHtml } from '../../services/connectors/hhResumeParser';
import { parseResumeContent, type ParsedResume } from '../workspace/resumeParser';
import {
  validateWorkspaceInput,
  type CareerGoal,
  type ResumeSource,
  type SearchUrgency,
  type WorkspaceInput,
  type WorkspaceMarket,
} from '../workspace/workspaceStorage';
import { IntakeContextStep, type IntakeContextValues } from './IntakeContextStep';
import { IntakeSourceStep, type SourceChoice } from './IntakeSourceStep';
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
   * opening their cabinet (B141).
   */
  onStartedChange?: (started: boolean) => void;
  initialStarted?: boolean;
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
  market: 'ru',
  urgency: 'active',
  conditions: [],
  otherConstraint: '',
};

// The wizard keeps one state machine; each step renders from its own module.
export function CareerIntake({
  onComplete,
  hasAccount = false,
  onStartedChange,
  initialStarted = false,
  initialStep = 'intent',
  initialSourceChoice = 'profile-import',
}: CareerIntakeProps) {
  const isDesktop = isTauriEnvironment();
  const ingestion = useResumeIngestion(hasAccount);
  const [started, setStarted] = useState(initialStarted);
  const [step, setStep] = useState<IntakeStep>(initialStep);
  const [goal, setGoal] = useState<CareerGoal>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(initialSourceChoice);
  const [typedResume, setTypedResume] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [isLinkedinModalOpen, setLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setHhModalOpen] = useState(false);
  const [hhResumes, setHhResumes] = useState<HhResumeItem[]>([]);
  const [selectedHhResumeId, setSelectedHhResumeId] = useState('');
  const [isHhConnected, setHhConnected] = useState(false);
  const [isLinkedinConnected, setLinkedinConnected] = useState(false);
  const [context, setContext] = useState<IntakeContextValues>(emptyContext);
  const [error, setError] = useState<string>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  const ingested = ingestion.result;
  const isSourceLocked = Boolean(
    ingested && (ingested.source === 'hh-pdf' || ingested.source === 'linkedin-pdf'),
  );

  /**
   * On a phone the action bar is sticky, so a refusal rendered above it is
   * painted over: the candidate presses «Продолжить», nothing appears to
   * happen, and the sentence saying why sits under the bar.
   */
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [error]);

  // A platform already connected on this account carries a profile the wizard
  // should not ask for a second time.
  useEffect(() => {
    if (!hasAccount || sourceChoice !== 'profile-import' || ingested) return;
    let active = true;
    void getConnections()
      .then((connections) => {
        if (!active) return;
        const live = connections.find(
          (item) =>
            (item.platform === 'hh' || item.platform === 'linkedin') &&
            item.status === 'connected' &&
            item.profile.facts.length > 0,
        );
        if (!live || live.status !== 'connected') return;
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
  }, [hasAccount, sourceChoice, ingested, ingestion]);

  useEffect(() => {
    if (!ingested?.parsed.targetRole || context.targetDirection) return;
    setContext((current) =>
      current.targetDirection
        ? current
        : { ...current, targetDirection: ingested.parsed.targetRole ?? '' },
    );
  }, [ingested, context.targetDirection]);

  if (!started) {
    return <IntakeStartScreen onStart={() => {
      setStarted(true);
      onStartedChange?.(true);
    }} />;
  }

  function chooseSource(next: SourceChoice) {
    if (isSourceLocked || next === sourceChoice) return;
    setSourceChoice(next);
    setError(undefined);
    if (next !== 'text') setTypedResume('');
    if (next !== 'profile-import') {
      setLinkedinUrl('');
      setHhUrl('');
    }
    ingestion.clear();
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
      await ingestion.acceptParsed(parsed, 'hh-pdf');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Импортировать выбранное резюме не удалось.',
      );
    }
  }

  function moveFromSource() {
    if (sourceChoice === 'profile-import' && !ingested) {
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

  const hasDocument = Boolean(ingested) || typedResume.trim().length >= 80;

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
          locked={isSourceLocked}
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
          onLinkedinImported={(parsed, url) => {
            setLinkedinUrl(url);
            setLinkedinConnected(true);
            void ingestion.acceptParsed(parsed, 'linkedin-pdf');
          }}
          onHhConnected={(resumes, parsed, url) => {
            setHhResumes(resumes);
            setHhConnected(true);
            if (resumes.length > 0) setSelectedHhResumeId(resumes[0].id);
            if (url) setHhUrl(url);
            if (parsed) void ingestion.acceptParsed(parsed, 'hh-pdf');
          }}
          hhResumes={hhResumes}
          selectedHhResumeId={selectedHhResumeId}
          onSelectHhResume={setSelectedHhResumeId}
          onImportHhResume={() => void importSelectedHhResume()}
          hhConnected={isHhConnected}
          linkedinConnected={isLinkedinConnected}
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

function IntakeStartScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="career-start" aria-labelledby="career-start-title">
      <div className="career-start-stage">
        <p className="career-eyebrow">Сегодня</p>
        <h1 id="career-start-title">Начните с карьерного вопроса</h1>
        <p className="career-lead">
          Опишите ситуацию своими словами. Резюме можно добавить позже.
        </p>
        <div className="career-primary-actions">
          <button className="career-primary-button" type="button" onClick={onStart}>
            Начать диагностику
            <ArrowRight size={18} weight="bold" />
          </button>
        </div>
        <p className="career-start-footnote">
          2–3 минуты на первичную диагностику. Без обязательной регистрации.
        </p>
      </div>

      <div className="career-start-status" aria-label="Состояние карьерной картины">
        <div>
          <span>Профиль</span>
          <strong>Не заполнен</strong>
        </div>
        <div>
          <span>Карьера</span>
          <strong>Нет гипотез</strong>
        </div>
        <div>
          <span>Возможности</span>
          <strong>Не добавлены</strong>
        </div>
      </div>

      <div className="career-start-benefit">
        <Sparkle size={20} weight="fill" />
        <div>
          <strong>Можно начать без документов</strong>
          <span>Без аккаунта прогресс хранится только в текущей вкладке.</span>
        </div>
      </div>
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
    market: context.market as WorkspaceMarket,
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
  if (isTauriEnvironment()) {
    const native = await desktopNativeFetch({
      url,
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (native?.body) return parseHhResumeHtml(native.body, url);
  }
  const result = await importProfileUrl(url);
  return result.status === 'imported' ? result.parsedResume : undefined;
}
