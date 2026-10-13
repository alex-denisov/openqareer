import { useState, type FormEvent } from 'react';
import { formatCareerDiaryDate } from './careerDiaryModel';
import { CAREER_DIARY_ADAPTATION_STAGES } from './careerDiaryAdaptationStages';
import {
  type CareerDiaryAdaptationStage,
  type CareerDiaryAdaptationTask,
} from './careerDiaryPlanning';

export interface CareerDiaryTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly stage: CareerDiaryAdaptationStage;
  readonly dueDate: string;
}

interface CareerDiaryAdaptationTaskFormProps {
  readonly stage: CareerDiaryAdaptationStage;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onSave: (task: CareerDiaryTaskDraft) => Promise<boolean>;
}

export function CareerDiaryTaskEntry({
  stage,
  saving,
  error,
  onCancel,
  onSave,
  onSaved,
}: CareerDiaryAdaptationTaskFormProps & { readonly onSaved: () => void }) {
  return (
    <CareerDiaryAdaptationTaskForm
      stage={stage}
      saving={saving}
      error={error}
      onCancel={onCancel}
      onSave={async (task) => {
        const saved = await onSave(task);
        if (saved) onSaved();
        return saved;
      }}
    />
  );
}

export function CareerDiaryAdaptationTaskList({
  tasks,
  readOnly,
  saving,
  onTaskChange,
}: {
  readonly tasks: readonly CareerDiaryAdaptationTask[];
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
}) {
  if (!tasks.length) return <p className="career-diary-note">На этом этапе задач пока нет.</p>;
  return (
    <div className="career-diary-adaptation-tasks">
      {tasks.map((task) => (
        <CareerDiaryAdaptationTaskItem
          key={task.id}
          task={task}
          readOnly={readOnly}
          saving={saving}
          onTaskChange={onTaskChange}
        />
      ))}
    </div>
  );
}

function CareerDiaryAdaptationTaskItem({
  task,
  readOnly,
  saving,
  onTaskChange,
}: {
  readonly task: CareerDiaryAdaptationTask;
  readonly readOnly: boolean;
  readonly saving: boolean;
  readonly onTaskChange: (taskId: string, completed: boolean) => Promise<boolean>;
}) {
  return (
    <label className="career-diary-adaptation-task">
      <input
        type="checkbox"
        checked={task.completed}
        disabled={readOnly || saving}
        onChange={(event) => void onTaskChange(task.id, event.currentTarget.checked)}
      />
      <span className="career-diary-adaptation-task__content">
        <strong>{task.title}</strong>
        <span>
          {categoryLabel(task.category)} ·{' '}
          {task.source === 'template' ? 'из шаблона' : 'добавлено вами'} · до{' '}
          {formatCareerDiaryDate(task.dueDate)}
        </span>
        {task.description ? <span>{task.description}</span> : null}
      </span>
    </label>
  );
}

function CareerDiaryAdaptationTaskForm({
  stage,
  saving,
  error,
  onCancel,
  onSave,
}: CareerDiaryAdaptationTaskFormProps) {
  const [draft, setDraft] = useState<CareerDiaryTaskDraft>({
    title: '',
    description: '',
    stage,
    dueDate: '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!draft.title.trim() || !draft.dueDate) {
      setValidationError('Укажите название задачи и срок.');
      return;
    }
    setValidationError(null);
    await onSave(draft);
  }
  return (
    <form className="career-diary-adaptation-task-form" onSubmit={(event) => void submit(event)}>
      <h3>Добавить задачу</h3>
      <CareerDiaryAdaptationTaskFields draft={draft} onChange={setDraft} />
      <CareerDiaryTaskFormFeedback validationError={validationError} error={error} />
      <CareerDiaryTaskFormActions saving={saving} onCancel={onCancel} />
    </form>
  );
}

function CareerDiaryTaskFormFeedback({
  validationError,
  error,
}: {
  readonly validationError: string | null;
  readonly error: string | null;
}) {
  const message = validationError ?? error;
  return message ? (
    <p className="career-diary-error" role="alert">
      {message}
    </p>
  ) : null;
}

function CareerDiaryTaskFormActions({
  saving,
  onCancel,
}: {
  readonly saving: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <div className="career-diary-achievement__actions">
      <button className="career-btn is-primary" type="submit" disabled={saving} aria-busy={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить задачу'}
      </button>
      <button className="career-btn is-ghost" type="button" disabled={saving} onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

function CareerDiaryAdaptationTaskFields({
  draft,
  onChange,
}: {
  readonly draft: CareerDiaryTaskDraft;
  readonly onChange: (draft: CareerDiaryTaskDraft) => void;
}) {
  return (
    <div className="career-diary-adaptation-task-fields">
      <CareerDiaryTaskDescriptionFields draft={draft} onChange={onChange} />
      <CareerDiaryTaskScheduleFields draft={draft} onChange={onChange} />
    </div>
  );
}

function CareerDiaryTaskDescriptionFields({
  draft,
  onChange,
}: {
  readonly draft: CareerDiaryTaskDraft;
  readonly onChange: (draft: CareerDiaryTaskDraft) => void;
}) {
  return (
    <>
      <label className="career-field" htmlFor="career-diary-adaptation-task-title">
        Название задачи
        <input
          className="career-input"
          id="career-diary-adaptation-task-title"
          value={draft.title}
          maxLength={200}
          onChange={(event) => onChange({ ...draft, title: event.currentTarget.value })}
        />
      </label>
      <label className="career-field" htmlFor="career-diary-adaptation-task-description">
        Описание
        <textarea
          className="career-input"
          id="career-diary-adaptation-task-description"
          value={draft.description}
          maxLength={1000}
          onChange={(event) => onChange({ ...draft, description: event.currentTarget.value })}
        />
      </label>
    </>
  );
}

function CareerDiaryTaskScheduleFields({
  draft,
  onChange,
}: {
  readonly draft: CareerDiaryTaskDraft;
  readonly onChange: (draft: CareerDiaryTaskDraft) => void;
}) {
  return (
    <>
      <label className="career-field" htmlFor="career-diary-adaptation-task-stage">
        Этап
        <select
          className="career-select"
          id="career-diary-adaptation-task-stage"
          value={draft.stage}
          onChange={(event) =>
            onChange({ ...draft, stage: event.currentTarget.value as CareerDiaryAdaptationStage })
          }
        >
          {CAREER_DIARY_ADAPTATION_STAGES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="career-field" htmlFor="career-diary-adaptation-task-due">
        Срок
        <input
          className="career-input"
          id="career-diary-adaptation-task-due"
          type="date"
          value={draft.dueDate}
          onChange={(event) => onChange({ ...draft, dueDate: event.currentTarget.value })}
        />
      </label>
    </>
  );
}

function categoryLabel(category: CareerDiaryAdaptationTask['category']): string {
  const labels: Record<CareerDiaryAdaptationTask['category'], string> = {
    people: 'Люди',
    strategy: 'Стратегия',
    delivery: 'Поставка',
    alignment: 'Согласование',
  };
  return labels[category];
}
