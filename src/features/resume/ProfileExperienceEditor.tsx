import { Buildings, Check, House, Laptop, Plus, Spinner, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CandidateMemory } from '../coach/coachApi';
import { apiErrorMessage } from '../coach/apiClient';
import { addManualExperienceFact } from './experienceFactApi';
import { monthInputValue } from './experienceDate';
import type { ResumeExperienceInput, WorkplaceType } from './resumeTypes';

type ValueSetter<T> = Dispatch<SetStateAction<T>>;

import './profilePositionEditor.css';

interface PositionFormBasics {
  readonly dateConflict: boolean;
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
  readonly skills: readonly string[];
  readonly setSkills: ValueSetter<readonly string[]>;
  readonly employmentType: string;
  readonly setEmploymentType: ValueSetter<string>;
  readonly workplaceType: WorkplaceType | '';
  readonly setWorkplaceType: ValueSetter<WorkplaceType | ''>;
  readonly current: boolean;
  readonly setCurrent: ValueSetter<boolean>;
  readonly teamSize: string;
  readonly setTeamSize: ValueSetter<string>;
}

interface PositionFormFacts {
  readonly selectedFactIds: readonly string[];
  readonly setSelectedFactIds: ValueSetter<readonly string[]>;
  readonly description: string;
  readonly setDescription: ValueSetter<string>;
  readonly achievementEdits: Readonly<Record<string, string>>;
  readonly setAchievementEdits: ValueSetter<Readonly<Record<string, string>>>;
  readonly newAchievements: string;
  readonly setNewAchievements: ValueSetter<string>;
  readonly currentFacts: readonly CandidateMemory[];
  readonly manualStatements: readonly string[];
}

export interface PositionFormState extends PositionFormBasics, PositionFormFacts {
  readonly patch: Partial<ResumeExperienceInput>;
  readonly teamSizeInvalid: boolean;
}

const TEAM_SIZE_PATTERN = /^\d{1,6}$/u;

/** Empty means unknown; anything else must be a whole number of people from 1. */
export function parseTeamSize(value: string): number | undefined | null {
  const text = value.trim();
  if (!text) return undefined;
  if (!TEAM_SIZE_PATTERN.test(text)) return null;
  const size = Number(text);
  return size >= 1 && size <= 100_000 ? size : null;
}

function useSynchronizedPositionMonth(value: string | undefined) {
  const incoming = monthInputValue(value);
  const previous = useRef({ month: incoming, raw: value });
  const [local, setLocal] = useState(incoming);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (previous.current.raw !== value) {
      if (local === previous.current.month) setLocal(incoming);
      else if (local !== incoming) setConflict(true);
      previous.current = { month: incoming, raw: value };
    }
    if (local === incoming) setConflict(false);
  }, [incoming, local, value]);
  return { value: local, setValue: setLocal, conflict };
}

function usePositionFormBasics(entry: ResumeExperienceInput): PositionFormBasics {
  const [title, setTitle] = useState(entry.title ?? '');
  const [employer, setEmployer] = useState(entry.employer ?? '');
  const start = useSynchronizedPositionMonth(entry.startDate);
  const end = useSynchronizedPositionMonth(entry.endDate);
  const [location, setLocation] = useState(entry.location ?? '');
  const [skills, setSkills] = useState<readonly string[]>(entry.skills ?? []);
  const [employmentType, setEmploymentType] = useState(entry.employmentType ?? '');
  const [workplaceType, setWorkplaceType] = useState<WorkplaceType | ''>(entry.workplaceType ?? '');
  const [current, setCurrent] = useState(entry.current);
  const [teamSize, setTeamSize] = useState(entry.teamSize ? String(entry.teamSize) : '');
  return {
    title,
    setTitle,
    employer,
    setEmployer,
    startDate: start.value,
    setStartDate: start.setValue,
    endDate: end.value,
    setEndDate: end.setValue,
    dateConflict: start.conflict || end.conflict,
    location,
    setLocation,
    skills,
    setSkills,
    employmentType,
    setEmploymentType,
    workplaceType,
    setWorkplaceType,
    current,
    setCurrent,
    teamSize,
    setTeamSize,
  };
}

function usePositionFormFacts(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): PositionFormFacts {
  const descriptionMemoryId = entry.descriptionMemoryId;
  const linkedDescription = descriptionMemoryId
    ? memory.find((item) => item.id === descriptionMemoryId)
    : undefined;
  const [selectedFactIds, setSelectedFactIds] = useState<readonly string[]>(() =>
    entry.bulletMemoryIds.filter((id) => id !== descriptionMemoryId),
  );
  const [description, setDescription] = useState(linkedDescription?.statement ?? '');
  const [newAchievements, setNewAchievements] = useState('');
  const [achievementEdits, setAchievementEdits] = useState<Readonly<Record<string, string>>>({});
  const currentFacts = entry.bulletMemoryIds
    .filter((id) => id !== descriptionMemoryId)
    .flatMap((id) => {
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
    achievementEdits,
    setAchievementEdits,
    currentFacts,
    manualStatements: newAchievements
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function normalizedPositionSkills(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  return skills.flatMap((skill) => {
    const value = skill.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
}

export function usePositionFormState(
  entry: ResumeExperienceInput,
  memory: readonly CandidateMemory[],
): PositionFormState {
  const basics = usePositionFormBasics(entry);
  const facts = usePositionFormFacts(entry, memory);
  const teamSize = parseTeamSize(basics.teamSize);
  return {
    ...basics,
    ...facts,
    teamSizeInvalid: teamSize === null,
    patch: {
      title: basics.title,
      employer: basics.employer,
      startDate:
        basics.startDate === monthInputValue(entry.startDate)
          ? entry.startDate
          : basics.startDate || undefined,
      endDate: basics.current
        ? undefined
        : basics.endDate === monthInputValue(entry.endDate)
          ? entry.endDate
          : basics.endDate || undefined,
      current: basics.current,
      location: basics.location,
      employmentType: basics.employmentType || undefined,
      workplaceType: basics.workplaceType || undefined,
      teamSize: teamSize ?? undefined,
      skills: normalizedPositionSkills(basics.skills),
      descriptionMemoryId: entry.descriptionMemoryId,
      bulletMemoryIds: facts.selectedFactIds,
    },
  };
}

export interface PositionEditorProps {
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

interface PositionFactUpdate {
  readonly patch: Partial<ResumeExperienceInput>;
  readonly createdManualFact: boolean;
}

async function createDescriptionFactUpdate(
  props: PositionEditorProps,
  form: PositionFormState,
  factKeys: Map<string, string>,
) {
  const statement = form.description.trim();
  const previous = props.entry.descriptionMemoryId
    ? (props.memory.find((fact) => fact.id === props.entry.descriptionMemoryId)?.statement.trim() ??
      '')
    : '';
  if (statement === previous)
    return { memoryId: props.entry.descriptionMemoryId, changed: false, created: false };
  if (!statement) return { memoryId: undefined, changed: true, created: false };
  const [memoryId] = await createManualFacts(
    props.candidateId ?? '',
    props.entry.id,
    [statement],
    factKeys,
  );
  return { memoryId, changed: true, created: true };
}

async function createEditedAchievementFacts(
  props: PositionEditorProps,
  form: PositionFormState,
  factKeys: Map<string, string>,
) {
  const ids: string[] = [];
  let changed = false;
  let created = false;
  for (const originalId of form.selectedFactIds) {
    const edited = form.achievementEdits[originalId];
    const previous = form.currentFacts.find((fact) => fact.id === originalId)?.statement.trim();
    if (edited === undefined || edited.trim() === previous) {
      ids.push(originalId);
      continue;
    }
    changed = true;
    if (!edited.trim()) continue;
    const [memoryId] = await createManualFacts(
      props.candidateId ?? '',
      props.entry.id,
      [edited.trim()],
      factKeys,
    );
    ids.push(memoryId);
    created = true;
  }
  return { ids, changed, created };
}

async function createPositionFactUpdate(
  props: PositionEditorProps,
  form: PositionFormState,
  factKeys: Map<string, string>,
): Promise<PositionFactUpdate | null> {
  const description = await createDescriptionFactUpdate(props, form, factKeys);
  const linked = await createEditedAchievementFacts(props, form, factKeys);
  const achievementIds = form.manualStatements.length
    ? await createManualFacts(
        props.candidateId ?? '',
        props.entry.id,
        form.manualStatements,
        factKeys,
      )
    : [];
  if (!description.changed && !linked.changed && !achievementIds.length) return null;
  return {
    patch: {
      descriptionMemoryId: description.memoryId,
      bulletMemoryIds: [...linked.ids, ...achievementIds],
    },
    createdManualFact: description.created || linked.created || achievementIds.length > 0,
  };
}

export function usePositionSubmit(props: PositionEditorProps, form: PositionFormState) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const factKeys = useRef(new Map<string, string>());
  const save = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      if (form.dateConflict) {
        setError(
          'Дата уже изменена в профиле. Введённый текст остался в форме. Отмените редактирование и откройте место заново, чтобы сверить изменения.',
        );
        return;
      }
      if (form.teamSizeInvalid) {
        setError('Размер команды — целое число людей, от 1. Текст остался в форме.');
        return;
      }
      if ((await props.onSave(form.patch)) === false) {
        setError('Изменения не сохранены. Повторите сохранение после устранения ошибки.');
        return;
      }
      const update = await createPositionFactUpdate(props, form, factKeys.current);
      if (update) {
        if ((await props.onSave({ ...form.patch, ...update.patch })) === false) {
          setError('Изменения не сохранены. Повторите сохранение после устранения ошибки.');
          return;
        }
        if (update.createdManualFact) await props.onManualExperienceFactAdded?.();
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
    <div className="career-profile-screen-field-grid profile-position-editor__field-pair">
      <label className="career-profile-screen-field">
        <span>Должность</span>
        <input value={form.title} onChange={(event) => form.setTitle(event.target.value)} />
      </label>
      <label className="career-profile-screen-field">
        <span>Компания</span>
        <input value={form.employer} onChange={(event) => form.setEmployer(event.target.value)} />
      </label>
    </div>
  );
}

function PositionWorkplaceFields({ form }: { readonly form: PositionFormState }) {
  const options = [
    ['on_site', 'Офис', Buildings],
    ['hybrid', 'Гибрид', House],
    ['remote', 'Удалённо', Laptop],
  ] as const;

  return (
    <div className="career-profile-screen-field-grid profile-position-editor__field-pair">
      <label className="career-profile-screen-field">
        <span>Локация</span>
        <input value={form.location} onChange={(event) => form.setLocation(event.target.value)} />
      </label>
      <fieldset className="career-profile-screen-field career-profile-screen-workplace-field profile-position-editor__workplace-field">
        <legend>Формат работы</legend>
        <div className="profile-position-editor__segments" role="group" aria-label="Формат работы">
          {options.map(([value, label, Icon]) => (
            <button
              key={value}
              className="career-btn is-sm profile-position-editor__segment-button"
              type="button"
              aria-pressed={form.workplaceType === value}
              onClick={() => form.setWorkplaceType(value)}
            >
              <Icon size={16} weight="regular" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function PositionTeamSizeField({ form }: { readonly form: PositionFormState }) {
  return (
    <label className="career-profile-screen-field profile-position-editor__team-size">
      <span>Размер команды</span>
      <span className="profile-position-editor__unit-input">
        <input
          type="text"
          name="teamSize"
          inputMode="numeric"
          autoComplete="off"
          placeholder="неизвестно"
          value={form.teamSize}
          aria-invalid={form.teamSizeInvalid || undefined}
          onChange={(event) => form.setTeamSize(event.target.value)}
        />
        <span className="profile-position-editor__unit">человек</span>
      </span>
    </label>
  );
}

function PositionDateAndFormatFields({ form }: { readonly form: PositionFormState }) {
  return (
    <div className="career-profile-screen-field-grid profile-position-editor__field-pair">
      <label className="career-profile-screen-field">
        <span>Начало</span>
        <input
          type="month"
          name="startDate"
          value={form.startDate}
          onChange={(event) => form.setStartDate(event.target.value)}
        />
      </label>
      <div className="profile-position-editor__end-date-field">
        <label className="career-profile-screen-field">
          <span>Окончание</span>
          <input
            type="month"
            name="endDate"
            value={form.endDate}
            disabled={form.current}
            onChange={(event) => form.setEndDate(event.target.value)}
          />
        </label>
        <CurrentRoleCheckbox form={form} />
      </div>
    </div>
  );
}

function CurrentRoleCheckbox({ form }: { readonly form: PositionFormState }) {
  return (
    <label className="career-profile-screen-fact-choice profile-position-editor__current-role">
      <input
        type="checkbox"
        checked={form.current}
        onChange={(event) => form.setCurrent(event.target.checked)}
      />
      Работаю здесь
    </label>
  );
}

function PositionScheduleFields({ form }: { readonly form: PositionFormState }) {
  return <PositionDateAndFormatFields form={form} />;
}

function LinkedAchievementRow({
  fact,
  form,
}: {
  readonly fact: CandidateMemory;
  readonly form: PositionFormState;
}) {
  const selected = form.selectedFactIds.includes(fact.id);
  const toggle = () =>
    form.setSelectedFactIds((ids) =>
      ids.includes(fact.id) ? ids.filter((id) => id !== fact.id) : [...ids, fact.id],
    );
  if (!selected)
    return (
      <button type="button" className="career-btn is-sm is-ghost" onClick={toggle}>
        Вернуть достижение: {fact.statement}
      </button>
    );
  return (
    <div className="profile-position-editor__achievement-row">
      <input
        className="profile-position-editor__achievement-input"
        aria-label={`Достижение: ${fact.statement}`}
        value={form.achievementEdits[fact.id] ?? fact.statement}
        onChange={(event) =>
          form.setAchievementEdits((values) => ({ ...values, [fact.id]: event.target.value }))
        }
      />
      <button
        type="button"
        className="career-btn is-sm is-icon is-ghost profile-position-editor__remove-achievement"
        aria-label={`Убрать достижение: ${fact.statement}`}
        onClick={toggle}
      >
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    </div>
  );
}

function achievementRows(value: string): string[] {
  return value.split(/\r?\n/u);
}

function updateAchievementRow(form: PositionFormState, rowIndex: number, value: string) {
  const rows = achievementRows(form.newAchievements);
  rows[rowIndex] = value;
  form.setNewAchievements(rows.join('\n'));
}

function appendAchievementRow(form: PositionFormState) {
  form.setNewAchievements((value) => `${value}\n`);
}

function removeAchievementRow(form: PositionFormState, rowIndex: number) {
  const rows = achievementRows(form.newAchievements);
  if (rows.length === 1) {
    form.setNewAchievements('');
    return;
  }
  form.setNewAchievements(rows.filter((_, index) => index !== rowIndex).join('\n'));
}

function ManualAchievementRow({
  form,
  value,
  index,
  rowCount,
}: {
  readonly form: PositionFormState;
  readonly value: string;
  readonly index: number;
  readonly rowCount: number;
}) {
  const label = `Достижение ${index + 1}`;
  return (
    <div className="profile-position-editor__achievement-row">
      <input
        className="profile-position-editor__achievement-input"
        aria-label={label}
        value={value}
        placeholder="Добавьте результат в цифрах"
        onChange={(event) => updateAchievementRow(form, index, event.target.value)}
      />
      <button
        type="button"
        className="career-btn is-sm is-icon is-ghost profile-position-editor__remove-achievement"
        aria-label={`Убрать достижение ${index + 1}`}
        disabled={rowCount === 1 && !value.trim()}
        onClick={() => removeAchievementRow(form, index)}
      >
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    </div>
  );
}

function ManualAchievementRows({ form }: { readonly form: PositionFormState }) {
  const rows = achievementRows(form.newAchievements);
  return (
    <div
      className="profile-position-editor__achievement-list"
      role="group"
      aria-label="Новые достижения"
    >
      {rows.map((value, index) => (
        <ManualAchievementRow
          key={index}
          form={form}
          value={value}
          index={index}
          rowCount={rows.length}
        />
      ))}
    </div>
  );
}

function PositionAchievementFields({ form }: { readonly form: PositionFormState }) {
  return (
    <fieldset className="profile-position-editor__achievements">
      <legend>Достижения</legend>
      {form.currentFacts.length ? (
        <div
          className="profile-position-editor__linked-facts"
          role="group"
          aria-label="Факты из профиля"
        >
          {form.currentFacts.map((fact) => (
            <LinkedAchievementRow key={fact.id} fact={fact} form={form} />
          ))}
        </div>
      ) : null}
      <ManualAchievementRows form={form} />
      <button
        type="button"
        className="career-btn is-ghost is-sm profile-position-editor__add-achievement"
        onClick={() => appendAchievementRow(form)}
      >
        <Plus size={16} weight="regular" aria-hidden="true" />
        Достижение
      </button>
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
      <div className="career-profile-screen-edit-actions profile-position-editor__actions">
        <button
          type="submit"
          className="career-btn career-inline-ok is-sm"
          disabled={busy}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <Spinner size={16} weight="regular" aria-hidden="true" />
          ) : (
            <Check size={16} weight="regular" aria-hidden="true" />
          )}
          {busy ? 'Сохраняем…' : 'Сохранить место'}
        </button>
        <button type="button" className="career-btn is-sm" onClick={onCancel}>
          <X size={16} weight="regular" aria-hidden="true" />
          Отменить
        </button>
        <span className="profile-position-editor__actions-note">
          Меняется всё место целиком, одной правкой.
        </span>
      </div>
    </>
  );
}

export function PositionEditForm(props: PositionEditorProps) {
  const form = usePositionFormState(props.entry, props.memory);
  const submit = usePositionSubmit(props, form);
  const titleId = useId();
  const employerLabel = form.employer.trim() || 'Место работы';

  return (
    <form
      className="career-profile-screen-place-editor profile-position-editor"
      data-experience-id={props.entry.id}
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        void submit.save();
      }}
    >
      <header className="profile-position-editor__header">
        <h3 id={titleId}>{employerLabel}: редактирование места</h3>
        <span className="tag is-hyp">Черновик правок</span>
      </header>
      <PositionIdentityFields form={form} />
      <PositionScheduleFields form={form} />
      <PositionWorkplaceFields form={form} />
      <PositionTeamSizeField form={form} />
      <label className="career-profile-screen-field profile-position-editor__description">
        <span>Описание</span>
        <textarea
          rows={3}
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
