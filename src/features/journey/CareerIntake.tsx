import { useState, type ChangeEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  FilePdf,
  GlobeHemisphereWest,
  LinkedinLogo,
  Question,
  Sparkle,
  Target,
} from '@phosphor-icons/react';
import { importProfileUrl, type ProfileUrlImportResult } from '../coach/coachApi';
import {
  ingestProfileSnapshot,
  reviewProfileFact,
  type ProfileFact,
} from '../workspace/profileIngestion';
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
}

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

export function CareerIntake({ onComplete }: CareerIntakeProps) {
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
              onClick={() => setStarted(true)}
            >
              Начать диагностику
              <ArrowRight size={18} weight="bold" />
            </button>
          </div>
        </div>

        <div className="career-start-status" aria-label="Состояние карьерной картины">
          <div><span>Профиль</span><strong>Не заполнен</strong></div>
          <div><span>Карьера</span><strong>Нет гипотез</strong></div>
          <div><span>Возможности</span><strong>Не добавлены</strong></div>
        </div>

        <div className="career-start-note">
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
      const { extractPdfResume } = await import('../workspace/pdfResume');
      const result = await extractPdfResume(file);
      setResumeText(result.text);
      setResumeSource('pdf');
      setResumeFile({ name: result.fileName, pages: result.pageCount });
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
      const selectedUrl = sourceChoice === 'linkedin' ? linkedinUrl.trim() : hhUrl.trim();
      if (!selectedUrl) {
        setError('Вставьте ссылку или выберите другой способ начать.');
        return;
      }
      if (!profileImport) {
        setError('Сначала нажмите «Импортировать по ссылке».');
        return;
      }
      if (profileImport.status === 'unavailable') {
        setError('Для этой площадки нужен официальный доступ. Выберите PDF/экспорт или начните без документов.');
        return;
      }
      if (profileFactDrafts.some((draft) => draft.decision === 'pending')) {
        setError('Проверьте каждый найденный факт: подтвердите, исправьте или исключите.');
        return;
      }
      const reviewedFacts = acceptedProfileFacts(profileFactDrafts);
      if (!reviewedFacts.length) {
        setError('Подтвердите хотя бы один факт или выберите другой способ начать.');
        return;
      }
      setResumeText(reviewedFacts.map((fact) => fact.statement).join('\n'));
      setResumeSource('text');
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
        sourceChoice === 'linkedin' || sourceChoice === 'hh'
          ? acceptedProfileFacts(profileFactDrafts)
          : undefined,
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
              icon={FilePdf}
              label="PDF или экспорт hh.ru"
              selected={sourceChoice === 'pdf'}
              onClick={() => chooseSource('pdf')}
            />
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
            <label className="career-upload-control">
              <input type="file" accept="application/pdf,.pdf" onChange={handlePdf} />
              <FilePdf size={26} />
              <span>
                <strong>
                  {readingPdf
                    ? 'Читаем файл…'
                    : resumeFile
                      ? resumeFile.name
                      : 'Выбрать PDF'}
                </strong>
                <small>
                  {resumeFile
                    ? `${resumeFile.pages} стр. · текст извлечён локально`
                    : 'До 20 МБ · оригинал не отправляется'}
                </small>
              </span>
            </label>
          ) : null}

          {sourceChoice === 'linkedin' ? (
            <div className="career-source-fields">
              <label>
                <span>Ссылка на профиль</span>
                <input
                  value={linkedinUrl}
                  onChange={(event) => {
                    setLinkedinUrl(event.target.value);
                    setProfileImport(undefined);
                    setProfileFactDrafts([]);
                  }}
                  placeholder="https://www.linkedin.com/in/..."
                  inputMode="url"
                />
              </label>
              <ProfileImportAction
                result={profileImport}
                drafts={profileFactDrafts}
                busy={importingProfile}
                onImport={handleProfileUrlImport}
                onDraftChange={setProfileFactDrafts}
                onError={setError}
                platform="LinkedIn"
              />
            </div>
          ) : null}

          {sourceChoice === 'hh' ? (
            <div className="career-source-fields">
              <label>
                <span>Ссылка на резюме hh.ru</span>
                <input
                  value={hhUrl}
                  onChange={(event) => {
                    setHhUrl(event.target.value);
                    setProfileImport(undefined);
                    setProfileFactDrafts([]);
                  }}
                  placeholder="https://hh.ru/resume/..."
                  inputMode="url"
                />
              </label>
              <ProfileImportAction
                result={profileImport}
                drafts={profileFactDrafts}
                busy={importingProfile}
                onImport={handleProfileUrlImport}
                onDraftChange={setProfileFactDrafts}
                onError={setError}
                platform="hh.ru"
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
        <p className="career-intake-error" role="alert">
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

function ProfileImportAction({
  result,
  drafts,
  busy,
  onImport,
  onDraftChange,
  onError,
  platform,
}: {
  result?: ProfileUrlImportResult;
  drafts: ProfileFactDraft[];
  busy: boolean;
  onImport: () => void;
  onDraftChange: (drafts: ProfileFactDraft[]) => void;
  onError: (message: string | undefined) => void;
  platform: string;
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
    <div className="career-profile-import-result" aria-live="polite">
      <button className="career-quiet-button" type="button" disabled={busy} onClick={onImport}>
        {busy ? 'Проверяем доступ…' : 'Проверить способ импорта'}
      </button>
      {result?.status === 'imported' ? (
        <div className="career-profile-fact-review">
          <p><strong>Найдено: {drafts.length}</strong> Решите по каждому факту, можно ли использовать его в карьерной картине.</p>
          {drafts.map((draft, index) => (
            <fieldset key={draft.fact.id}>
              <legend>{draft.fact.kind === 'headline' ? 'Заголовок профиля' : 'Описание профиля'}</legend>
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
              <small>Источник: {draft.fact.provenance.locator ?? 'официальный профиль'} · {draft.fact.provenance.capturedAt.slice(0, 10)}</small>
              <div>
                <button
                  className="career-quiet-button"
                  type="button"
                  aria-pressed={draft.decision === 'confirmed' || draft.decision === 'corrected'}
                  onClick={() => decide(index, 'confirmed')}
                >
                  {draft.decision === 'corrected' ? 'Исправлено' : draft.decision === 'confirmed' ? 'Подтверждено' : 'Подтвердить'}
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
      ) : null}
      {result?.status === 'unavailable' ? (
        <p><strong>Автоматический импорт {platform} пока не подключён.</strong> Мы не обходим ограничения площадки. Загрузите свой PDF/экспорт или продолжите без документа.</p>
      ) : null}
      <p className="career-account-note">
        {platform === 'LinkedIn'
          ? 'Для закрытых данных нужен официальный LinkedIn OAuth и одобрение расширенного Profile API; обычный вход отдаёт только ограниченные поля.'
          : 'Полное резюме и разрешённые действия подключаются через официальный OAuth hh.ru. До настройки приложения используйте свой экспорт или PDF.'}
      </p>
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
