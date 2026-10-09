import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CandidateMemory } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { addManualExperienceFact } from './experienceFactApi';
import { monthInputValue } from './experienceDate';
import type { ResumeExperienceInput, WorkplaceType } from './resumeTypes';

type ValueSetter<T> = Dispatch<SetStateAction<T>>;

interface PositionFormBasics {
  readonly title: string;
  readonly setTitle: ValueSetter<string>;
  readonly employer: string;
  readonly setEmployer: ValueSetter<string>;
  readonly startDate: string;
  readonly setStartDate: ValueSetter<string>;
  readonly endDate: string;
  readonly setEndDate: ValueSetter<string>;
  readonly location: string;
  readonly setLocation: ValueSetter<string>;
  readonly employmentType: string;
  readonly setEmploymentType: ValueSetter<string>;
  readonly workplaceType: WorkplaceType;
  readonly setWorkplaceType: ValueSetter<WorkplaceType>;
  readonly current: boolean;
  readonly setCurrent: ValueSetter<boolean>;
}

interface PositionFormFacts {
  readonly selectedFactIds: readonly string[];
  readonly setSelectedFactIds: ValueSetter<readonly string[]>;
  readonly description: string;
  readonly setDescription: ValueSetter<string>;
  readonly newAchievements: string;
  readonly setNewAchievements: ValueSetter<string>;
  readonly currentFacts: readonly CandidateMemory[];
  readonly manualStatements: readonly string[];
}

interface PositionFormState extends PositionFormBasics, PositionFormFacts {
  readonly patch: Partial<ResumeExperienceInput>;
}

function usePositionFormBasics(entry: ResumeExperienceInput): PositionFormBasics {
  const [title, setTitle] = useState(entry.title ?? '');
  const [employer, setEmployer] = useState(entry.employer ?? '');
  const [startDate, setStartDate] = useState(monthInputValue(entry.startDate));
  const [endDate, setEndDate] = useState(monthInputValue(entry.endDate));
  const [location, setLocation] = useState(entry.location ?? '');
  const [employmentType, setEmploymentType] = useState(entry.employmentType ?? '');
  const [workplaceType, setWorkplaceType] = useState<WorkplaceType>(
    entry.workplaceType ?? 'on_site',
  );
  const [current, setCurrent] = useState(entry.current);
  return {
    title,
    setTitle,
    employer,
    setEmployer,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    location,
    setLocation,
    employmentType,
    setEmploymentType,
    workplaceType,
    setWorkplaceType,
    current,
    setCurrent,
  };
}

function usePositionFormFacts(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): PositionFormFacts {
  const [selectedFactIds, setSelectedFactIds] = useState<readonly string[]>(entry.bulletMemoryIds);
  const [description, setDescription] = useState('');
  const [newAchievements, setNewAchievements] = useState('');
  const currentFacts = entry.bulletMemoryIds.flatMap((id) => {
    const fact = memory.find((item) => item.id === id);
    return fact ? [fact] : [];
  });
  return {
    selectedFactIds,
    setSelectedFactIds,
    description,
    setDescription,
    newAchievements,
    setNewAchievements,
    currentFacts,
    manualStatements: [
      description.trim(),
      ...newAchievements.split(/\r?\n/u).map((line) => line.trim()),
    ].filter(Boolean),
  };
}

function usePositionFormState(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): PositionFormState {
  const basics = usePositionFormBasics(entry);
  const facts = usePositionFormFacts(entry, memory);
  return {
    ...basics,
    ...facts,
    patch: {
      title: basics.title,
      employer: basics.employer,
      startDate: basics.startDate || undefined,
      endDate: basics.current ? undefined : basics.endDate || undefined,
      current: basics.current,
      location: basics.location,
      employmentType: basics.employmentType || undefined,
      workplaceType: basics.workplaceType,
      bulletMemoryIds: facts.selectedFactIds,
    },
  };
}

interface PositionEditorProps {
  readonly entry: ResumeExperienceInput;
  readonly memory: readonly CandidateMemory[];
  readonly candidateId?: string;
  readonly isNew?: boolean;
  readonly saving?: boolean;
  readonly onCancel: () => void;
  readonly onSave: (
    patch: Partial<ResumeExperienceInput>,
  ) => Promise<boolean | void> | boolean | void;
  readonly onDone: () => void;
  readonly onManualExperienceFactAdded?: () => Promise<void> | void;
}

function keyForStatement(statement: string, keys: Map<string, string>): string {
  const existing = keys.get(statement);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.();
  if (!created) throw new Error('Невозможно безопасно сохранить факт в этом браузере.');
  keys.set(statement, created);
  return created;
}

async function createManualFacts(
  candidateId: string,
  experienceId: string,
  statements: readonly string[],
  keys: Map<string, string>,
): Promise<string[]> {
  if (!candidateId) throw new Error('Профиль недоступен. Текст остался в форме.');
  const created = await Promise.all(
    statements.map((statement) =>
      addManualExperienceFact({
        statement,
        experienceId,
        idempotencyKey: keyForStatement(statement, keys),
      }),
    ),
  );
  return created.map((fact) => fact.id);
}

function usePositionSubmit(props: PositionEditorProps, form: PositionFormState) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const factKeys = useRef(new Map<string, string>());
  const save = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      if ((await props.onSave(form.patch)) === false) return;
      if (form.manualStatements.length) {
        const ids = await createManualFacts(
          props.candidateId ?? '',
          props.entry.id,
          form.manualStatements,
          factKeys.current,
        );
        if (
          (await props.onSave({
            ...form.patch,
            bulletMemoryIds: [...form.selectedFactIds, ...ids],
          })) === false
        ) {
          return;
        }
        await props.onManualExperienceFactAdded?.();
      }
      props.onDone();
    } catch (reason) {
      setError(
        apiErrorMessage(
          reason,
          'Нет связи с сервером. Текст остался в форме; повторите сохранение.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };
  return { error, submitting, save };
}

function PositionIdentityFields({ form }: { readonly form: PositionFormState }) {
  return (
    <div className="career-profile-screen-field-grid">
      <label className="career-profile-screen-field">
        <span>Должность</span>
        <input value={form.title} onChange={(event) => form.setTitle(event.target.value)} />
      </label>
      <label className="career-profile-screen-field">
        <span>Компания</span>
        <input value={form.employer} onChange={(event) => form.setEmployer(event.target.value)} />
      </label>
      <label className="career-profile-screen-field">
        <span>Локация</span>
        <input value={form.location} onChange={(event) => form.setLocation(event.target.value)} />
      </label>
      <label className="career-profile-screen-field">
        <span>Тип занятости</span>
        <input
          value={form.employmentType}
          onChange={(event) => form.setEmploymentType(event.target.value)}
        />
      </label>
    </div>
  );
}

function PositionDateAndFormatFields({ form }: { readonly form: PositionFormState }) {
  return (
    <div className="career-profile-screen-field-grid">
      <label className="career-profile-screen-field">
        <span>Начало</span>
        <input
          type="month"
          value={form.startDate}
          onChange={(event) => form.setStartDate(event.target.value)}
        />
      </label>
      <label className="career-profile-screen-field">
        <span>Окончание</span>
        <input
          type="month"
          value={form.endDate}
          disabled={form.current}
          onChange={(event) => form.setEndDate(event.target.value)}
        />
      </label>
      <label className="career-profile-screen-field">
        <span>Формат работы</span>
        <select
          value={form.workplaceType}
          onChange={(event) => form.setWorkplaceType(event.target.value as WorkplaceType)}
        >
          <option value="on_site">Офис</option>
          <option value="hybrid">Гибрид</option>
          <option value="remote">Удалённо</option>
        </select>
      </label>
    </div>
  );
}

function CurrentRoleCheckbox({ form }: { readonly form: PositionFormState }) {
  return (
    <label className="career-profile-screen-fact-choice">
      <input
        type="checkbox"
        checked={form.current}
        onChange={(event) => form.setCurrent(event.target.checked)}
      />
      Работаю здесь
    </label>
  );
}

function PositionScheduleFields({
  entry,
  isNew,
  form,
}: {
  readonly entry: ResumeExperienceInput;
  readonly isNew?: boolean;
  readonly form: PositionFormState;
}) {
  return (
    <>
      <PositionDateAndFormatFields form={form} />
      {isNew || entry.current ? <CurrentRoleCheckbox form={form} /> : null}
    </>
  );
}

function ExperienceFactChoice({
  fact,
  checked,
  onChange,
}: {
  readonly fact: CandidateMemory;
  readonly checked: boolean;
  readonly onChange: () => void;
}) {
  return (
    <label className="career-profile-screen-fact-choice">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {fact.statement}
    </label>
  );
}

function PositionAchievementFields({ form }: { readonly form: PositionFormState }) {
  return (
    <fieldset>
      <legend>Достижения</legend>
      {form.currentFacts.length ? (
        form.currentFacts.map((fact) => (
          <ExperienceFactChoice
            key={fact.id}
            fact={fact}
            checked={form.selectedFactIds.includes(fact.id)}
            onChange={() =>
              form.setSelectedFactIds((ids) =>
                ids.includes(fact.id) ? ids.filter((id) => id !== fact.id) : [...ids, fact.id],
              )
            }
          />
        ))
      ) : (
        <p className="career-profile-screen-empty-note">Подтверждённых достижений пока нет.</p>
      )}
      <label className="career-profile-screen-field">
        <span>Добавить достижения списком</span>
        <textarea
          value={form.newAchievements}
          onChange={(event) => form.setNewAchievements(event.target.value)}
          placeholder="Каждое достижение с новой строки"
        />
      </label>
    </fieldset>
  );
}

function PositionEditorActions({
  error,
  busy,
  onCancel,
}: {
  readonly error: string;
  readonly busy: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <>
      {error ? (
        <p className="career-profile-screen-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="career-profile-screen-edit-actions">
        <button type="button" className="career-quiet-button" onClick={onCancel}>
          Отменить
        </button>
        <button type="submit" className="career-primary-button" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить место'}
        </button>
      </div>
    </>
  );
}

export function PositionEditForm(props: PositionEditorProps) {
  const form = usePositionFormState(props.entry, props.memory);
  const submit = usePositionSubmit(props, form);
  return (
    <form
      className="career-profile-screen-place-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.save();
      }}
    >
      <PositionIdentityFields form={form} />
      <PositionScheduleFields entry={props.entry} isNew={props.isNew} form={form} />
      <label className="career-profile-screen-field">
        <span>Описание</span>
        <textarea
          value={form.description}
          onChange={(event) => form.setDescription(event.target.value)}
        />
      </label>
      <PositionAchievementFields form={form} />
      <PositionEditorActions
        error={submit.error}
        busy={Boolean(props.saving || submit.submitting)}
        onCancel={props.onCancel}
      />
    </form>
  );
}
