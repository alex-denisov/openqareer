import React from 'react';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly inputMode?: 'text' | 'email' | 'tel' | 'numeric';
  readonly invalid?: boolean;
}

/** One labelled field with its writing hint under it. */
export function Field({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  multiline,
  inputMode,
  invalid,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    value,
    placeholder,
    'aria-describedby': hintId,
    'aria-invalid': invalid || undefined,
  };
  return (
    <div className="rb-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...shared} rows={3} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input
          {...shared}
          type={inputMode === 'email' ? 'email' : inputMode === 'tel' ? 'tel' : 'text'}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? (
        <small id={hintId} className="rb-hint">
          {hint}
        </small>
      ) : null}
    </div>
  );
}

interface ListEditorProps {
  readonly idPrefix: string;
  readonly label: string;
  readonly items: readonly string[];
  readonly onChange: (items: string[]) => void;
  readonly addLabel: string;
  readonly max: number;
  readonly hint?: string;
  readonly placeholder?: string;
}

/** A list of one-line items (results, bullets) with add and remove. */
// One block of markup; splitting it would scatter a single layout.
// eslint-disable-next-line max-lines-per-function
export function ListEditor({
  idPrefix,
  label,
  items,
  onChange,
  addLabel,
  max,
  hint,
  placeholder,
}: ListEditorProps) {
  const hintId = hint ? `${idPrefix}-hint` : undefined;
  return (
    <fieldset className="rb-list">
      <legend>{label}</legend>
      {hint ? (
        <small id={hintId} className="rb-hint">
          {hint}
        </small>
      ) : null}
      {items.map((item, index) => (
        <div className="rb-list-row" key={index}>
          <input
            id={`${idPrefix}-${index}`}
            aria-label={`${label}, пункт ${index + 1}`}
            aria-describedby={hintId}
            value={item}
            placeholder={index === 0 ? placeholder : undefined}
            onChange={(event) =>
              onChange(items.map((old, at) => (at === index ? event.target.value : old)))
            }
          />
          {items.length > 1 ? (
            <button
              type="button"
              className="rb-remove"
              aria-label={`Удалить пункт ${index + 1}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      {items.length < max ? (
        <button
          type="button"
          className="ps-btn is-ghost rb-add"
          onClick={() => onChange([...items, ''])}
        >
          {addLabel}
        </button>
      ) : null}
    </fieldset>
  );
}
