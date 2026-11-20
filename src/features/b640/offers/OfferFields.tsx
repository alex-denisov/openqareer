import type { ReactNode } from 'react';
import { Icon } from '../kit';
import type { OfferForm, OfferFormErrors } from './model/offerForm';

type Key = keyof OfferForm;

export interface OfferFieldsProps {
  readonly form: OfferForm;
  readonly errors: OfferFormErrors;
  readonly isNew: boolean;
  readonly onChange: (key: Key, value: string) => void;
  /** После разбора письма (B646): поля из письма; `null` — письмо не разбирали. */
  readonly fromLetter?: ReadonlySet<Key> | null;
}

type Mark = 'letter' | 'own' | null;

function describedBy(key: Key, error: string | undefined, mark: Mark): string | undefined {
  const ids = [error ? `of-${key}-err` : '', mark === 'letter' ? `of-${key}-src` : ''];
  return ids.filter(Boolean).join(' ') || undefined;
}

/** Из письма — рамка; заполненное кандидатом после разбора — «с ваших слов». */
function markOf(props: OfferFieldsProps, key: Key): Mark {
  if (!props.fromLetter) return null;
  if (props.fromLetter.has(key)) return 'letter';
  return key !== 'source' && props.form[key].trim() ? 'own' : null;
}

interface TextSpec {
  readonly key: Key;
  readonly label: string;
  readonly placeholder: string;
  readonly mode: 'numeric' | 'text';
  readonly wide?: boolean;
}

const FORMAT_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: 'Не указан' },
  { value: 'remote', label: 'Удалённо' },
  { value: 'hybrid', label: 'Гибрид' },
  { value: 'office', label: 'Офис' },
];

function Field(props: {
  readonly id: Key;
  readonly label: string;
  readonly wide?: boolean;
  readonly error?: string;
  readonly mark?: Mark;
  readonly children: ReactNode;
}) {
  const className = [
    'of-f',
    props.wide ? 'is-wide' : '',
    props.mark === 'letter' ? 'is-letter' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className}>
      <label htmlFor={`of-${props.id}`}>{props.label}</label>
      {props.children}
      {props.mark === 'letter' ? (
        <span className="vh" id={`of-${props.id}-src`}>
          из письма, проверьте
        </span>
      ) : null}
      {props.mark === 'own' ? <small className="of-src">с ваших слов</small> : null}
      {props.error ? (
        <small className="is-err" id={`of-${props.id}-err`}>
          <Icon name="warn" />
          {props.error}
        </small>
      ) : null}
    </div>
  );
}

function TextField({ spec, ...props }: OfferFieldsProps & { readonly spec: TextSpec }) {
  const error = props.errors[spec.key];
  const mark = markOf(props, spec.key);
  return (
    <Field id={spec.key} label={spec.label} wide={spec.wide} error={error} mark={mark}>
      <input
        id={`of-${spec.key}`}
        type="text"
        inputMode={spec.mode}
        value={props.form[spec.key]}
        placeholder={spec.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(spec.key, error, mark)}
        onChange={(event) => props.onChange(spec.key, event.currentTarget.value)}
      />
    </Field>
  );
}

function SelectField(
  props: OfferFieldsProps & {
    readonly id: Key;
    readonly label: string;
    readonly options: readonly { readonly value: string; readonly label: string }[];
  },
) {
  const current = props.form[props.id];
  const mark = markOf(props, props.id);
  const known = props.options.some((option) => option.value === current);
  return (
    <Field id={props.id} label={props.label} mark={mark}>
      <select
        id={`of-${props.id}`}
        aria-describedby={describedBy(props.id, undefined, mark)}
        value={current}
        onChange={(event) => props.onChange(props.id, event.currentTarget.value)}
      >
        {known ? null : <option value={current}>{current}</option>}
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const NEW_FIELDS: readonly TextSpec[] = [
  { key: 'company', label: 'Компания', placeholder: 'Например, Вектор Банк', mode: 'text' },
  {
    key: 'title',
    label: 'Должность',
    placeholder: 'Например, руководитель разработки',
    mode: 'text',
  },
];

const MIDDLE_FIELDS: readonly TextSpec[] = [
  { key: 'respondBy', label: 'Срок ответа', placeholder: 'дд.мм.гггг', mode: 'numeric' },
  { key: 'probationMonths', label: 'Испытательный срок (мес.)', placeholder: '3', mode: 'numeric' },
  {
    key: 'probationSalary',
    label: 'Оклад на испытательном',
    placeholder: 'Если отличается от оклада',
    mode: 'numeric',
  },
  { key: 'tax', label: 'Налог, %', placeholder: 'Например, 13', mode: 'numeric' },
];

const WIDE_FIELDS: readonly TextSpec[] = [
  {
    key: 'benefits',
    label: 'Бенефиты (через запятую)',
    placeholder: 'ДМС со стоматологией, оплата спорта, техника',
    mode: 'text',
    wide: true,
  },
  {
    key: 'risks',
    label: 'Риски и нюансы (через запятую)',
    placeholder: 'Серая премия, частые переработки, обязательный офис',
    mode: 'text',
    wide: true,
  },
  {
    key: 'source',
    label: 'Источник данных',
    placeholder: 'с ваших слов',
    mode: 'text',
    wide: true,
  },
];

/** Сетка полей оффера `div.of-grid` из макета O6a. */
export function OfferFields(props: OfferFieldsProps) {
  return (
    <div className="of-grid">
      {props.isNew
        ? NEW_FIELDS.map((spec) => <TextField key={spec.key} spec={spec} {...props} />)
        : null}
      <TextField
        spec={{ key: 'base', label: 'Оклад', placeholder: 'Например, 300000', mode: 'numeric' }}
        {...props}
      />
      <SelectField
        {...props}
        id="period"
        label="Период оклада"
        options={[
          { value: 'month', label: 'В месяц' },
          { value: 'year', label: 'В год' },
        ]}
      />
      <SelectField
        {...props}
        id="currency"
        label="Валюта"
        options={[
          { value: 'RUB', label: 'RUB (₽)' },
          { value: 'USD', label: 'USD ($)' },
          { value: 'EUR', label: 'EUR (€)' },
        ]}
      />
      <TextField
        spec={{
          key: 'bonus',
          label: 'Годовой бонус / премия',
          placeholder: 'Например, 500000',
          mode: 'numeric',
        }}
        {...props}
      />
      <SelectField {...props} id="format" label="Формат работы" options={FORMAT_OPTIONS} />
      {MIDDLE_FIELDS.map((spec) => (
        <TextField key={spec.key} spec={spec} {...props} />
      ))}
      {WIDE_FIELDS.map((spec) => (
        <TextField key={spec.key} spec={spec} {...props} />
      ))}
    </div>
  );
}
