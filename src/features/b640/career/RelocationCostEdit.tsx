import { useId, useState } from 'react';
import { Button, StatusLine } from '../kit';
import { COST_SECTIONS, type CostKey, type CostSection } from './relocationCostsModel';

export interface CostEditProps {
  readonly sections: readonly CostSection[];
  readonly initial: number | undefined;
  readonly currency: string;
  readonly busy: boolean;
  readonly failed: boolean;
  /** Нет согласия на данные о переезде: сохранить нельзя. */
  readonly blocked: boolean;
  readonly onSave: (key: CostKey, amount: number) => void;
  readonly onCancel: () => void;
}

function SectionSelect(props: {
  readonly id: string;
  readonly sections: readonly CostSection[];
  readonly value: CostKey;
  readonly onChange: (key: CostKey) => void;
}) {
  if (props.sections.length < 2) return null;
  return (
    <div className="field">
      <label htmlFor={props.id}>Раздел</label>
      <select
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as CostKey)}
      >
        {props.sections.map((item) => (
          <option value={item.key} key={item.key}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function parseAmount(text: string): number | null {
  const amount = Number(text.replace(/\s/gu, ''));
  return text.trim() !== '' && Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

/** Сумма раздела трат на месте строки: выбор раздела (при добавлении), сумма, «Сохранить». */
export function RelocationCostEdit(props: CostEditProps) {
  const id = useId();
  const [key, setKey] = useState<CostKey>(props.sections[0]!.key);
  const [text, setText] = useState(props.initial === undefined ? '' : String(props.initial));
  const amount = parseAmount(text);
  const section = COST_SECTIONS.find((item) => item.key === key)!;
  return (
    <li className="rl-cost is-next">
      <SectionSelect id={`${id}-k`} sections={props.sections} value={key} onChange={setKey} />
      <div className="field">
        <label htmlFor={`${id}-a`}>
          {section.label}, {props.currency} {section.once ? 'разово' : 'в месяц'}
        </label>
        <input
          id={`${id}-a`}
          className="num"
          type="text"
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="actions">
        <Button
          variant="primary"
          size="sm"
          icon="check"
          busy={props.busy}
          disabled={amount === null || props.blocked}
          onClick={() => amount !== null && props.onSave(key, amount)}
        >
          Сохранить
        </Button>
        <Button variant="quiet" size="sm" onClick={props.onCancel}>
          Отмена
        </Button>
      </div>
      {props.failed ? (
        <StatusLine state="err" text="Сумма не сохранилась. Попробуйте ещё раз." />
      ) : null}
    </li>
  );
}
