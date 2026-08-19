import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle,
  FilePdf,
  GlobeHemisphereWest,
  Question,
  Sparkle,
  Target,
} from '@phosphor-icons/react';
import {
  getConnections,
  importProfileUrl,
  startConnection,
  type CandidateConnection,
} from '../coach/coachApi';
import {
  PLATFORM_LABELS,
  type ConnectionPlatform,
} from '../connections/connectionResult';
import { openPlatformAuthPopup } from '../connections/authPopup';
import { extractPdfResume } from '../workspace/pdfResume';
import {
  parseResumeContent,
  parsedResumeToDraft,
  type ParsedResume,
} from '../workspace/resumeParser';
import type { ResumeDraft } from '../resume/resumeTypes';
import {
  validateWorkspaceInput,
  type CareerGoal,
  type ResumeSource,
  type SearchUrgency,
  type WorkspaceInput,
  type WorkspaceMarket,
} from '../workspace/workspaceStorage';

export type IntakeStep = 'intent' | 'source' | 'context';
export type SourceChoice = 'profile-import' | 'pdf' | 'text' | 'none';

export const IMPORT_ACTION_LABEL = 'Импортировать';
export const PRESS_IMPORT_FIRST_MESSAGE = `Сначала нажмите «${IMPORT_ACTION_LABEL}».`;

interface CareerIntakeProps {
  onComplete: (input: WorkspaceInput) => void;
  hasAccount?: boolean;
  /** Opens the account panel, so the wizard never names a door it cannot open. */
  onOpenAccount?: () => void;
  /**
   * Tells the shell a diagnostic is under way. The wizard's own source step
   * sends the candidate off to register, and the shell has to know that the
   * session arriving next belongs to an unfinished diagnostic rather than to a
   * returning candidate opening their cabinet (B141).
   */
  onStartedChange?: (started: boolean) => void;
  initialStarted?: boolean;
  initialStep?: IntakeStep;
  initialSourceChoice?: SourceChoice;
  initialConnectorPlatform?: ConnectionPlatform;
}

const goalOptions: Array<{
  id: CareerGoal;
  title: string;
  detail: string;
  icon: typeof Briefcase;
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

const conditionOptions = [
  'Только удалённо',
  'Готов к гибриду',
  'Рассматриваю релокацию',
  'Нужна визовая поддержка',
];

export function CareerIntake({
  onComplete,
  hasAccount = false,
  onStartedChange,
  initialStarted = false,
  initialStep = 'intent',
  initialSourceChoice = 'none',
  initialConnectorPlatform = 'hh',
}: CareerIntakeProps) {
  const [started, setStarted] = useState(initialStarted);
  const [step, setStep] = useState<IntakeStep>(initialStep);
  const [goal, setGoal] = useState<CareerGoal>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(initialSourceChoice);
  const [connectorPlatform, setConnectorPlatform] = useState<ConnectionPlatform>(initialConnectorPlatform);
  const [resumeText, setResumeText] = useState('');
  const [resumeSource, setResumeSource] = useState<ResumeSource>('text');
  const [resumeFile, setResumeFile] = useState<{
    name: string;
    pages: number;
  }>();
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [connections, setConnections] = useState<CandidateConnection[]>();
  const [connectingPlatform, setConnectingPlatform] = useState<ConnectionPlatform>();
  const [currentSituation, setCurrentSituation] = useState('');
  const [targetDirection, setTargetDirection] = useState('');
  const [market, setMarket] = useState<WorkspaceMarket>('ru');
  const [urgency, setUrgency] = useState<SearchUrgency>('active');
  const [conditions, setConditions] = useState<string[]>([]);
  const [otherConstraint, setOtherConstraint] = useState('');
  const [error, setError] = useState<string>();
  const [readingPdf, setReadingPdf] = useState(false);
  const [parsedResume, setParsedResume] = useState<ParsedResume>();
  const [parsedDraft, setParsedDraft] = useState<ResumeDraft>();
  const errorRef = useRef<HTMLParagraphElement>(null);

  /**
   * On a phone the wizard's action bar is sticky, so a refusal rendered above
   * it is painted over: the candidate presses «Продолжить», nothing appears to
   * happen, and the sentence saying why is under the bar. The refusal is
   * brought to the candidate instead.
   */
  useEffect(() => {
    if (!error) return;
    errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [error]);

  useEffect(() => {
    if (!hasAccount) {
      setConnections(undefined);
      return;
    }
    let current = true;
    void getConnections()
      .then((loaded) => {
        if (current) setConnections(loaded);
      })
      .catch(() => {
        if (current) setConnections([]);
      });
    return () => {
      current = false;
    };
  }, [hasAccount]);

  useEffect(() => {
    if (sourceChoice !== 'profile-import') return;
    const activeConnection = connections?.find((c) => c.platform === connectorPlatform);
    if (
      activeConnection?.status === 'connected' &&
      activeConnection.profile.facts.length > 0 &&
      !parsedResume
    ) {
      const headline = activeConnection.profile.facts.find((fact) => fact.kind === 'headline')?.value;
      const summary = activeConnection.profile.facts.find((fact) => fact.kind === 'summary')?.value;
      const allText = activeConnection.profile.facts.map((fact) => fact.value).join('\n');
      const parsed = parseResumeContent(allText);
      if (headline && !parsed.targetRole) {
        parsed.targetRole = headline;
      }
      if (summary && !parsed.about) {
        parsed.about = summary;
      }
      setParsedResume(parsed);
      setParsedDraft(parsedResumeToDraft(parsed));
      setResumeText(allText);
      setResumeSource(connectorPlatform === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
      if (parsed.targetRole && !targetDirection) {
        setTargetDirection(parsed.targetRole);
      }
    }
  }, [sourceChoice, connectorPlatform, connections, parsedResume, targetDirection]);

  if (!started) {
    return (
      <section className="career-start" aria-labelledby="career-start-title">
        <div className="career-start-stage">
          <p className="career-eyebrow">Сегодня</p>
          <h1 id="career-start-title">Начните с карьерного вопроса</h1>
          <p className="career-lead">
            Опишите ситуацию своими словами. Резюме можно добавить позже.
          </p>
          <div className="career-primary-actions">
            <button
              className="career-primary-button"
              type="button"
              onClick={() => {
                setStarted(true);
                onStartedChange?.(true);
              }}
            >
              Начать диагностику
              <ArrowRight size={18} weight="bold" />
            </button>
          </div>
          <p className="career-start-footnote">
            2–3 минуты на первичную диагностику. Без обязательной регистрации.
          </p>
        </div>

        <div className="career-start-status" aria-label="Состояние карьерной картины">
          <div><span>Профиль</span><strong>Не заполнен</strong></div>
          <div><span>Карьера</span><strong>Нет гипотез</strong></div>
          <div><span>Возможности</span><strong>Не добавлены</strong></div>
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

  async function handlePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReadingPdf(true);
    setError(undefined);
    try {
      const result = await extractPdfResume(file);
      const parsed = parseResumeContent(result.text);
      setParsedResume(parsed);
      const draft = parsedResumeToDraft(parsed);
      setParsedDraft(draft);
      setResumeText(result.text);
      setResumeSource('pdf');
      setResumeFile({ name: result.fileName, pages: result.pageCount });
      if (parsed.targetRole && !targetDirection) {
        setTargetDirection(parsed.targetRole);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Не удалось прочитать PDF. Можно продолжить без файла.',
      );
    } finally {
      setReadingPdf(false);
    }
  }

  async function handleConnectPlatform(platform: ConnectionPlatform) {
    setConnectingPlatform(platform);
    setError(undefined);
    const rawUrl = platform === 'hh' ? hhUrl.trim() : linkedinUrl.trim();
    const enteredUrl =
      rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;

    if (platform === 'hh') {
      if (!enteredUrl) {
        setConnectingPlatform(undefined);
        setError(
          'Вставьте ссылку на ваше резюме hh.ru (например, hh.ru/resume/...) либо загрузите PDF или введите опыт текстом.',
        );
        return;
      }
      try {
        const result = await importProfileUrl(enteredUrl);
        if (result.status === 'imported') {
          if (result.parsedResume) {
            setParsedResume(result.parsedResume);
            setParsedDraft(parsedResumeToDraft(result.parsedResume));
            setResumeText(result.parsedResume.rawText);
            setResumeSource('hh-pdf');
            if (result.parsedResume.targetRole && !targetDirection) {
              setTargetDirection(result.parsedResume.targetRole);
            }
            setError(undefined);
          } else {
            setError(
              'Не удалось прочитать структуру резюме. Загрузите PDF или введите опыт текстом.',
            );
          }
        } else if (result.reason === 'authwall') {
          setError(
            'hh.ru блокирует доступ через включённый VPN («VPN мешает работе сайта»). Выключите VPN для hh.ru либо загрузите резюме в формате PDF.',
          );
        } else if (result.reason === 'insufficient') {
          setError(
            'Не удалось извлечь данные резюме с hh.ru. Убедитесь, что резюме открыто для просмотра по ссылке, либо загрузите PDF.',
          );
        } else {
          setError(
            'Не удалось загрузить данные резюме с hh.ru. Проверьте ссылку (например, hh.ru/resume/...) либо загрузите PDF резюме.',
          );
        }
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Не удалось прочитать резюме по ссылке. Можно загрузить PDF или ввести опыт текстом.',
        );
      } finally {
        setConnectingPlatform(undefined);
      }
      return;
    }

    if (enteredUrl) {
      try {
        const result = await importProfileUrl(enteredUrl);
        if (result.status === 'imported' && result.parsedResume) {
          setParsedResume(result.parsedResume);
          setParsedDraft(parsedResumeToDraft(result.parsedResume));
          setResumeText(result.parsedResume.rawText);
          setResumeSource('linkedin-pdf');
          if (result.parsedResume.targetRole && !targetDirection) {
            setTargetDirection(result.parsedResume.targetRole);
          }
          setError(undefined);
          setConnectingPlatform(undefined);
          return;
        }
      } catch {
        // Fallback to official OAuth below
      }
    }

    try {
      const started = await startConnection(platform);
      openPlatformAuthPopup(started.authorizationUrl, (authResult) => {
        setConnectingPlatform(undefined);
        if (authResult?.status === 'connected') {
          void getConnections()
            .then((loaded) => setConnections(loaded))
            .catch(() => undefined);
        } else if (authResult?.status === 'declined') {
          setError('Подключение площадки отменено.');
        }
      });
    } catch (reason) {
      setConnectingPlatform(undefined);
      setError(
        reason instanceof Error
          ? reason.message
          : `Не удалось начать подключение ${PLATFORM_LABELS[platform]}. Можно загрузить PDF или ввести опыт текстом.`,
      );
    }
  }

  function chooseSource(nextSource: SourceChoice) {
    if (nextSource === sourceChoice) return;
    setSourceChoice(nextSource);
    setError(undefined);
    setResumeText('');
    setResumeSource('text');
    if (nextSource !== 'pdf') setResumeFile(undefined);
    if (nextSource !== 'profile-import') {
      setLinkedinUrl('');
      setHhUrl('');
    }
  }

  function moveFromIntent() {
    if (!goal) {
      setError('Выберите ближайшую задачу или начните с собственного описания.');
      return;
    }
    setError(undefined);
    setStep('source');
  }

  async function moveFromSource() {
    if (sourceChoice === 'profile-import') {
      const platformLabel = PLATFORM_LABELS[connectorPlatform];
      const activeConnection = connections?.find((c) => c.platform === connectorPlatform);
      const rawUrl = connectorPlatform === 'hh' ? hhUrl.trim() : linkedinUrl.trim();
      const enteredUrl =
        rawUrl && !/^https?:\/\//i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;

      if (activeConnection?.status !== 'connected' && !parsedResume && !resumeText.trim()) {
        if (!enteredUrl) {
          setError(
            `Подключите ${platformLabel} или выберите другой способ: PDF, текст либо «Без документов».`,
          );
          return;
        }
        try {
          const result = await importProfileUrl(enteredUrl);
          if (result.status === 'imported') {
            if (result.parsedResume) {
              setParsedResume(result.parsedResume);
              setParsedDraft(parsedResumeToDraft(result.parsedResume));
              setResumeText(result.parsedResume.rawText);
              setResumeSource(connectorPlatform === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
              if (result.parsedResume.targetRole && !targetDirection) {
                setTargetDirection(result.parsedResume.targetRole);
              }
            }
          } else if (result.reason === 'authwall') {
            setError(
              'hh.ru блокирует доступ через включённый VPN («VPN мешает работе сайта»). Выключите VPN для hh.ru либо загрузите резюме в формате PDF.',
            );
            return;
          } else {
            setError(
              `Не удалось загрузить данные ${platformLabel}. Проверьте ссылку либо загрузите PDF.`,
            );
            return;
          }
        } catch (reason) {
          setError(
            reason instanceof Error
              ? reason.message
              : `Не удалось прочитать ${platformLabel}. Нажмите «Подключить» или загрузите PDF.`,
          );
          return;
        }
      }
      if (parsedResume) {
        setResumeSource(connectorPlatform === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
      }
    }
    if (sourceChoice === 'text' && resumeText.trim().length > 0 && resumeText.trim().length < 80) {
      setError('Добавьте чуть больше контекста или продолжите без документа.');
      return;
    }
    setError(undefined);
    setStep('context');
  }

  function complete() {
    const selectedGoal = goalOptions.find((item) => item.id === goal);
    const situation = currentSituation.trim();
    const input: WorkspaceInput = {
      careerGoal: goal,
      resumeText: sourceChoice === 'none' ? '' : resumeText,
      resumeSource:
        sourceChoice === 'pdf' && resumeFile
          ? resumeSource
          : sourceChoice === 'profile-import'
            ? connectorPlatform === 'hh'
              ? 'hh-pdf'
              : 'linkedin-pdf'
            : 'text',
      resumeFileName: sourceChoice === 'pdf' ? resumeFile?.name : undefined,
      resumePageCount: sourceChoice === 'pdf' ? resumeFile?.pages : undefined,
      targetDirection,
      market,
      currentSituation: situation,
      constraints: [...conditions, otherConstraint.trim()]
        .filter(Boolean)
        .join('. '),
      urgency,
      linkedinUrl:
        sourceChoice === 'profile-import' && connectorPlatform === 'linkedin'
          ? linkedinUrl.trim() || undefined
          : undefined,
      hhUrl:
        sourceChoice === 'profile-import' && connectorPlatform === 'hh'
          ? hhUrl.trim() || undefined
          : undefined,
      resumeDraft: parsedDraft,
      parsedResume,
    };
    const errors = validateWorkspaceInput(input);
    if (errors.currentSituation) {
      setError(
        'Добавьте пару предложений о вашей ситуации. Это заменяет длинную анкету.',
      );
      return;
    }
    if (errors.linkedinUrl) {
      setError(errors.linkedinUrl);
      return;
    }
    if (errors.hhUrl) {
      setError(errors.hhUrl);
      return;
    }
    if (errors.resumeText && !situation) {
      setError(errors.resumeText);
      return;
    }
    if (!situation && selectedGoal) {
      setError('Расскажите, что происходит сейчас и почему вы решили искать изменение.');
      return;
    }
    onComplete(input);
  }

  return (
    <section className="career-intake" aria-labelledby="intake-title">
      <header className="career-intake-header">
        <div>
          <p className="career-eyebrow">Карьерная диагностика</p>
          <h1 id="intake-title">
            {step === 'intent'
              ? 'С чем разобраться?'
              : step === 'source'
                ? 'Что уже есть?'
                : 'Что должно измениться?'}
          </h1>
          <p className="career-lead">
            {step === 'intent'
              ? 'Начните с вопроса. Платформа сама выберет, что уточнить дальше.'
              : step === 'source'
                ? 'Добавьте резюме или профиль, либо продолжите разговор без документов.'
                : 'Достаточно нескольких фактов. Неизвестный ответ можно оставить неизвестным.'}
          </p>
        </div>
        <ol className="career-intake-progress" aria-label="Прогресс консультации">
          {(['intent', 'source', 'context'] as IntakeStep[]).map(
            (item, index) => (
              <li
                key={item}
                className={item === step ? 'is-current' : ''}
                aria-current={item === step ? 'step' : undefined}
              >
                {String(index + 1).padStart(2, '0')}
              </li>
            ),
          )}
        </ol>
      </header>

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
        <div className="career-source-step">
          <div className="career-source-choice" role="group" aria-label="Источник опыта">
            <SourceButton
              icon={GlobeHemisphereWest}
              label="Импорт профиля"
              selected={sourceChoice === 'profile-import'}
              onClick={() => chooseSource('profile-import')}
            />
            <SourceButton
              icon={FilePdf}
              label="PDF"
              selected={sourceChoice === 'pdf'}
              onClick={() => chooseSource('pdf')}
            />
            <SourceButton
              icon={Sparkle}
              label="Текстом"
              selected={sourceChoice === 'text'}
              onClick={() => chooseSource('text')}
            />
            <SourceButton
              icon={ArrowRight}
              label="Без документов"
              selected={sourceChoice === 'none'}
              onClick={() => chooseSource('none')}
            />
          </div>

          {sourceChoice === 'pdf' ? (
            <div className="career-pdf-source-container" style={{ marginTop: '22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <label
                  className="career-primary-button career-file-button"
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    minWidth: '160px',
                    height: '42px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handlePdf}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0,
                      width: '100%',
                      height: '100%',
                      cursor: 'pointer',
                      zIndex: 2,
                    }}
                  />
                  <FilePdf size={20} />
                  <span>{readingPdf ? 'Читаем файл…' : resumeFile ? resumeFile.name : 'Выбрать PDF'}</span>
                </label>
                <small style={{ color: 'var(--career-text-dim)', fontSize: '13px' }}>
                  {resumeFile
                    ? `${resumeFile.pages} стр. · резюме импортировано в Resume Studio`
                    : 'PDF до 20 МБ · оригинал не отправляется'}
                </small>
              </div>

              {parsedResume && resumeFile ? (
                <div
                  className="career-source-parsed-badge"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    padding: '16px',
                    background: 'rgba(34, 197, 94, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                    borderRadius: '12px',
                    marginTop: '16px',
                    marginBottom: '16px',
                  }}
                >
                  <CheckCircle
                    size={28}
                    weight="fill"
                    style={{ color: '#22c55e', flexShrink: 0, marginTop: '2px' }}
                  />
                  <div>
                    <strong
                      style={{
                        fontSize: '15px',
                        color: '#22c55e',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      Резюме успешно загружено и распарсено в Resume Studio
                    </strong>
                    <span
                      style={{
                        fontSize: '13px',
                        opacity: 0.9,
                        lineHeight: '1.4',
                        display: 'block',
                      }}
                    >
                      Файл «{resumeFile.name}» ({resumeFile.pages} стр.) · Найдено:{' '}
                      {parsedResume.experience.length} мест работы,{' '}
                      {parsedResume.skills.length} навыков,{' '}
                      {parsedResume.education.length} записей образования,{' '}
                      {parsedResume.courses.length} сертификатов/курсов, контакты и блок «О себе».
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {sourceChoice === 'profile-import' ? (
            <div className="career-source-fields">
              <div className="career-source-connector-select-group">
                <label htmlFor="connector-platform-select" className="career-source-select-label">
                  Площадка для импорта
                </label>
                <div className="career-connector-select-wrapper">
                  <select
                    id="connector-platform-select"
                    className="career-connector-select"
                    value={connectorPlatform}
                    onChange={(e) => {
                      const next = e.target.value as ConnectionPlatform;
                      setConnectorPlatform(next);
                      setError(undefined);
                    }}
                  >
                    <option value="hh">hh.ru (HeadHunter)</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </div>
              </div>

              {parsedResume ? (
                <div
                  className="career-source-parsed-badge"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '14px',
                    padding: '16px',
                    background: 'rgba(34, 197, 94, 0.12)',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                    borderRadius: '12px',
                    marginTop: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <CheckCircle
                    size={28}
                    weight="fill"
                    style={{ color: '#22c55e', flexShrink: 0, marginTop: '2px' }}
                  />
                  <div>
                    <strong
                      style={{
                        fontSize: '15px',
                        color: '#22c55e',
                        display: 'block',
                        marginBottom: '4px',
                      }}
                    >
                      Данные профиля {PLATFORM_LABELS[connectorPlatform]} готовы для Resume Studio
                    </strong>
                    <span
                      style={{
                        fontSize: '13px',
                        opacity: 0.9,
                        lineHeight: '1.4',
                        display: 'block',
                      }}
                    >
                      Найдено: {parsedResume.experience.length} мест работы,{' '}
                      {parsedResume.skills.length} навыков,{' '}
                      {parsedResume.education.length} записей образования,{' '}
                      {parsedResume.courses.length} курсов.
                    </span>
                  </div>
                </div>
              ) : null}

              <PlatformIntegrationCard
                platform={connectorPlatform}
                url={connectorPlatform === 'linkedin' ? linkedinUrl : hhUrl}
                onUrlChange={(val) => {
                  if (connectorPlatform === 'linkedin') setLinkedinUrl(val);
                  else setHhUrl(val);
                }}
                isConnected={
                  connectorPlatform === 'hh'
                    ? Boolean(
                        connections?.some((c) => c.platform === 'hh' && c.status === 'connected') ||
                          (parsedResume && resumeSource === 'hh-pdf'),
                      )
                    : Boolean(
                        connections?.some((c) => c.platform === 'linkedin' && c.status === 'connected') ||
                          (parsedResume && resumeSource === 'linkedin-pdf'),
                      )
                }
                isConnecting={connectingPlatform === connectorPlatform}
                onConnect={() => handleConnectPlatform(connectorPlatform)}
              />
            </div>
          ) : null}

          {sourceChoice === 'text' ? (
            <label className="career-source-textarea">
              <span>Опыт, проекты или фрагмент резюме</span>
              <textarea
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder="Например: чем вы управляли, что изменили, с кем работали и за какой результат отвечали."
                rows={8}
              />
            </label>
          ) : null}

          {sourceChoice === 'none' ? (
            <p className="career-inline-note">
              Это нормальный старт. Сначала зададим один вопрос об опыте и не
              будем оценивать резюме, которого нет.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'context' ? (
        <div className="career-context-form">
          <label className="career-field-wide">
            <span>Что происходит сейчас?</span>
            <textarea
              value={currentSituation}
              onChange={(event) => setCurrentSituation(event.target.value)}
              placeholder="Например: давно не получаю приглашений, хочу сменить рынок, возвращаюсь после перерыва или не понимаю свой уровень."
              rows={4}
            />
            <small>Это станет первым контекстом для карьерного эксперта.</small>
          </label>
          <label>
            <span>Какая роль интересует?</span>
            <input
              value={targetDirection}
              onChange={(event) => setTargetDirection(event.target.value)}
              placeholder="Можно оставить пустым"
            />
          </label>
          <fieldset>
            <legend>Где рассматриваете работу?</legend>
            <div className="career-segmented-control">
              <button
                type="button"
                className={market === 'ru' ? 'is-selected' : ''}
                aria-pressed={market === 'ru'}
                onClick={() => setMarket('ru')}
              >
                Россия
              </button>
              <button
                type="button"
                className={market === 'international' ? 'is-selected' : ''}
                aria-pressed={market === 'international'}
                onClick={() => setMarket('international')}
              >
                Международный рынок
              </button>
            </div>
          </fieldset>
          <fieldset className="career-field-wide">
            <legend>Что важно учесть?</legend>
            <div className="career-chip-picker">
              {conditionOptions.map((condition) => {
                const selected = conditions.includes(condition);
                return (
                  <button
                    key={condition}
                    type="button"
                    className={selected ? 'is-selected' : ''}
                    aria-pressed={selected}
                    onClick={() =>
                      setConditions((current) =>
                        selected
                          ? current.filter((item) => item !== condition)
                          : [...current, condition],
                      )
                    }
                  >
                    {selected ? <Check size={15} weight="bold" /> : null}
                    {condition}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label>
            <span>Другие ограничения</span>
            <input
              value={otherConstraint}
              onChange={(event) => setOtherConstraint(event.target.value)}
              placeholder="Язык, график, доход, отрасль…"
            />
          </label>
          <fieldset>
            <legend>Темп поиска</legend>
            <div className="career-segmented-control">
              {([
                ['exploring', 'Изучаю'],
                ['active', 'Ищу активно'],
                ['urgent', 'Нужно быстро'],
              ] as Array<[SearchUrgency, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={urgency === value ? 'is-selected' : ''}
                  aria-pressed={urgency === value}
                  onClick={() => setUrgency(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}

      {error ? (
        <p className="career-intake-error" role="alert" ref={errorRef}>
          {error}
        </p>
      ) : null}

      <footer className="career-intake-actions">
        {step !== 'intent' ? (
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
        ) : <span />}
        <button
          className="career-primary-button"
          type="button"
          onClick={
            step === 'intent'
              ? moveFromIntent
              : step === 'source'
                ? moveFromSource
                : complete
          }
        >
          {step === 'context' ? 'Собрать карьерную картину' : 'Продолжить'}
          <ArrowRight size={18} weight="bold" />
        </button>
      </footer>
    </section>
  );
}

function PlatformIntegrationCard({
  platform,
  url,
  onUrlChange,
  isConnected,
  isConnecting,
  onConnect,
}: {
  platform: 'linkedin' | 'hh';
  url: string;
  onUrlChange: (url: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
}) {
  const isHh = platform === 'hh';
  const label = isHh ? 'Ссылка на резюме hh.ru' : 'Ссылка на профиль LinkedIn';
  const placeholder = isHh ? 'https://hh.ru/resume/...' : 'https://www.linkedin.com/in/...';
  const disclaimer = isHh
    ? '«Подключить» открывает защищённую сессию для прямого анализа и синхронизации вашего резюме на hh.ru.'
    : '«Подключить» открывает защищённый доступ для глубокого анализа и синхронизации профиля LinkedIn.';

  return (
    <div className="career-source-card">
      <div className="career-source-row">
        <label className="career-source-url-label">
          <span>{label}</span>
          <input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={placeholder}
            inputMode="url"
          />
        </label>
        <div className="career-source-actions">
          {isConnected ? (
            <span className="career-source-connected-badge" role="status">
              <CheckCircle size={20} weight="fill" /> Подключено к {PLATFORM_LABELS[platform]}
            </span>
          ) : (
            <button
              className="career-primary-button"
              type="button"
              disabled={isConnecting}
              onClick={onConnect}
            >
              {isConnecting ? 'Подключение…' : 'Подключить'}
            </button>
          )}
        </div>
      </div>
      <p className="career-source-disclaimer">{disclaimer}</p>
    </div>
  );
}

function SourceButton({
  icon: Icon,
  label,
  selected,
  onClick,
}: {
  icon: typeof FilePdf;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : ''}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon size={20} weight={selected ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  );
}
