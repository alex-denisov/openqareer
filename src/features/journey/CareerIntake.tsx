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
import { extractPdfResume } from '../workspace/pdfResume';
import {
  validateWorkspaceInput,
  type ResumeSource,
  type SearchUrgency,
  type WorkspaceInput,
  type WorkspaceMarket,
} from '../workspace/workspaceStorage';

type IntakeStep = 'intent' | 'source' | 'context';
type CareerGoal = 'find-job' | 'choose-role' | 'positioning' | 'market';
type SourceChoice = 'pdf' | 'linkedin' | 'text' | 'none';

interface CareerIntakeProps {
  onComplete: (input: WorkspaceInput) => void;
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
  const [currentSituation, setCurrentSituation] = useState('');
  const [targetDirection, setTargetDirection] = useState('');
  const [market, setMarket] = useState<WorkspaceMarket>('ru');
  const [urgency, setUrgency] = useState<SearchUrgency>('active');
  const [conditions, setConditions] = useState<string[]>([]);
  const [otherConstraint, setOtherConstraint] = useState('');
  const [error, setError] = useState<string>();
  const [readingPdf, setReadingPdf] = useState(false);

  async function handlePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setReadingPdf(true);
    setError(undefined);
    try {
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

  function moveFromIntent() {
    if (!goal) {
      setError('Выберите ближайшую задачу или начните с собственного описания.');
      return;
    }
    setError(undefined);
    setStep('source');
  }

  function moveFromSource() {
    if (resumeText.trim().length > 0 && resumeText.trim().length < 80) {
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
      resumeText,
      resumeSource,
      resumeFileName: resumeFile?.name,
      resumePageCount: resumeFile?.pages,
      targetDirection,
      market,
      currentSituation: situation,
      constraints: [...conditions, otherConstraint.trim()]
        .filter(Boolean)
        .join('. '),
      urgency,
      linkedinUrl: linkedinUrl.trim() || undefined,
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
        <div className="career-intent-list" role="list">
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
              onClick={() => setSourceChoice('pdf')}
            />
            <SourceButton
              icon={LinkedinLogo}
              label="LinkedIn"
              selected={sourceChoice === 'linkedin'}
              onClick={() => {
                setSourceChoice('linkedin');
                setResumeSource('linkedin-pdf');
              }}
            />
            <SourceButton
              icon={Sparkle}
              label="Текстом"
              selected={sourceChoice === 'text'}
              onClick={() => {
                setSourceChoice('text');
                setResumeSource('text');
              }}
            />
            <SourceButton
              icon={ArrowRight}
              label="Без документов"
              selected={sourceChoice === 'none'}
              onClick={() => {
                setSourceChoice('none');
                setResumeText('');
                setResumeSource('text');
              }}
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
                  onChange={(event) => setLinkedinUrl(event.target.value)}
                  placeholder="https://www.linkedin.com/in/..."
                  inputMode="url"
                />
              </label>
              <label>
                <span>Экспорт или текст профиля, если он есть</span>
                <textarea
                  value={resumeText}
                  onChange={(event) => setResumeText(event.target.value)}
                  placeholder="Можно вставить описание опыта. Ссылки достаточно, чтобы сохранить источник, но анализу понадобятся факты."
                  rows={6}
                />
              </label>
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
