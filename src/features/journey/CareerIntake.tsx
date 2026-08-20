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
  type CandidateConnection,
} from '../coach/coachApi';
import type { ConnectionPlatform } from '../connections/connectionResult';
import {
  LinkedInConnectModal,
  HhConnectModal,
  WebDesktopCtaCallout,
  type HhResumeItem,
} from '../connections/ProfileImportModals';
import {
  desktopNativeFetch,
  isTauriEnvironment,
} from '../../services/desktop/desktopBridge';
import { parseHhResumeHtml } from '../../services/connectors/hhResumeParser';
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
  initialSourceChoice = 'profile-import',
}: CareerIntakeProps) {
  const isDesktop = isTauriEnvironment();
  const [started, setStarted] = useState(initialStarted);
  const [step, setStep] = useState<IntakeStep>(initialStep);
  const [goal, setGoal] = useState<CareerGoal>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(initialSourceChoice);
  const [resumeText, setResumeText] = useState('');
  const [resumeSource, setResumeSource] = useState<ResumeSource>('text');
  const [resumeFile, setResumeFile] = useState<{
    name: string;
    pages: number;
  }>();
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [hhUrl, setHhUrl] = useState('');
  const [connections, setConnections] = useState<CandidateConnection[]>();
  const [isLinkedinModalOpen, setIsLinkedinModalOpen] = useState(false);
  const [isHhModalOpen, setIsHhModalOpen] = useState(false);
  const [hhResumes, setHhResumes] = useState<HhResumeItem[]>([]);
  const [selectedHhResumeId, setSelectedHhResumeId] = useState<string>('');
  const [isHhConnected, setIsHhConnected] = useState(false);
  const [isLinkedinConnected, setIsLinkedinConnected] = useState(false);
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

  const isSourceLocked = Boolean(
    parsedResume && (resumeSource === 'hh-pdf' || resumeSource === 'linkedin-pdf'),
  );

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
    const activeConnection = connections?.find(
      (c) => (c.platform === 'hh' || c.platform === 'linkedin') && c.status === 'connected',
    );
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
      setResumeSource(activeConnection.platform === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
      if (parsed.targetRole && !targetDirection) {
        setTargetDirection(parsed.targetRole);
      }
    }
  }, [sourceChoice, connections, parsedResume, targetDirection]);

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

  function handleLinkedInSuccess(parsed: ParsedResume, rawUrl: string) {
    setParsedResume(parsed);
    setParsedDraft(parsedResumeToDraft(parsed));
    setResumeText(parsed.rawText);
    setResumeSource('linkedin-pdf');
    setLinkedinUrl(rawUrl);
    setIsLinkedinConnected(true);
    if (parsed.targetRole && !targetDirection) {
      setTargetDirection(parsed.targetRole);
    }
    setError(undefined);
  }

  function handleHhSuccess(resumes: HhResumeItem[], defaultParsed?: ParsedResume, rawUrl?: string) {
    setHhResumes(resumes);
    setIsHhConnected(true);
    if (rawUrl) setHhUrl(rawUrl);
    if (resumes.length > 0) {
      setSelectedHhResumeId(resumes[0].id);
    }
    if (defaultParsed) {
      setParsedResume(defaultParsed);
      setParsedDraft(parsedResumeToDraft(defaultParsed));
      setResumeText(defaultParsed.rawText);
      setResumeSource('hh-pdf');
      if (defaultParsed.targetRole && !targetDirection) {
        setTargetDirection(defaultParsed.targetRole);
      }
    }
    setError(undefined);
  }

  async function handleImportSelectedHhResume() {
    const selected = hhResumes.find((r) => r.id === selectedHhResumeId) || hhResumes[0];
    if (!selected) {
      setError('Выберите резюме для импорта.');
      return;
    }
    setError(undefined);
    try {
      if (isTauriEnvironment()) {
        const nativeRes = await desktopNativeFetch({
          url: selected.url,
          method: 'GET',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (nativeRes && nativeRes.body) {
          const parsed = parseHhResumeHtml(nativeRes.body, selected.url);
          setParsedResume(parsed);
          setParsedDraft(parsedResumeToDraft(parsed));
          setResumeText(parsed.rawText);
          setResumeSource('hh-pdf');
          if (parsed.targetRole && !targetDirection) {
            setTargetDirection(parsed.targetRole);
          }
          return;
        }
      }
      const result = await importProfileUrl(selected.url);
      if (result.status === 'imported' && result.parsedResume) {
        setParsedResume(result.parsedResume);
        setParsedDraft(parsedResumeToDraft(result.parsedResume));
        setResumeText(result.parsedResume.rawText);
        setResumeSource('hh-pdf');
        if (result.parsedResume.targetRole && !targetDirection) {
          setTargetDirection(result.parsedResume.targetRole);
        }
      } else {
        setError('Не удалось импортировать выбранное резюме.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось импортировать выбранное резюме.');
    }
  }

  function chooseSource(nextSource: SourceChoice) {
    if (isSourceLocked) return;
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
      if (!parsedResume && !resumeText.trim()) {
        if (!isDesktop) {
          setError(
            'В веб-версии скачайте десктопное приложение для импорта профилей либо выберите PDF, текст или «Без документов».',
          );
        } else {
          setError(
            'Подключите LinkedIn или hh.ru либо выберите другой способ: PDF, текст или «Без документов».',
          );
        }
        return;
      }
      if (parsedResume) {
        setResumeSource(resumeSource === 'hh-pdf' ? 'hh-pdf' : 'linkedin-pdf');
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
            ? resumeSource === 'hh-pdf'
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
        sourceChoice === 'profile-import' && (resumeSource === 'linkedin-pdf' || Boolean(linkedinUrl.trim()))
          ? linkedinUrl.trim() || undefined
          : undefined,
      hhUrl:
        sourceChoice === 'profile-import' && (resumeSource === 'hh-pdf' || Boolean(hhUrl.trim()))
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
              disabled={isSourceLocked && sourceChoice !== 'profile-import'}
              onClick={() => chooseSource('profile-import')}
            />
            <SourceButton
              icon={FilePdf}
              label="PDF"
              selected={sourceChoice === 'pdf'}
              disabled={isSourceLocked && sourceChoice !== 'pdf'}
              onClick={() => chooseSource('pdf')}
            />
            <SourceButton
              icon={Sparkle}
              label="Текстом"
              selected={sourceChoice === 'text'}
              disabled={isSourceLocked && sourceChoice !== 'text'}
              onClick={() => chooseSource('text')}
            />
            <SourceButton
              icon={ArrowRight}
              label="Без документов"
              selected={sourceChoice === 'none'}
              disabled={isSourceLocked && sourceChoice !== 'none'}
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
                    cursor: isSourceLocked ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    minWidth: '160px',
                    height: '42px',
                    padding: '0 20px',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    opacity: isSourceLocked ? 0.6 : 1,
                  }}
                >
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handlePdf}
                    disabled={isSourceLocked}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0,
                      width: '100%',
                      height: '100%',
                      cursor: isSourceLocked ? 'not-allowed' : 'pointer',
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
              {!isDesktop ? (
                <WebDesktopCtaCallout />
              ) : (
                <>
                  <div className="career-platform-cards">
                    <div
                      className={`career-platform-card ${isLinkedinConnected || (parsedResume && resumeSource === 'linkedin-pdf') ? 'is-connected' : ''}`}
                    >
                      <div className="career-platform-card-header">
                        <div className="career-platform-card-title">
                          <GlobeHemisphereWest size={22} weight="bold" style={{ color: '#0077b5' }} />
                          <span>LinkedIn</span>
                        </div>
                        <span
                          className={`career-platform-card-badge ${isLinkedinConnected || (parsedResume && resumeSource === 'linkedin-pdf') ? 'is-connected' : ''}`}
                        >
                          {isLinkedinConnected || (parsedResume && resumeSource === 'linkedin-pdf')
                            ? 'Подключено'
                            : 'Не подключено'}
                        </span>
                      </div>
                      <p className="career-platform-card-desc">
                        Импорт структуры опыта, ключевых навыков и образования в Resume Studio.
                      </p>
                      <button
                        type="button"
                        className="career-primary-button career-platform-card-action"
                        disabled={isSourceLocked && !(parsedResume && resumeSource === 'linkedin-pdf')}
                        onClick={() => setIsLinkedinModalOpen(true)}
                      >
                        {isLinkedinConnected || (parsedResume && resumeSource === 'linkedin-pdf')
                          ? 'Изменить'
                          : 'Подключить'}
                      </button>
                    </div>

                    <div
                      className={`career-platform-card ${isHhConnected || (parsedResume && resumeSource === 'hh-pdf') ? 'is-connected' : ''}`}
                    >
                      <div className="career-platform-card-header">
                        <div className="career-platform-card-title">
                          <GlobeHemisphereWest size={22} weight="bold" style={{ color: '#d6001c' }} />
                          <span>hh.ru (HeadHunter)</span>
                        </div>
                        <span
                          className={`career-platform-card-badge ${isHhConnected || (parsedResume && resumeSource === 'hh-pdf') ? 'is-connected' : ''}`}
                        >
                          {isHhConnected || (parsedResume && resumeSource === 'hh-pdf')
                            ? 'Подключено'
                            : 'Не подключено'}
                        </span>
                      </div>
                      <p className="career-platform-card-desc">
                        Прямой импорт резюме HeadHunter с динамической проверкой соединения.
                      </p>
                      <button
                        type="button"
                        className="career-primary-button career-platform-card-action"
                        disabled={isSourceLocked && !(parsedResume && resumeSource === 'hh-pdf')}
                        onClick={() => setIsHhModalOpen(true)}
                      >
                        {isHhConnected || (parsedResume && resumeSource === 'hh-pdf')
                          ? 'Изменить'
                          : 'Подключить'}
                      </button>
                    </div>
                  </div>

                  {isHhConnected && hhResumes.length > 0 ? (
                    <div className="career-hh-resumes-selector">
                      <label htmlFor="hh-resume-dropdown">Выберите резюме для импорта</label>
                      <div className="career-hh-resumes-row">
                        <select
                          id="hh-resume-dropdown"
                          className="career-hh-resumes-select"
                          value={selectedHhResumeId}
                          onChange={(e) => setSelectedHhResumeId(e.target.value)}
                          disabled={isSourceLocked}
                        >
                          {hhResumes.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.title}
                            </option>
                          ))}
                        </select>
                        {!(parsedResume && resumeSource === 'hh-pdf') ? (
                          <button
                            type="button"
                            className="career-primary-button"
                            onClick={() => void handleImportSelectedHhResume()}
                          >
                            Импортировать
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : isHhConnected && hhResumes.length === 0 ? (
                    <p className="career-inline-note">
                      Резюме не найдены в профиле hh.ru. Можно загрузить PDF или ввести опыт текстом.
                    </p>
                  ) : null}

                  {parsedResume &&
                  (resumeSource === 'hh-pdf' || resumeSource === 'linkedin-pdf') ? (
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
                          Данные профиля {resumeSource === 'hh-pdf' ? 'HeadHunter (hh.ru)' : 'LinkedIn'} загружены в Resume Studio
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
                          {parsedResume.languages.length} языков. Опции заблокированы для защиты данных.
                        </span>
                      </div>
                    </div>
                  ) : null}

                  <LinkedInConnectModal
                    isOpen={isLinkedinModalOpen}
                    onClose={() => setIsLinkedinModalOpen(false)}
                    onImportSuccess={handleLinkedInSuccess}
                    initialUrl={linkedinUrl}
                  />

                  <HhConnectModal
                    isOpen={isHhModalOpen}
                    onClose={() => setIsHhModalOpen(false)}
                    onConnectSuccess={handleHhSuccess}
                    initialUrl={hhUrl}
                  />
                </>
              )}
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

function SourceButton({
  icon: Icon,
  label,
  selected,
  disabled,
  onClick,
}: {
  icon: typeof FilePdf;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : ''}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={20} weight={selected ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>
  );
}
