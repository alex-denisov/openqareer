import type { ReactNode } from 'react';
import { Icon } from '../kit';
import type { OfferForm, OfferFormErrors } from './model/offerForm';

type Key = keyof OfferForm;

export interface OfferFieldsProps {
  readonly form: OfferForm;
  readonly errors: OfferFormErrors;
  readonly isNew: boolean;
  readonly onChange: (key: Key, value: string) => void;
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
  readonly children: ReactNode;
}) {
  return (
    <div className={props.wide ? 'of-f is-wide' : 'of-f'}>
      <label htmlFor={`of-${props.id}`}>{props.label}</label>
      {props.children}
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
  return (
    <Field id={spec.key} label={spec.label} wide={spec.wide} error={error}>
      <input
        id={`of-${spec.key}`}
        type="text"
        inputMode={spec.mode}
        value={props.form[spec.key]}
        placeholder={spec.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `of-${spec.key}-err` : undefined}
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
  const known = props.options.some((option) => option.value === current);
  return (
    <Field id={props.id} label={props.label}>
      <select
        id={`of-${props.id}`}
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
