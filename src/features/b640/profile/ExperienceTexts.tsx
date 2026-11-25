import { MEMORY_TEXT_MAX } from '../../../../shared/factCorrection';
import { Icon } from '../kit';
import { RESULT_MAX_LENGTH, type ExperienceForm, type ResultRow } from './experienceForm';

interface TextsProps {
  readonly form: ExperienceForm;
  readonly onChange: (patch: Partial<ExperienceForm>) => void;
}

const DESCRIPTION_ROWS = 3;

/** «Что делали»: описание места работы. */
export function DescriptionField({ form, onChange }: TextsProps) {
  if (form.description === null) return null;
  return (
    <div className="pf-f">
      <label htmlFor="wk">Что делали</label>
      <textarea
        id="wk"
        rows={DESCRIPTION_ROWS}
        maxLength={MEMORY_TEXT_MAX}
        value={form.description}
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </div>
  );
}

/** «Результаты»: поле на строку, «Убрать» и «Добавить результат». */
export function ResultsField({ form, onChange }: TextsProps) {
  const change = (key: string, text: string) =>
    onChange({ results: form.results.map((row) => (row.key === key ? { ...row, text } : row)) });
  const remove = ({ key, memoryId }: ResultRow) =>
    onChange({
      results: form.results.filter((row) => row.key !== key),
      removed: memoryId ? [...form.removed, memoryId] : form.removed,
    });
  const add = () =>
    onChange({
      results: [...form.results, { key: crypto.randomUUID(), memoryId: null, text: '' }],
    });
  return (
    <fieldset className="pf-f pf-res">
      <legend className="pf-lbl">Результаты</legend>
      <ul className="pf-res-list">
        {form.results.map((row, index) => (
          <li className="pf-res-row" key={row.key}>
            <label className="vh" htmlFor={`r${index + 1}`}>
              Результат {index + 1}
            </label>
            <input
              id={`r${index + 1}`}
              type="text"
              value={row.text}
              maxLength={RESULT_MAX_LENGTH}
              placeholder="Например: план продаж 112 %"
              onChange={(event) => change(row.key, event.target.value)}
            />
            <button
              className="icon-btn"
              type="button"
              aria-label={`Убрать результат ${index + 1}`}
              onClick={() => remove(row)}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <button className="btn pf-res-add" type="button" onClick={add}>
        <Icon name="plus" />
        Добавить результат
      </button>
    </fieldset>
  );
}
