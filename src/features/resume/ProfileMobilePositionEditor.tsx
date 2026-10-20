import { useEffect, useRef, useState } from 'react';
import { Plus, X } from '@phosphor-icons/react';
import {
  usePositionFormState,
  usePositionSubmit,
  type PositionEditorProps,
  type PositionFormState,
} from './ProfileExperienceEditor';
import { ProfileMobileGroup, ProfileMobileRow } from './ProfileMobileElements';

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="pm-field">
      <span>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MonthField({
  label,
  name,
  value,
  onChange,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [text, setText] = useState(() =>
    /^\d{4}-\d{2}$/u.test(value) ? `${value.slice(5)}.${value.slice(0, 4)}` : '',
  );
  return (
    <label className="pm-field">
      <span>{label}</span>
      <input
        name={name}
        inputMode="numeric"
        placeholder="ММ.ГГГГ"
        pattern="(0[1-9]|1[0-2])\.[0-9]{4}"
        maxLength={7}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next) onChange('');
          else if (/^(0[1-9]|1[0-2])\.\d{4}$/u.test(next))
            onChange(`${next.slice(3)}-${next.slice(0, 2)}`);
        }}
      />
    </label>
  );
}

function MobileIdentityFields({ form }: { readonly form: PositionFormState }) {
  return (
    <ProfileMobileGroup>
      <TextField
        label="Должность"
        value={form.title}
        onChange={form.setTitle}
        placeholder="Название должности"
      />
      <TextField
        label="Компания"
        value={form.employer}
        onChange={form.setEmployer}
        placeholder="Название компании"
      />
      <TextField
        label="Локация"
        value={form.location}
        onChange={form.setLocation}
        placeholder="Город"
      />
      <label className="pm-field profile-mobile-team-size">
        <span>Размер команды</span>
        <input
          name="teamSize"
          inputMode="numeric"
          autoComplete="off"
          placeholder="неизвестно"
          value={form.teamSize}
          aria-invalid={form.teamSizeInvalid || undefined}
          onChange={(event) => form.setTeamSize(event.target.value)}
        />
        <span className="profile-mobile-team-size__unit">человек</span>
      </label>
    </ProfileMobileGroup>
  );
}

function MobilePeriodFields({ form }: { readonly form: PositionFormState }) {
  return (
    <ProfileMobileGroup title="Период">
      <MonthField
        label="Начало"
        name="startDate"
        value={form.startDate}
        onChange={form.setStartDate}
      />
      {form.current ? (
        <label className="pm-field">
          <span>Окончание</span>
          <input name="endDate" value="по настоящее время" readOnly />
        </label>
      ) : (
        <MonthField
          label="Окончание"
          name="endDate"
          value={form.endDate}
          onChange={form.setEndDate}
        />
      )}
      <label className="pm-field is-switch">
        <span>Работаю здесь сейчас</span>
        <input
          className="profile-mobile-switch-input"
          type="checkbox"
          checked={form.current}
          onChange={(event) => form.setCurrent(event.target.checked)}
        />
        <span className={`pm-sw${form.current ? ' on' : ''}`} aria-hidden="true" />
      </label>
    </ProfileMobileGroup>
  );
}

const WORKPLACES = [
  ['on_site', 'Офис'],
  ['hybrid', 'Гибрид'],
  ['remote', 'Удалённо'],
] as const;

function MobileWorkplace({ form }: { readonly form: PositionFormState }) {
  return (
    <div className="pm-seg is-form" role="radiogroup" aria-label="Формат работы">
      {WORKPLACES.map(([value, label], index) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={form.workplaceType === value}
          tabIndex={form.workplaceType === value || (!form.workplaceType && !index) ? 0 : -1}
          onClick={() => form.setWorkplaceType(value)}
          onKeyDown={(event) => {
            const offset =
              event.key === 'ArrowRight' || event.key === 'ArrowDown'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                  ? -1
                  : 0;
            if (!offset) return;
            event.preventDefault();
            const next = (index + offset + WORKPLACES.length) % WORKPLACES.length;
            form.setWorkplaceType(WORKPLACES[next][0]);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
              [next]?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ExistingAchievements({ form }: { readonly form: PositionFormState }) {
  return (
    <>
      {form.currentFacts
        .filter((fact) => form.selectedFactIds.includes(fact.id))
        .map((fact) => (
          <div className="pm-del" key={fact.id}>
            <span>{fact.statement}</span>
            <button
              type="button"
              className="profile-mobile-remove"
              aria-label={`Удалить достижение: ${fact.statement}`}
              onClick={() => form.setSelectedFactIds((ids) => ids.filter((id) => id !== fact.id))}
            >
              <X size="1em" aria-hidden="true" />
            </button>
          </div>
        ))}
    </>
  );
}

function NewAchievementRows({
  form,
  count,
  onRemove,
}: {
  readonly form: PositionFormState;
  readonly count: number;
  readonly onRemove: (index: number) => void;
}) {
  const values = form.newAchievements.split('\n');
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="pm-del" key={index}>
          <input
            aria-label={`Новое достижение ${index + 1}`}
            placeholder="Добавьте результат в цифрах"
            value={values[index] ?? ''}
            onChange={(event) =>
              form.setNewAchievements(
                Array.from({ length: count }, (_, row) =>
                  row === index ? event.target.value : (values[row] ?? ''),
                ).join('\n'),
              )
            }
          />
          <button
            type="button"
            className="profile-mobile-remove"
            aria-label={`Удалить новое достижение ${index + 1}`}
            onClick={() => onRemove(index)}
          >
            <X size="1em" aria-hidden="true" />
          </button>
        </div>
      ))}
    </>
  );
}

function MobileAchievements({ form }: { readonly form: PositionFormState }) {
  const [count, setCount] = useState(0);
  const remove = (index: number) => {
    form.setNewAchievements(
      Array.from({ length: count }, (_, row) => form.newAchievements.split('\n')[row] ?? '')
        .filter((_, row) => row !== index)
        .join('\n'),
    );
    setCount((current) => current - 1);
  };
  return (
    <ProfileMobileGroup
      title="Достижения"
      foot="Лучше с цифрой: «снизил время релиза с 14 до 3 дней»."
    >
      <ExistingAchievements form={form} />
      <NewAchievementRows form={form} count={count} onRemove={remove} />
      <ProfileMobileRow
        icon={Plus}
        title="Добавить достижение"
        onClick={() => setCount((current) => current + 1)}
      />
    </ProfileMobileGroup>
  );
}

function MobileSkillInput({
  value,
  onChange,
  onDone,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <label className="pm-field profile-mobile-skill-edit">
      <span>Навык</span>
      <input
        ref={inputRef}
        value={value}
        aria-label="Навык на этом месте"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          onDone();
        }}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function MobilePositionSkills({ form }: { readonly form: PositionFormState }) {
  const [editing, setEditing] = useState<number>();
  return (
    <section className="pm-group">
      <h3 className="pm-cap">Навыки на этом месте</h3>
      <div className="pm-chips">
        {form.skills
          .filter((skill) => skill.trim())
          .map((skill, index) => (
            <span key={`${index}:${skill}`}>{skill}</span>
          ))}
        <button
          type="button"
          className="is-add"
          onClick={() => {
            if (editing !== undefined) return;
            setEditing(form.skills.length);
            form.setSkills((skills) => [...skills, '']);
          }}
        >
          <Plus size="1em" aria-hidden="true" />
          Навык
        </button>
      </div>
      {editing !== undefined ? (
        <MobileSkillInput
          value={form.skills[editing] ?? ''}
          onDone={() => setEditing(undefined)}
          onChange={(value) =>
            form.setSkills((skills) =>
              skills.map((skill, index) => (index === editing ? value : skill)),
            )
          }
        />
      ) : null}
    </section>
  );
}

export function ProfileMobilePositionEditor(props: PositionEditorProps) {
  const form = usePositionFormState(props.entry, props.memory);
  const submit = usePositionSubmit(props, form);
  return (
    <form
      className="pm-view profile-mobile-position-editor"
      data-experience-id={props.entry.id}
      onSubmit={(event) => {
        event.preventDefault();
        void submit.save();
      }}
    >
      <MobileIdentityFields form={form} />
      <MobilePeriodFields form={form} />
      <MobileWorkplace form={form} />
      <ProfileMobileGroup title="Описание">
        <textarea
          className="pm-area"
          aria-label="Описание"
          placeholder="Чем занимались, за что отвечали"
          value={form.description}
          onChange={(event) => form.setDescription(event.target.value)}
        />
      </ProfileMobileGroup>
      <MobileAchievements form={form} />
      <MobilePositionSkills form={form} />
      {submit.error ? (
        <p className="career-resume-error" role="alert">
          {submit.error}
        </p>
      ) : null}
      <div className="pm-savebar">
        <button className="pm-cta" type="submit" disabled={props.saving || submit.submitting}>
          {submit.submitting ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
