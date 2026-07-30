import { useState, type ChangeEvent, type FormEvent } from 'react';
import { extractPdfResume } from './pdfResume';
import {
  validateWorkspaceInput,
  type ResumeSource,
  type WorkspaceInput,
  type WorkspaceInputErrors,
} from './workspaceStorage';

interface WorkspaceSetupProps {
  initialInput?: WorkspaceInput;
  invalidStorage?: boolean;
  storageError?: string;
  onCancel?: () => void;
  onResetInvalid?: () => void;
  onSubmit: (input: WorkspaceInput) => void;
}

type PdfStatus =
  | { type: 'idle' }
  | { type: 'reading'; fileName: string }
  | { type: 'ready'; fileName: string; pageCount: number }
  | { type: 'error'; message: string };

const EMPTY_INPUT: WorkspaceInput = {
  resumeText: '',
  resumeSource: 'pdf',
  targetDirection: '',
  market: 'ru',
  currentSituation: '',
  constraints: '',
  urgency: 'active',
};

const SOURCE_OPTIONS: Array<{
  value: ResumeSource;
  title: string;
  description: string;
}> = [
  {
    value: 'pdf',
    title: 'Обычное PDF-резюме',
    description: 'Файл с вашего компьютера',
  },
  {
    value: 'hh-pdf',
    title: 'Экспорт из hh.ru',
    description: 'Скачанное резюме в PDF',
  },
  {
    value: 'linkedin-pdf',
    title: 'Экспорт из LinkedIn',
    description: 'Профиль, сохранённый в PDF',
  },
];

export function WorkspaceSetup({
  initialInput = EMPTY_INPUT,
  invalidStorage = false,
  storageError,
  onCancel,
  onResetInvalid,
  onSubmit,
}: WorkspaceSetupProps) {
  const [step, setStep] = useState(initialInput.resumeText ? 2 : 1);
  const [input, setInput] = useState<WorkspaceInput>(initialInput);
  const [errors, setErrors] = useState<WorkspaceInputErrors>({});
  const [pdfStatus, setPdfStatus] = useState<PdfStatus>(() =>
    initialInput.resumeFileName
      ? {
          type: 'ready',
          fileName: initialInput.resumeFileName,
          pageCount: initialInput.resumePageCount ?? 1,
        }
      : { type: 'idle' },
  );

  async function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setInput((current) => ({
      ...current,
      resumeText: '',
      resumeFileName: undefined,
      resumePageCount: undefined,
    }));
    setPdfStatus({ type: 'reading', fileName: file.name });
    setErrors((current) => ({ ...current, resumeText: undefined }));

    try {
      const extracted = await extractPdfResume(file);
      setInput((current) => ({
        ...current,
        resumeText: extracted.text,
        resumeFileName: extracted.fileName,
        resumePageCount: extracted.pageCount,
      }));
      setPdfStatus({
        type: 'ready',
        fileName: extracted.fileName,
        pageCount: extracted.pageCount,
      });
    } catch (error) {
      setPdfStatus({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Не удалось прочитать PDF. Выберите другой файл.',
      });
    }
  }

  function handleNext() {
    const nextErrors = validateWorkspaceInput(input);
    if (nextErrors.resumeText) {
      setErrors({ resumeText: nextErrors.resumeText });
      requestAnimationFrame(() => {
        document.getElementById('resume-pdf')?.focus();
      });
      return;
    }

    setErrors({});
    setStep(2);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateWorkspaceInput(input);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalidField = [
        ['currentSituation', 'current-situation'],
        ['targetDirection', 'target-direction'],
        ['linkedinUrl', 'linkedin-url'],
        ['hhUrl', 'hh-url'],
      ].find(([errorKey]) =>
        Boolean(nextErrors[errorKey as keyof WorkspaceInputErrors]),
      );

      requestAnimationFrame(() => {
        if (firstInvalidField) {
          document.getElementById(firstInvalidField[1])?.focus();
        }
      });
      return;
    }

    onSubmit(input);
  }

  return (
    <main className="setup-layout" data-testid="workspace-setup">
      <SetupIntro step={step} />

      <section className="setup-form-region" aria-label="Рабочий контекст">
        <SetupMessages
          invalidStorage={invalidStorage}
          storageError={storageError}
          onResetInvalid={onResetInvalid}
        />

        {step === 1 ? (
          <ResumeImportStep
            input={input}
            errors={errors}
            pdfStatus={pdfStatus}
            onInputChange={setInput}
            onPdfChange={handlePdfChange}
            onNext={handleNext}
          />
        ) : (
          <CareerInterviewStep
            input={input}
            errors={errors}
            onBack={() => setStep(1)}
            onCancel={onCancel}
            onInputChange={setInput}
            onSubmit={handleSubmit}
          />
        )}
      </section>
    </main>
  );
}

function SetupIntro({ step }: { step: number }) {
  return (
    <section className="setup-intro" aria-labelledby="setup-title">
      <div className="setup-progress" aria-label={`Шаг ${step} из 2`}>
        <span>{String(step).padStart(2, '0')}</span>
        <div>
          <i className={step >= 1 ? 'is-complete' : ''} />
          <i className={step >= 2 ? 'is-complete' : ''} />
        </div>
        <span>02</span>
      </div>
      <p className="eyebrow">
        {step === 1 ? 'Ваши исходные материалы' : 'Короткое интервью'}
      </p>
      <h1 id="setup-title">
        {step === 1
          ? 'Начнём с того, что уже есть.'
          : 'Теперь разберём ваш маршрут.'}
      </h1>
      <p className="setup-lede">
        {step === 1
          ? 'Загрузите готовое резюме. Форматировать или копировать текст вручную не нужно.'
          : 'Ответы нужны не для анкеты, а чтобы не путать текущую роль, желаемый переход и ограничения.'}
      </p>

      <div className="principles-list" aria-label="Принципы импорта">
        <div>
          <span>01</span>
          <p>PDF читается локально и не загружается на сервер.</p>
        </div>
        <div>
          <span>02</span>
          <p>hh.ru и LinkedIn подключаются через экспорт или ссылку.</p>
        </div>
        <div>
          <span>03</span>
          <p>Никаких паролей, cookies и действий в аккаунтах.</p>
        </div>
      </div>
    </section>
  );
}

function SetupMessages({
  invalidStorage,
  storageError,
  onResetInvalid,
}: Pick<
  WorkspaceSetupProps,
  'invalidStorage' | 'storageError' | 'onResetInvalid'
>) {
  return (
    <>
      {invalidStorage ? (
        <div className="status-message status-message--warning" role="alert">
          <div>
            <strong>Сохранённые данные не удалось прочитать.</strong>
            <p>Очистите повреждённую локальную запись и начните заново.</p>
          </div>
          <button className="button button--quiet" onClick={onResetInvalid}>
            Очистить запись
          </button>
        </div>
      ) : null}
      {storageError ? (
        <div className="status-message status-message--error" role="alert">
          <strong>Не удалось сохранить данные в браузере.</strong>
          <p>{storageError}</p>
        </div>
      ) : null}
    </>
  );
}

interface ResumeImportStepProps {
  input: WorkspaceInput;
  errors: WorkspaceInputErrors;
  pdfStatus: PdfStatus;
  onInputChange: (input: WorkspaceInput) => void;
  onPdfChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onNext: () => void;
}

function ResumeImportStep({
  input,
  errors,
  pdfStatus,
  onInputChange,
  onPdfChange,
  onNext,
}: ResumeImportStepProps) {
  return (
    <div className="setup-form-card" data-testid="resume-import-step">
      <fieldset className="source-choice">
        <legend>Откуда это резюме</legend>
        <div className="source-choice-grid">
          {SOURCE_OPTIONS.map((option) => (
            <label
              className={
                input.resumeSource === option.value
                  ? 'source-option is-selected'
                  : 'source-option'
              }
              key={option.value}
            >
              <input
                type="radio"
                name="resume-source"
                value={option.value}
                checked={input.resumeSource === option.value}
                onChange={() =>
                  onInputChange({ ...input, resumeSource: option.value })
                }
              />
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="pdf-upload">
        <input
          id="resume-pdf"
          type="file"
          accept="application/pdf,.pdf"
          onChange={onPdfChange}
          aria-invalid={Boolean(errors.resumeText)}
          aria-describedby={errors.resumeText ? 'resume-error' : undefined}
          data-testid="resume-pdf-input"
        />
        <label htmlFor="resume-pdf">
          <span className="upload-mark" aria-hidden="true">
            ↑
          </span>
          <strong>
            {pdfStatus.type === 'ready'
              ? 'Заменить PDF'
              : 'Выбрать PDF-резюме'}
          </strong>
          <span>До 20 МБ · максимум 40 страниц</span>
        </label>
      </div>

      <PdfStatusLine status={pdfStatus} />

      {errors.resumeText ? (
        <p className="field-error" id="resume-error" role="alert">
          {errors.resumeText}
        </p>
      ) : null}

      <details className="text-fallback">
        <summary>Нет PDF или файл является сканом</summary>
        <div className="field">
          <label htmlFor="resume-text">Запасной ввод текста</label>
          <textarea
            id="resume-text"
            value={input.resumeText}
            onChange={(event) =>
              onInputChange({
                ...input,
                resumeText: event.target.value,
                resumeSource: 'text',
                resumeFileName: undefined,
                resumePageCount: undefined,
              })
            }
            placeholder="Используйте только если PDF невозможно прочитать."
            rows={7}
          />
        </div>
      </details>

      <div className="form-footer">
        <p>
          Сохраняется извлечённый текст и имя файла. Оригинал PDF остаётся у вас.
        </p>
        <button
          className="button button--primary"
          type="button"
          onClick={onNext}
          disabled={pdfStatus.type === 'reading'}
        >
          Перейти к вопросам
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function PdfStatusLine({ status }: { status: PdfStatus }) {
  if (status.type === 'idle') {
    return null;
  }

  if (status.type === 'reading') {
    return (
      <div className="file-status" aria-live="polite">
        <span className="file-status-dot is-reading" />
        <p>Читаю «{status.fileName}» локально…</p>
      </div>
    );
  }

  if (status.type === 'error') {
    return (
      <div className="file-status file-status--error" role="alert">
        <span className="file-status-dot" />
        <p>{status.message}</p>
      </div>
    );
  }

  return (
    <div className="file-status file-status--ready" aria-live="polite">
      <span className="file-status-dot" />
      <p>
        <strong>{status.fileName}</strong>
        <span>{status.pageCount} стр. · текст извлечён</span>
      </p>
    </div>
  );
}

interface CareerInterviewStepProps {
  input: WorkspaceInput;
  errors: WorkspaceInputErrors;
  onBack: () => void;
  onCancel?: () => void;
  onInputChange: (input: WorkspaceInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function CareerInterviewStep({
  input,
  errors,
  onBack,
  onCancel,
  onInputChange,
  onSubmit,
}: CareerInterviewStepProps) {
  return (
    <form
      className="setup-form-card"
      onSubmit={onSubmit}
      noValidate
      data-testid="career-interview-step"
    >
      <div className="field">
        <label htmlFor="current-situation">
          Где вы находитесь в карьере сейчас?
        </label>
        <textarea
          id="current-situation"
          value={input.currentSituation}
          onChange={(event) =>
            onInputChange({ ...input, currentSituation: event.target.value })
          }
          aria-invalid={Boolean(errors.currentSituation)}
          aria-describedby={
            errors.currentSituation ? 'situation-error' : 'situation-help'
          }
          placeholder="Текущая роль, что изменилось, почему снова рассматриваете рынок."
          rows={4}
        />
        {errors.currentSituation ? (
          <p className="field-error" id="situation-error">
            {errors.currentSituation}
          </p>
        ) : (
          <p className="field-help" id="situation-help">
            Достаточно 2–4 предложений. Этот ответ можно изменить позже.
          </p>
        )}
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="target-direction">
            Какую роль или переход вы рассматриваете?
          </label>
          <input
            id="target-direction"
            value={input.targetDirection}
            onChange={(event) =>
              onInputChange({ ...input, targetDirection: event.target.value })
            }
            aria-invalid={Boolean(errors.targetDirection)}
            aria-describedby={
              errors.targetDirection ? 'target-direction-error' : undefined
            }
            placeholder="Можно указать несколько гипотез"
          />
          {errors.targetDirection ? (
            <p className="field-error" id="target-direction-error">
              {errors.targetDirection}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="market">Где хотите искать?</label>
          <select
            id="market"
            value={input.market}
            onChange={(event) =>
              onInputChange({
                ...input,
                market: event.target.value as WorkspaceInput['market'],
              })
            }
          >
            <option value="ru">Россия</option>
            <option value="international">
              Международный рынок / релокация
            </option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="urgency">Режим поиска</label>
          <select
            id="urgency"
            value={input.urgency}
            onChange={(event) =>
              onInputChange({
                ...input,
                urgency: event.target.value as WorkspaceInput['urgency'],
              })
            }
          >
            <option value="exploring">Изучаю варианты</option>
            <option value="active">Ищу активно</option>
            <option value="urgent">Нужен быстрый переход</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="constraints">Что для вас неприемлемо?</label>
          <input
            id="constraints"
            value={input.constraints}
            onChange={(event) =>
              onInputChange({ ...input, constraints: event.target.value })
            }
            placeholder="Формат, отрасль, задачи, доход"
          />
        </div>
      </div>

      <div className="profile-links">
        <div>
          <p className="eyebrow">Существующие профили</p>
          <p>
            Ссылки сохраняются как источники. Сервис не входит в аккаунты и не
            считывает закрытые данные.
          </p>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="linkedin-url">LinkedIn</label>
            <input
              id="linkedin-url"
              type="url"
              value={input.linkedinUrl ?? ''}
              onChange={(event) =>
                onInputChange({ ...input, linkedinUrl: event.target.value })
              }
              aria-invalid={Boolean(errors.linkedinUrl)}
              aria-describedby={
                errors.linkedinUrl ? 'linkedin-url-error' : undefined
              }
              placeholder="https://linkedin.com/in/…"
            />
            {errors.linkedinUrl ? (
              <p className="field-error" id="linkedin-url-error">
                {errors.linkedinUrl}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="hh-url">Резюме hh.ru</label>
            <input
              id="hh-url"
              type="url"
              value={input.hhUrl ?? ''}
              onChange={(event) =>
                onInputChange({ ...input, hhUrl: event.target.value })
              }
              aria-invalid={Boolean(errors.hhUrl)}
              aria-describedby={errors.hhUrl ? 'hh-url-error' : undefined}
              placeholder="https://hh.ru/resume/…"
            />
            {errors.hhUrl ? (
              <p className="field-error" id="hh-url-error">
                {errors.hhUrl}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="form-footer">
        <button className="button button--quiet" type="button" onClick={onBack}>
          ← К материалам
        </button>
        <div className="form-actions">
          {onCancel ? (
            <button
              className="button button--quiet"
              type="button"
              onClick={onCancel}
            >
              Отмена
            </button>
          ) : null}
          <button className="button button--primary" type="submit">
            Создать workspace
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </form>
  );
}
