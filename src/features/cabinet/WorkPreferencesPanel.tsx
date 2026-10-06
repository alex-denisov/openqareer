import { useCallback, useEffect, useState } from 'react';
import { Check, ShieldCheck } from '@phosphor-icons/react';
import {
  DECISION_WORK_FORMATS,
  type CandidateDecisionLanguage,
  type CandidateDecisionProfile,
  type DecisionWorkFormatId,
  type WorkFamilyCode,
  type WorkPreferenceAnswer,
} from '../../../shared/workPreferences';
import type { WorkPreferencesRead } from '../coach/coachApi';
import { describeWorkPreferences, WORK_PREFERENCES_CAPTION } from './workPreferencesView';
import type { WorkPreferencesState } from './useWorkPreferences';

/**
 * Панель предпочтений и профиля ограничений кандидата (US-03.3 / B384).
 *
 * Содержит конфиденциальный профиль ограничений (гражданство, языки,
 * форматы работы, зарплатный пол, финансовая подушка) и задания парного
 * выбора для определения порядка ролей.
 */
export function WorkPreferencesPanel({ state }: { readonly state: WorkPreferencesState }) {
  const [running, setRunning] = useState(false);

  return (
    <section
      className="career-home-panel career-work-preferences"
      aria-labelledby="career-work-preferences-title"
    >
      <header>
        <h3 id="career-work-preferences-title">Профиль ограничений и предпочтений</h3>
        <span className="career-cabinet-tag">личный фильтр</span>
      </header>
      <DecisionProfileSection state={state} />
      <hr className="career-decision-divider" />
      <header>
        <h4>Какие роли мне подходят</h4>
        <span className="career-cabinet-tag">порядок ролей</span>
      </header>
      <Body state={state} running={running} onRun={setRunning} />
    </section>
  );
}

function DecisionConfidentialBanner() {
  return (
    <div className="career-decision-confidential-banner" role="note">
      <ShieldCheck size={16} />
      <span>
        Конфиденциально: эти данные служат только личным фильтром стратегии и не уходят во внешние выгрузки или к работодателям.
      </span>
    </div>
  );
}

function DecisionSalaryField({
  salaryFloor,
  currency,
  onChangeFloor,
  onChangeCurrency,
}: {
  readonly salaryFloor?: number;
  readonly currency?: string;
  readonly onChangeFloor: (val?: number) => void;
  readonly onChangeCurrency: (val: string) => void;
}) {
  return (
    <div className="career-decision-field">
      <label htmlFor="career-decision-salary-floor">Зарплатный пол</label>
      <div className="career-decision-input-row">
        <input
          id="career-decision-salary-floor"
          type="number"
          className="career-decision-input"
          value={salaryFloor !== undefined ? salaryFloor : ''}
          placeholder="например, 200000"
          onChange={(e) => {
            const num = e.target.value.trim() === '' ? undefined : Number(e.target.value);
            onChangeFloor(Number.isFinite(num) ? num : undefined);
          }}
        />
        <select
          className="career-decision-select"
          aria-label="Валюта"
          value={currency ?? 'RUB'}
          onChange={(e) => onChangeCurrency(e.target.value)}
        >
          <option value="RUB">₽ (RUB)</option>
          <option value="USD">$ (USD)</option>
          <option value="EUR">€ (EUR)</option>
        </select>
      </div>
      <small className="career-decision-hint">
        Вакансии с известной зарплатой ниже этого порога будут исключены из подборки. Пустые поля не ограничивают подборку.
      </small>
    </div>
  );
}

function DecisionCivicField({
  citizenship,
  taxStatus,
  onChangeCitizenship,
  onChangeTaxStatus,
}: {
  readonly citizenship: readonly string[];
  readonly taxStatus?: string;
  readonly onChangeCitizenship: (citizenship: readonly string[]) => void;
  readonly onChangeTaxStatus: (taxStatus: string) => void;
}) {
  return (
    <div className="career-decision-field-group">
      <div className="career-decision-field">
        <label htmlFor="career-decision-citizenship">Гражданство</label>
        <input
          id="career-decision-citizenship"
          type="text"
          className="career-decision-input"
          value={citizenship.join(', ')}
          placeholder="например, РФ, Казахстан"
          onChange={(e) => {
            const list = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChangeCitizenship(list);
          }}
        />
      </div>
      <div className="career-decision-field">
        <label htmlFor="career-decision-tax">Налоговый и миграционный статус</label>
        <input
          id="career-decision-tax"
          type="text"
          className="career-decision-input"
          value={taxStatus ?? ''}
          placeholder="например, резидент РФ, самозанятый"
          onChange={(e) => onChangeTaxStatus(e.target.value)}
        />
      </div>
    </div>
  );
}

function DecisionFormatsField({
  formats,
  onToggle,
}: {
  readonly formats: readonly DecisionWorkFormatId[];
  readonly onToggle: (id: DecisionWorkFormatId) => void;
}) {
  return (
    <fieldset className="career-decision-fieldset">
      <legend>Формат работы</legend>
      <div className="career-decision-formats">
        {DECISION_WORK_FORMATS.map((item) => (
          <label key={item.id} className="career-decision-format-label">
            <input
              type="checkbox"
              checked={formats.includes(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DecisionLanguagesField({
  languages,
  onChange,
}: {
  readonly languages: readonly CandidateDecisionLanguage[];
  readonly onChange: (langs: readonly CandidateDecisionLanguage[]) => void;
}) {
  return (
    <div className="career-decision-field">
      <label htmlFor="career-decision-languages">Подтверждённые языки</label>
      <input
        id="career-decision-languages"
        type="text"
        className="career-decision-input"
        value={languages.map((l) => `${l.language} ${l.level}`).join(', ')}
        placeholder="например, Английский C1, Немецкий B2"
        onChange={(e) => {
          const list = e.target.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s) => {
              const parts = s.split(/\s+/);
              return {
                language: parts[0] ?? s,
                level: parts.slice(1).join(' ') || 'B2',
              };
            });
          onChange(list);
        }}
      />
      <small className="career-decision-hint">Контекст и сертификаты без абстрактных оценок</small>
    </div>
  );
}

function DecisionCushionField({
  cushionMonths,
  hasFamily,
  onChangeCushion,
  onChangeFamily,
}: {
  readonly cushionMonths?: number;
  readonly hasFamily?: boolean;
  readonly onChangeCushion: (months?: number) => void;
  readonly onChangeFamily: (has: boolean) => void;
}) {
  return (
    <div className="career-decision-field-group">
      <div className="career-decision-field">
        <label htmlFor="career-decision-cushion">Финансовая подушка (в месяцах)</label>
        <input
          id="career-decision-cushion"
          type="number"
          className="career-decision-input"
          value={cushionMonths !== undefined ? cushionMonths : ''}
          placeholder="например, 6"
          onChange={(e) => {
            const num = e.target.value.trim() === '' ? undefined : Number(e.target.value);
            onChangeCushion(Number.isFinite(num) ? num : undefined);
          }}
        />
      </div>
      <label className="career-decision-checkbox-label">
        <input
          type="checkbox"
          checked={Boolean(hasFamily)}
          onChange={(e) => onChangeFamily(e.target.checked)}
        />
        <span>Семья и переезд с близкими</span>
      </label>
    </div>
  );
}

function DecisionProfileActions({
  saving,
  saved,
  onSave,
}: {
  readonly saving: boolean;
  readonly saved: boolean;
  readonly onSave: () => void;
}) {
  return (
    <div className="career-decision-actions">
      <button
        type="button"
        className="career-quiet-button"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? 'Сохраняем…' : 'Сохранить ограничения'}
      </button>
      {saved ? (
        <span className="career-decision-saved">
          <Check size={14} weight="bold" />
          Ограничения сохранены
        </span>
      ) : null}
    </div>
  );
}

function DecisionProfileSection({ state }: { readonly state: WorkPreferencesState }) {
  const [draft, setDraft] = useState<CandidateDecisionProfile>(state.decisionProfile);

  useEffect(() => {
    setDraft(state.decisionProfile);
  }, [state.decisionProfile]);

  const handleToggleFormat = useCallback((id: DecisionWorkFormatId) => {
    setDraft((prev) => {
      const exists = prev.workFormats.includes(id);
      const workFormats = exists
        ? prev.workFormats.filter((fmt) => fmt !== id)
        : [...prev.workFormats, id];
      return { ...prev, workFormats };
    });
  }, []);

  return (
    <div className="career-decision-profile">
      <DecisionConfidentialBanner />
      <DecisionSalaryField
        salaryFloor={draft.salaryFloor}
        currency={draft.salaryCurrency}
        onChangeFloor={(floor) => setDraft((prev) => ({ ...prev, salaryFloor: floor }))}
        onChangeCurrency={(currency) => setDraft((prev) => ({ ...prev, salaryCurrency: currency }))}
      />
      <DecisionCivicField
        citizenship={draft.citizenship}
        taxStatus={draft.taxStatus}
        onChangeCitizenship={(citizenship) => setDraft((prev) => ({ ...prev, citizenship }))}
        onChangeTaxStatus={(taxStatus) => setDraft((prev) => ({ ...prev, taxStatus }))}
      />
      <DecisionFormatsField formats={draft.workFormats} onToggle={handleToggleFormat} />
      <DecisionLanguagesField
        languages={draft.languages}
        onChange={(languages) => setDraft((prev) => ({ ...prev, languages }))}
      />
      <DecisionCushionField
        cushionMonths={draft.cushionMonths}
        hasFamily={draft.hasFamily}
        onChangeCushion={(months) => setDraft((prev) => ({ ...prev, cushionMonths: months }))}
        onChangeFamily={(has) => setDraft((prev) => ({ ...prev, hasFamily: has }))}
      />
      <DecisionProfileActions
        saving={state.saving}
        saved={state.decisionProfileSaved}
        onSave={() => void state.saveDecisionProfile(draft)}
      />
    </div>
  );
}

function Body({
  state,
  running,
  onRun,
}: {
  readonly state: WorkPreferencesState;
  readonly running: boolean;
  readonly onRun: (running: boolean) => void;
}) {
  if (state.failed) {
    return <p className="career-home-empty">Задания не удалось прочитать — обновите страницу.</p>;
  }
  if (state.loading || !state.read) {
    return <p className="career-home-empty">Читаем задания…</p>;
  }
  if (running) {
    return (
      <TaskRun
        read={state.read}
        saving={state.saving}
        onCancel={() => onRun(false)}
        onDone={async (answers, excluded) => {
          if (await state.submit({ answers, excluded })) onRun(false);
        }}
      />
    );
  }
  return (
    <>
      {state.read.run ? <RunResult read={state.read} /> : null}
      <p className="career-home-empty">
        {state.read.tasks.length} коротких задач о том, как вы работаете. {WORK_PREFERENCES_CAPTION}
      </p>
      <button type="button" className="career-quiet-button" onClick={() => onRun(true)}>
        {state.read.run ? 'Пройти заново' : 'Пройти задания'}
      </button>
      {state.error ? (
        <p className="career-cabinet-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </>
  );
}

/** Числа со знаменателями и ни одного сводного балла. */
function RunResult({ read }: { readonly read: WorkPreferencesRead }) {
  if (!read.run) return null;
  const view = describeWorkPreferences({
    result: read.run.result,
    completedAt: read.run.completedAt,
    currentKeyVersion: read.keyVersion,
  });
  return (
    <>
      <p className="career-cabinet-tag">{view.basisLine}</p>
      {view.staleLine ? <small>{view.staleLine}</small> : null}
      {view.undecidedLine ? <p className="career-home-empty">{view.undecidedLine}</p> : null}
      {view.top.length ? (
        <ol className="career-roles-list">
          {view.top.map((count) => (
            <li key={count.family}>
              <strong>{count.name}</strong>
              <small>{count.basis}</small>
            </li>
          ))}
        </ol>
      ) : null}
      {view.excludedLine ? <small>{view.excludedLine}</small> : null}
    </>
  );
}

/**
 * Один проход заданий: по одному парному выбору за раз, затем исключающий
 * вопрос. Оба варианта выбрать нельзя — в этом весь метод.
 */
function TaskRun({
  read,
  saving,
  onCancel,
  onDone,
}: {
  readonly read: WorkPreferencesRead;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onDone: (
    answers: readonly WorkPreferenceAnswer[],
    excluded: readonly WorkFamilyCode[],
  ) => void;
}) {
  const [answers, setAnswers] = useState<readonly WorkPreferenceAnswer[]>([]);
  const task = read.tasks[answers.length];

  if (task) {
    return (
      <div className="career-work-task">
        <p className="career-cabinet-tag">
          Задание {answers.length + 1} из {read.tasks.length} · правильных ответов нет
        </p>
        <p className="career-work-task-prompt">{task.prompt}</p>
        {task.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="career-quiet-button"
            onClick={() => setAnswers([...answers, { taskId: task.id, optionId: option.id }])}
          >
            {option.text}
          </button>
        ))}
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Прервать
        </button>
      </div>
    );
  }

  return (
    <ExcludeStep
      read={read}
      saving={saving}
      onDone={(excluded) => onDone(answers, excluded)}
    />
  );
}

/**
 * «Что вы точно не хотите делать каждый день?»
 */
function ExcludeStep({
  read,
  saving,
  onDone,
}: {
  readonly read: WorkPreferencesRead;
  readonly saving: boolean;
  readonly onDone: (excluded: readonly WorkFamilyCode[]) => void;
}) {
  const [excluded, setExcluded] = useState<readonly WorkFamilyCode[]>([]);
  return (
    <div className="career-work-task">
      <p className="career-work-task-prompt">
        Что вы точно не хотите делать каждый день? Можно ничего не выбирать, максимум{' '}
        {read.maxExcluded}.
      </p>
      {read.families.map((family) => (
        <label key={family.code} className="career-work-exclude">
          <input
            type="checkbox"
            checked={excluded.includes(family.code)}
            disabled={!excluded.includes(family.code) && excluded.length >= read.maxExcluded}
            onChange={(event) =>
              setExcluded(
                event.target.checked
                  ? [...excluded, family.code]
                  : excluded.filter((code) => code !== family.code),
              )
            }
          />
          <span>
            {family.name} <small>{family.about}</small>
          </span>
        </label>
      ))}
      <button
        type="button"
        className="career-quiet-button"
        disabled={saving}
        onClick={() => onDone(excluded)}
      >
        Показать порядок ролей
      </button>
    </div>
  );
}
