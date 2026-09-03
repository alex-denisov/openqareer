import { useState } from 'react';
import type {
  WorkFamilyCode,
  WorkPreferenceAnswer,
} from '../../../shared/workPreferences';
import type { WorkPreferencesRead } from '../coach/coachApi';
import { describeWorkPreferences, WORK_PREFERENCES_CAPTION } from './workPreferencesView';
import type { WorkPreferencesState } from './useWorkPreferences';

/**
 * «Какие роли мне подходят» — задания парного выбора (B180, срез 3).
 *
 * Вопрос стоит от лица кандидата и о ролях, а не о нём: дательный падеж
 * («роли подходят мне») говорит о предпочтении, а запрещённый именительный
 * («я подхожу») — о пригодности в глазах работодателя. Экран результата от
 * этого вопроса **не переименовывается**: он остаётся «Роли и рынок», а
 * задания лишь уточняют порядок уже найденных ролей.
 */
export function WorkPreferencesPanel({ state }: { readonly state: WorkPreferencesState }) {
  const [running, setRunning] = useState(false);

  return (
    <section
      className="career-home-panel career-work-preferences"
      aria-labelledby="career-work-preferences-title"
    >
      <header>
        <h3 id="career-work-preferences-title">Какие роли мне подходят</h3>
        <span className="career-cabinet-tag">порядок ролей</span>
      </header>
      <Body state={state} running={running} onRun={setRunning} />
    </section>
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
 *
 * Отрицательные предпочтения устойчивее и честнее положительных — люди гораздо
 * точнее знают, чего не хотят. Это единственное место, где кандидат прямо
 * распоряжается результатом, поэтому исключений не больше двух.
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
