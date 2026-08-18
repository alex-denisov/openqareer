import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  CheckCircle,
  FilePdf,
  GlobeHemisphereWest,
  LinkedinLogo,
  Question,
  Sparkle,
  Target,
} from '@phosphor-icons/react';
import {
  getConnections,
  importProfileUrl,
  startConnection,
  type CandidateConnection,
  type ProfileUrlImportResult,
} from '../coach/coachApi';
import { PLATFORM_LABELS, type ConnectionPlatform } from '../connections/connectionResult';
import { accountRequiredNotice } from '../connections/connectionState';
import {
  ingestProfileSnapshot,
  reviewProfileFact,
  type ProfileFact,
} from '../workspace/profileIngestion';
import { extractPdfResume } from '../workspace/pdfResume';
import {
  parseResumeContent,
  parsedResumeToDraft,
  parsedResumeToFactDrafts,
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

type IntakeStep = 'intent' | 'source' | 'context';
type SourceChoice = 'pdf' | 'linkedin' | 'hh' | 'text' | 'none';

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
}

/**
 * The wizard's own copy and its button must never drift apart: the owner hit a
 * message pointing at «Импортировать по ссылке» while the button said something
 * else, so both now read the same constant.
 */
export const IMPORT_ACTION_LABEL = 'Импортировать';

export const PRESS_IMPORT_FIRST_MESSAGE = `Сначала нажмите «${IMPORT_ACTION_LABEL}».`;

interface ProfileFactDraft {
  fact: ProfileFact;
  value: string;
  decision: 'pending' | 'confirmed' | 'corrected' | 'rejected';
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
  onOpenAccount,
  onStartedChange,
}: CareerIntakeProps) {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState<IntakeStep>('intent');
  const [goal, setGoal] = useState<CareerGoal>();
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>('none');
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
  const [profileImport, setProfileImport] = useState<ProfileUrlImportResult>();
  const [profileFactDrafts, setProfileFactDrafts] = useState<ProfileFactDraft[]>([]);
  const [importingProfile, setImportingProfile] = useState(false);
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
   * brought to the candidate instead. `scroll-margin-block-end` on the element
   * is what keeps the bar out of the way; the scroll is instant, because this
   * is a correction and not an animation.
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
    if (sourceChoice !== 'linkedin' && sourceChoice !== 'hh') return;
    const activeConnection = connections?.find((c) => c.platform === sourceChoice);
    if (
      activeConnection?.status === 'connected' &&
      activeConnection.profile.facts.length > 0 &&
      profileFactDrafts.length === 0
    ) {
      const snapshot = ingestProfileSnapshot({
        state: 'available',
        source: {
          sourceId: `${sourceChoice}-official`,
          platform: sourceChoice,
          accessPath: 'official_api',
          capturedAt: activeConnection.profile.capturedAt,
        },
        snapshot: {
          headline: activeConnection.profile.facts.find((fact) => fact.kind === 'headline')?.value,
          summary: activeConnection.profile.facts.find((fact) => fact.kind === 'summary')?.value,
          positions: [],
          education: [],
          skills: [],
        },
      });
      if (snapshot.state === 'ready_for_confirmation') {
        setProfileFactDrafts(
          snapshot.facts.map((fact) => ({
            fact,
            value: fact.statement,
            decision: 'confirmed',
          })),
        );
      }
    }
  }, [sourceChoice, connections, profileFactDrafts.length]);

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
      setProfileFactDrafts([]);
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
    try {
      const started = await startConnection(platform);
      window.location.assign(started.authorizationUrl);
    } catch (reason) {
      setConnectingPlatform(undefined);
      setError(
        reason instanceof Error
          ? reason.message
          : `Не удалось начать подключение ${PLATFORM_LABELS[platform]}. Можно загрузить PDF или ввести опыт текстом.`,
      );
    }
  }

  async function handleProfileUrlImport() {
    const url = sourceChoice === 'linkedin' ? linkedinUrl.trim() : hhUrl.trim();
    if (!url) {
      setError('Вставьте ссылку на профиль или резюме.');
      return;
    }
    setImportingProfile(true);
    setError(undefined);
    setProfileImport(undefined);
    setProfileFactDrafts([]);
    try {
      const result = await importProfileUrl(url);
      setProfileImport(result);
      if (result.status === 'imported') {
        if (result.parsedResume) {
          const parsed = result.parsedResume;
          setParsedResume(parsed);
          const draft = parsedResumeToDraft(parsed);
          setParsedDraft(draft);
          const factDrafts = parsedResumeToFactDrafts(parsed, profileSourceId(result));
          setProfileFactDrafts(factDrafts);
          setResumeText(parsed.rawText || result.facts.map((f) => f.value).join('\n'));
          setResumeSource(sourceChoice === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
          if (parsed.targetRole && !targetDirection) {
            setTargetDirection(parsed.targetRole);
          }
        } else {
          const snapshot = ingestProfileSnapshot({
            state: 'available',
            source: {
              sourceId: profileSourceId(result),
              platform: result.platform,
              accessPath: result.accessPath,
              capturedAt: result.capturedAt,
            },
            snapshot: {
              headline: result.facts.find((fact) => fact.kind === 'headline')?.value,
              summary: result.facts.find((fact) => fact.kind === 'summary')?.value,
              positions: [],
              education: [],
              skills: [],
            },
          });
          if (snapshot.state === 'ready_for_confirmation') {
            setProfileFactDrafts(
              snapshot.facts.map((fact) => {
                const source = result.facts.find(
                  (item) => item.kind === fact.kind && item.value === fact.statement,
                );
                const factWithSourceLocator = {
                  ...fact,
                  provenance: {
                    ...fact.provenance,
                    locator: source?.sourceLocator ?? fact.provenance.locator,
                  },
                };
                return {
                  fact: factWithSourceLocator,
                  value: factWithSourceLocator.statement,
                  decision: 'pending' as const,
                };
              }),
            );
          }
          const parsed = parseResumeContent(result.facts.map((f) => f.value).join('\n') || url);
          setParsedResume(parsed);
          setResumeText(result.facts.map((f) => f.value).join('\n'));
        }
      } else {
        // Fallback parse if text or URL structure is available
        const parsed = parseResumeContent(resumeText || url);
        setParsedResume(parsed);
        const draft = parsedResumeToDraft(parsed);
        setParsedDraft(draft);
        const factDrafts = parsedResumeToFactDrafts(parsed, `${sourceChoice}-resume`);
        setProfileFactDrafts(factDrafts);
        if (parsed.targetRole && !targetDirection) {
          setTargetDirection(parsed.targetRole);
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Не удалось проверить ссылку. Можно загрузить экспорт или PDF.',
      );
    } finally {
      setImportingProfile(false);
    }
  }

  function chooseSource(nextSource: SourceChoice) {
    if (nextSource === sourceChoice) return;
    setSourceChoice(nextSource);
    setError(undefined);
    setProfileImport(undefined);
    setProfileFactDrafts([]);
    setResumeText('');
    setResumeSource('text');
    if (nextSource !== 'pdf') setResumeFile(undefined);
    if (nextSource !== 'linkedin') setLinkedinUrl('');
    if (nextSource !== 'hh') setHhUrl('');
  }

  function moveFromIntent() {
    if (!goal) {
      setError('Выберите ближайшую задачу или начните с собственного описания.');
      return;
    }
    setError(undefined);
    setStep('source');
  }

  function moveFromSource() {
    if (sourceChoice === 'linkedin' || sourceChoice === 'hh') {
      const platformLabel = PLATFORM_LABELS[sourceChoice];
      if (profileFactDrafts.some((draft) => draft.decision === 'pending')) {
        setError('Проверьте каждый найденный факт: подтвердите, исправьте или исключите.');
        return;
      }
      const reviewedFacts = acceptedProfileFacts(profileFactDrafts);
      if (reviewedFacts.length > 0) {
        setResumeText(reviewedFacts.map((fact) => fact.statement).join('\n'));
        setResumeSource(sourceChoice === 'hh' ? 'hh-pdf' : 'linkedin-pdf');
      } else {
        const activeConnection = connections?.find((c) => c.platform === sourceChoice);
        if (activeConnection?.status !== 'connected' && !parsedResume && !resumeText.trim()) {
          setError(
            `Подключите ${platformLabel}, импортируйте резюме по ссылке или выберите другой способ: PDF, текст либо «Без документов».`,
          );
          return;
        }
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
        sourceChoice === 'pdf' && resumeFile ? resumeSource : 'text',
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
        sourceChoice === 'linkedin' ? linkedinUrl.trim() || undefined : undefined,
      hhUrl: sourceChoice === 'hh' ? hhUrl.trim() || undefined : undefined,
      profileFacts:
        profileFactDrafts.length > 0
          ? acceptedProfileFacts(profileFactDrafts)
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
          <p className="career-eyebrow">Бесплатная карьерная картина</p>
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
              icon={LinkedinLogo}
              label="LinkedIn"
              selected={sourceChoice === 'linkedin'}
              onClick={() => chooseSource('linkedin')}
            />
            <SourceButton
              icon={Briefcase}
              label="hh.ru"
              selected={sourceChoice === 'hh'}
              onClick={() => chooseSource('hh')}
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

          {sourceChoice === 'linkedin' || sourceChoice === 'hh' ? (
            <div className="career-source-fields">
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
                      Резюме {sourceChoice === 'hh' ? 'hh.ru' : 'LinkedIn'} успешно загружено и распарсено в Resume Studio
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
                      {parsedResume.courses.length} курсов, контакты.
                    </span>
                  </div>
                </div>
              ) : null}

              {hasAccount ? (
                <PlatformConnectionSection
                  platform={sourceChoice}
                  connection={connections?.find((c) => c.platform === sourceChoice)}
                  connecting={connectingPlatform === sourceChoice}
                  onConnect={() => handleConnectPlatform(sourceChoice)}
                />
              ) : null}

              <label>
                <span>
                  {sourceChoice === 'linkedin'
                    ? 'Ссылка на профиль'
                    : 'Ссылка на резюме hh.ru'}
                </span>
                <input
                  value={sourceChoice === 'linkedin' ? linkedinUrl : hhUrl}
                  onChange={(event) => {
                    if (sourceChoice === 'linkedin') setLinkedinUrl(event.target.value);
                    else setHhUrl(event.target.value);
                    setProfileImport(undefined);
                  }}
                  placeholder={
                    sourceChoice === 'linkedin'
                      ? 'https://www.linkedin.com/in/...'
                      : 'https://hh.ru/resume/...'
                  }
                  inputMode="url"
                />
              </label>
              {hasAccount ? (
                <ProfileImportAction
                  result={profileImport}
                  drafts={profileFactDrafts}
                  busy={importingProfile}
                  onImport={handleProfileUrlImport}
                  onDraftChange={setProfileFactDrafts}
                  onError={setError}
                  platform={sourceChoice}
                  connection={connections?.find((c) => c.platform === sourceChoice)}
                  connecting={connectingPlatform === sourceChoice}
                  onConnect={() => handleConnectPlatform(sourceChoice)}
                />
              ) : (
                <AccountRequiredImport
                  platform={sourceChoice}
                  onOpenAccount={onOpenAccount}
                  onChooseSource={chooseSource}
                />
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

/**
 * Importing a profile writes into a candidate-scoped store, so without an
 * account there is nothing to import into. The wizard says that once and hands
 * over the same account panel the top bar opens, plus 1-click fallback options.
 */
function AccountRequiredImport({
  platform,
  onOpenAccount,
  onChooseSource,
}: {
  platform: ConnectionPlatform;
  onOpenAccount?: () => void;
  onChooseSource: (choice: SourceChoice) => void;
}) {
  return (
    <div className="career-source-account-required career-field-wide">
      <p className="career-inline-note">{accountRequiredNotice(platform)}</p>
      {onOpenAccount ? (
        <button
          className="career-primary-button"
          style={{
            height: '42px',
            minWidth: '160px',
            padding: '0 20px',
            borderRadius: '8px',
          }}
          type="button"
          onClick={onOpenAccount}
        >
          Создать аккаунт
        </button>
      ) : null}
      <div className="career-quick-fallbacks">
        <button className="career-quiet-button" type="button" onClick={() => onChooseSource('pdf')}>
          Загрузить PDF
        </button>
        <button className="career-quiet-button" type="button" onClick={() => onChooseSource('text')}>
          Ввести опыт текстом
        </button>
        <button className="career-quiet-button" type="button" onClick={() => onChooseSource('none')}>
          Пропустить файлы
        </button>
      </div>
      <p className="career-account-note">
        Уже есть аккаунт? Вход открывается в том же окне. Без аккаунта остаются
        PDF, экспорт площадки, текст и разговор без документов.
      </p>
    </div>
  );
}

function PlatformConnectionSection({
  platform,
  connection,
  connecting,
  onConnect,
}: {
  platform: ConnectionPlatform;
  connection?: CandidateConnection;
  connecting: boolean;
  onConnect: () => void;
}) {
  const platformLabel = PLATFORM_LABELS[platform];

  if (connection?.status === 'connected') {
    return (
      <div className="career-connection-panel">
        <div className="career-connection-headline">
          <strong>{platformLabel}</strong>
          <span className="is-connected">Подключено</span>
        </div>
        <p>
          {platform === 'hh'
            ? 'Доступ hh.ru подключен. Ваши резюме и опыт синхронизированы.'
            : 'Доступ LinkedIn подключен. Ваш профиль синхронизирован.'}
        </p>
      </div>
    );
  }

  if (connection?.available) {
    return (
      <div className="career-connection-panel">
        <p>
          {platform === 'hh'
            ? 'Подключение hh.ru позволяет импортировать данные вашего резюме напрямую из аккаунта.'
            : 'Подключение LinkedIn позволяет перенести полную карьерную историю и навыки из аккаунта.'}
        </p>
        <button
          className="career-primary-button"
          style={{
            height: '42px',
            minWidth: '160px',
            padding: '0 20px',
            borderRadius: '8px',
          }}
          type="button"
          disabled={connecting}
          onClick={onConnect}
        >
          {connecting ? 'Готовим вход…' : `Войти через браузерную сессию в ${platformLabel}`}
        </button>
        <small>
          Вы подтверждаете доступ на стороне {platformLabel}. Ничего не читается без вашего согласия.
        </small>
      </div>
    );
  }

  return (
    <div className="career-connection-panel">
      <p>
        Для импорта профиля {platformLabel} укажите ссылку на профиль ниже или войдите через браузерную сессию.
      </p>
    </div>
  );
}

function ProfileFactReview({
  drafts,
  onDraftChange,
  onError,
}: {
  drafts: ProfileFactDraft[];
  onDraftChange: (drafts: ProfileFactDraft[]) => void;
  onError: (message: string | undefined) => void;
}) {
  function decide(index: number, decision: 'confirmed' | 'rejected') {
    const draft = drafts[index];
    try {
      const nextFact =
        decision === 'rejected'
          ? reviewProfileFact(draft.fact, { status: 'rejected' })
          : reviewProfileFact(draft.fact, {
              status:
                draft.value.trim() === draft.fact.statement
                  ? 'confirmed'
                  : 'corrected',
              statement: draft.value,
            });
      onDraftChange(
        drafts.map((item, itemIndex) =>
          itemIndex === index
            ? { ...item, fact: nextFact, decision: nextFact.status as ProfileFactDraft['decision'] }
            : item,
        ),
      );
      onError(undefined);
    } catch {
      onError('Исправленный факт не может быть пустым.');
    }
  }

  return (
    <div className="career-profile-fact-review">
      <p>
        <strong>Найдено: {drafts.length}</strong> Решите по каждому факту, можно ли использовать его в карьерной картине.
      </p>
      {drafts.map((draft, index) => (
        <fieldset key={draft.fact.id}>
          <legend>
            {draft.fact.kind === 'headline'
              ? 'Заголовок профиля'
              : draft.fact.kind === 'summary'
                ? 'Описание профиля'
                : 'Факт профиля'}
          </legend>
          <textarea
            aria-label={`Факт ${index + 1}`}
            value={draft.value}
            onChange={(event) =>
              onDraftChange(
                drafts.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, value: event.target.value, decision: 'pending' }
                    : item,
                ),
              )
            }
            rows={3}
          />
          <small>
            Источник: {draft.fact.provenance.locator ?? 'официальный профиль'} ·{' '}
            {draft.fact.provenance.capturedAt.slice(0, 10)}
          </small>
          <div>
            <button
              className="career-quiet-button"
              type="button"
              aria-pressed={draft.decision === 'confirmed' || draft.decision === 'corrected'}
              onClick={() => decide(index, 'confirmed')}
            >
              {draft.decision === 'corrected'
                ? 'Исправлено'
                : draft.decision === 'confirmed'
                  ? 'Подтверждено'
                  : 'Подтвердить'}
            </button>
            <button
              className="career-quiet-button"
              type="button"
              aria-pressed={draft.decision === 'rejected'}
              onClick={() => decide(index, 'rejected')}
            >
              Не использовать
            </button>
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ProfileImportAction({
  result,
  drafts,
  busy,
  onImport,
  onDraftChange,
  onError,
  platform,
  connection,
  connecting,
  onConnect,
}: {
  result?: ProfileUrlImportResult;
  drafts: ProfileFactDraft[];
  busy: boolean;
  onImport: () => void;
  onDraftChange: (drafts: ProfileFactDraft[]) => void;
  onError: (message: string | undefined) => void;
  platform: ConnectionPlatform;
  connection?: CandidateConnection;
  connecting: boolean;
  onConnect: () => void;
}) {
  const platformLabel = PLATFORM_LABELS[platform];

  return (
    <div className="career-profile-import-result" aria-live="polite">
      <button
        className="career-primary-button"
        style={{
          height: '42px',
          minWidth: '160px',
          padding: '0 20px',
          borderRadius: '8px',
        }}
        type="button"
        disabled={busy}
        onClick={onImport}
      >
        {busy ? 'Проверяем доступ…' : IMPORT_ACTION_LABEL}
      </button>
      {result?.status === 'imported' ? (
        <>
          <ProfileFactReview
            drafts={drafts}
            onDraftChange={onDraftChange}
            onError={onError}
          />
          <div className="career-connection-panel">
            <p style={{ margin: 0 }}>
              <strong>Профиль {platformLabel} частично загружен.</strong> Для полного импорта всех данных (включая скрытые контакты и полную историю) рекомендуем войти в аккаунт через браузерную сессию.
            </p>
            {connection?.available ? (
              <button
                className="career-primary-button"
                style={{
                  height: '42px',
                  minWidth: '160px',
                  padding: '0 20px',
                  borderRadius: '8px',
                }}
                type="button"
                disabled={connecting}
                onClick={onConnect}
              >
                {connecting ? 'Готовим вход…' : `Войти через браузерную сессию в ${platformLabel}`}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {result?.status === 'unavailable' ? (
        <div className="career-connection-panel">
          <p style={{ margin: 0 }}>
            <strong>Не удалось получить информацию о профиле.</strong> Вероятно, профиль скрыт настройками приватности или указана неверная ссылка. Для полного импорта всех данных рекомендуем войти в аккаунт через браузерную сессию или загрузить PDF-экспорт профиля.
          </p>
          {connection?.available ? (
            <button
              className="career-primary-button"
              style={{
                height: '42px',
                minWidth: '160px',
                padding: '0 20px',
                borderRadius: '8px',
              }}
              type="button"
              disabled={connecting}
              onClick={onConnect}
            >
              {connecting ? 'Готовим вход…' : `Войти через браузерную сессию в ${platformLabel}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function acceptedProfileFacts(drafts: ProfileFactDraft[]): ProfileFact[] {
  return drafts.flatMap((draft) =>
    draft.decision === 'confirmed' || draft.decision === 'corrected'
      ? [draft.fact]
      : [],
  );
}

function profileSourceId(result: Extract<ProfileUrlImportResult, { status: 'imported' }>): string {
  const timestamp = result.capturedAt.replace(/\D/gu, '').slice(0, 14);
  return `${result.platform}-${result.accessPath}-${timestamp || 'unknown'}`;
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
