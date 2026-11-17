import { useState, type KeyboardEvent } from 'react';
import type { WorkplaceType } from '../../resume/resumeTypes';
import { Icon } from '../kit';
import { citySuggestions, type ExperienceForm, type ExperienceFormErrors } from './experienceForm';
import { MonthField } from './MonthField';

export interface FieldsProps {
  readonly form: ExperienceForm;
  readonly errors: ExperienceFormErrors;
  readonly onChange: (patch: Partial<ExperienceForm>) => void;
}

function FieldError({ id, text }: { readonly id: string; readonly text: string | undefined }) {
  if (!text) return null;
  return (
    <small className="is-err" id={id}>
      <Icon name="warn" />
      {text}
    </small>
  );
}

/** Период одной строкой: начало, окончание и «Ещё работаю здесь». */
export function PeriodFields({ form, errors, onChange }: FieldsProps) {
  return (
    <fieldset className="pf-dates">
      <legend>Период работы</legend>
      <div className="pf-per">
        <MonthField
          id="wd1"
          label="Начало"
          value={form.start}
          invalid={Boolean(errors.period)}
          describedBy={errors.period ? 'w-e' : undefined}
          onChange={(start) => onChange({ start })}
        />
        <MonthField
          id="wd2"
          label="Окончание"
          value={form.current ? '' : form.end}
          disabled={form.current}
          invalid={Boolean(errors.period)}
          describedBy={errors.period ? 'w-e' : undefined}
          onChange={(end) => onChange({ end })}
        />
        {errors.period ? (
          <small className="is-err pf-per-err" id="w-e">
            <Icon name="warn" />
            {errors.period}
          </small>
        ) : null}
        <div className="pf-sw">
          <label htmlFor="wnow">Ещё работаю здесь</label>
          <input
            className="sw"
            id="wnow"
            type="checkbox"
            role="switch"
            checked={form.current}
            onChange={(event) => onChange({ current: event.target.checked })}
          />
        </div>
      </div>
    </fieldset>
  );
}

interface CityOptionsProps {
  readonly options: readonly string[];
  readonly active: number;
  readonly onPick: (city: string) => void;
}

function CityOptions({ options, active, onPick }: CityOptionsProps) {
  return (
    <ul className="pf-sugg" id="ci-l" role="listbox" aria-label="Города">
      {options.map((city, index) => (
        <li
          key={city}
          id={`ci-o-${index}`}
          role="option"
          aria-selected={index === active}
          // До ухода фокуса с поля: иначе список закроется раньше выбора.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(city);
          }}
        >
          {city}
        </li>
      ))}
    </ul>
  );
}

/** Город из справочника: подсказки по началу названия, выбор мышью и стрелками. */
export function CityField({ form, errors, onChange }: FieldsProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = open ? citySuggestions(form.city) : [];
  const shown = options.length > 0;

  const pick = (city: string) => {
    onChange({ city });
    setOpen(false);
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') setOpen(false);
    if (!shown) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => (current + step + options.length) % options.length);
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(options[active]);
    }
  }

  return (
    <div className="pf-f pf-city">
      <label htmlFor="ci">Город</label>
      <input
        id="ci"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={shown ? 'ci-l' : undefined}
        aria-expanded={shown}
        aria-activedescendant={shown && active >= 0 ? `ci-o-${active}` : undefined}
        aria-invalid={errors.city ? true : undefined}
        aria-describedby={errors.city ? 'ci-e' : undefined}
        autoComplete="off"
        value={form.city}
        onChange={(event) => {
          setOpen(true);
          setActive(-1);
          onChange({ city: event.target.value });
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {shown ? <CityOptions options={options} active={active} onPick={pick} /> : null}
      <FieldError id="ci-e" text={errors.city} />
    </div>
  );
}

const FORMATS: readonly (readonly [WorkplaceType, string])[] = [
  ['on_site', 'Офис'],
  ['remote', 'Удалённо'],
  ['hybrid', 'Гибрид'],
];

export function FormatField({ form, onChange }: Pick<FieldsProps, 'form' | 'onChange'>) {
  return (
    <fieldset className="pf-f pf-fmt">
      <legend className="pf-lbl">
        Формат<span className="dim"> · необязательно</span>
      </legend>
      <div className="seg-ctl">
        {FORMATS.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="fm"
              checked={form.workplaceType === value}
              onChange={() => onChange({ workplaceType: value })}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TeamField({ form, errors, onChange }: FieldsProps) {
  return (
    <div className="pf-f">
      <label htmlFor="tm">
        Команда, человек<span className="dim"> · необязательно</span>
      </label>
      <input
        id="tm"
        type="text"
        inputMode="numeric"
        value={form.teamSize}
        aria-invalid={errors.teamSize ? true : undefined}
        aria-describedby={errors.teamSize ? 'tm-e' : undefined}
        onChange={(event) => onChange({ teamSize: event.target.value })}
      />
      <FieldError id="tm-e" text={errors.teamSize} />
    </div>
  );
}

interface SkillChipListProps {
  readonly skills: readonly string[];
  readonly onChange: (skills: readonly string[]) => void;
}

function SkillChipList({ skills, onChange }: SkillChipListProps) {
  if (skills.length === 0) return null;
  return (
    <ul className="pf-chips" aria-labelledby="sk-l">
      {skills.map((skill) => (
        <li key={skill}>
          <span className="pf-chip">
            {skill}
            <button
              type="button"
              aria-label={`Убрать навык ${skill}`}
              onClick={() => onChange(skills.filter((item) => item !== skill))}
            >
              <Icon name="close" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

const MAX_SKILLS = 30;
const SKILL_MAX_LENGTH = 60;

/** «Системы и инструменты»: метки с удалением и поле добавления (Enter). */
export function SkillsField({ form, onChange }: Pick<FieldsProps, 'form' | 'onChange'>) {
  const [text, setText] = useState('');

  function add() {
    const name = text.trim();
    const known = form.skills.some((skill) => skill.toLowerCase() === name.toLowerCase());
    if (name && !known && form.skills.length < MAX_SKILLS) {
      onChange({ skills: [...form.skills, name] });
    }
    setText('');
  }

  return (
    <div className="pf-f">
      <span className="pf-lbl" id="sk-l">
        Системы и инструменты
      </span>
      <SkillChipList skills={form.skills} onChange={(skills) => onChange({ skills })} />
      <label className="vh" htmlFor="sk">
        Добавить навык
      </label>
      <input
        id="sk"
        type="text"
        value={text}
        maxLength={SKILL_MAX_LENGTH}
        placeholder="Добавить систему или инструмент"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          add();
        }}
        onBlur={add}
      />
    </div>
  );
}

interface TextFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly onChange: (value: string) => void;
}

export function TextField({ id, label, value, error, onChange }: TextFieldProps) {
  return (
    <div className="pf-f">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={200}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-e`} text={error} />
    </div>
  );
}
