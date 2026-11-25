import { useId, useState } from 'react';
import { Icon, RowAction } from '../kit';
import { formatSalaryInput, parseSalary, type ConditionField } from './conditionsModel';
import { EditFrame, type EditorProps } from './EditFrame';
import { GeoEditor } from './GeoEditor';
import { ToggleChecks, useToggleList } from './ToggleChecks';

function SalaryEditor({ value, onSave, ...rest }: EditorProps) {
  const id = useId();
  const [text, setText] = useState(formatSalaryInput(value.salaryFrom.amountRubles));
  const [showWithoutSalary, setShowWithoutSalary] = useState(value.salaryFrom.showWithoutSalary);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const parsed = parseSalary(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onSave({ ...value, salaryFrom: { amountRubles: parsed.value, showWithoutSalary } });
  };
  return (
    <EditFrame label="Зарплата от" onSave={save} {...rest}>
      <div className="field">
        <label htmlFor={id}>Зарплата от, ₽ в месяц на руки</label>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          placeholder="Не указано"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(event) => setText(event.target.value)}
        />
        {error ? (
          <small className="is-err" id={`${id}-err`}>
            <Icon name="warn" />
            {error}
          </small>
        ) : null}
      </div>
      <div className="check">
        <input
          id={`${id}-none`}
          type="checkbox"
          checked={showWithoutSalary}
          onChange={(event) => setShowWithoutSalary(event.target.checked)}
        />
        <label htmlFor={`${id}-none`}>Показывать вакансии без зарплаты</label>
      </div>
    </EditFrame>
  );
}

const FORMATS = [
  ['office', 'Офис'],
  ['hybrid', 'Гибрид'],
  ['remote', 'Удалённо'],
] as const;

function FormatEditor({ value, onSave, ...rest }: EditorProps) {
  const id = useId();
  const [format, setFormat] = useState(value.format);
  return (
    <EditFrame label="Формат" onSave={() => onSave({ ...value, format })} {...rest}>
      {FORMATS.map(([kind, label]) => (
        <div className="check" key={kind}>
          <input
            id={`${id}-${kind}`}
            type="checkbox"
            checked={format[kind]}
            onChange={(event) => setFormat({ ...format, [kind]: event.target.checked })}
          />
          <label htmlFor={`${id}-${kind}`}>{label}</label>
        </div>
      ))}
    </EditFrame>
  );
}

function StopEditor({ value, onSave, ...rest }: EditorProps) {
  const id = useId();
  const companies = useToggleList(value.stopList.map((company) => company.name));
  const [name, setName] = useState('');
  const add = () => {
    if (!name.trim()) return;
    companies.add(name.trim());
    setName('');
  };
  const save = () => {
    const kept = new Map(value.stopList.map((company) => [company.name, company]));
    const stopList = companies.checked.map(
      (company) => kept.get(company) ?? { id: company, name: company, origin: 'manual' },
    );
    onSave({ ...value, stopList });
  };
  return (
    <EditFrame label="Стоп-лист" onSave={save} {...rest}>
      <ToggleChecks list={companies} />
      <div className="field">
        <label htmlFor={id}>Компания</label>
        <input
          id={id}
          type="text"
          value={name}
          placeholder="Например, Ладога Банк"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
      </div>
      <div className="cc-acts">
        <RowAction icon="plus" onClick={add} disabled={!name.trim()}>
          Добавить в стоп-лист
        </RowAction>
      </div>
    </EditFrame>
  );
}

/** Правка условия по полю (макет c10: открыта правка «Зарплата от»). */
export function ConditionEditor({
  field,
  ...props
}: EditorProps & { readonly field: ConditionField }) {
  if (field === 'salary') return <SalaryEditor {...props} />;
  if (field === 'format') return <FormatEditor {...props} />;
  if (field === 'stop') return <StopEditor {...props} />;
  return <GeoEditor {...props} />;
}
