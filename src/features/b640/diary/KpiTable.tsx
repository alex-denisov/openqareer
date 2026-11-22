import type { CSSProperties } from 'react';
import { Icon } from '../kit/Icon';
import type { KpiDraftRow } from './kpiModel';

export const HORIZON_OPTIONS = [
  ['', '—'],
  ['quarter', 'квартал'],
  ['year', 'год'],
  ['next_quarter', 'дальше'],
] as const;
export const SETTER_OPTIONS = [
  ['', '—'],
  ['manager', 'руководитель'],
  ['team', 'команда'],
  ['self', 'вы'],
] as const;

interface RowProps {
  readonly row: KpiDraftRow;
  readonly error?: string;
  readonly onChange: (id: string, patch: Partial<KpiDraftRow>) => void;
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map(([key, text]) => (
        <option key={key} value={key}>
          {text}
        </option>
      ))}
    </select>
  );
}

function TextCell({
  label,
  value,
  max,
  className,
  chars,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly max: number;
  readonly className?: string;
  /** Ширина поля по значению, в знаках: столбец таблицы по содержимому (B645 d02l). */
  readonly chars?: number;
  readonly onChange: (value: string) => void;
}) {
  return (
    <input
      className={className}
      type="text"
      aria-label={label}
      value={value}
      style={chars ? ({ '--kp-ch': chars } as CSSProperties) : undefined}
      maxLength={max}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function OkToggle({ ok, onToggle }: { readonly ok: boolean; readonly onToggle: () => void }) {
  return (
    <button
      className={ok ? 'btn is-sm is-on' : 'btn is-sm'}
      type="button"
      aria-pressed={ok}
      onClick={onToggle}
    >
      {ok ? <Icon name="check" /> : null}
      Верно
    </button>
  );
}

function TitleCell(props: {
  readonly name: string;
  readonly value: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <td data-l="Показатель">
      <TextCell
        label={`Показатель: ${props.name}`}
        value={props.value}
        chars={props.value.length}
        max={240}
        onChange={props.onChange}
      />
      {props.error ? (
        <p className="va-err" role="alert">
          {props.error}
        </p>
      ) : null}
    </td>
  );
}

function WeightCell(props: {
  readonly name: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <td data-l="Важность">
      <span className="kp-pct">
        <TextCell
          className="kp-w"
          label={`Важность, %: ${props.name}`}
          value={props.value}
          chars={Math.max(props.value.length, 2)}
          max={6}
          onChange={props.onChange}
        />
        %
      </span>
    </td>
  );
}

function KpiRow({ row, error, onChange }: RowProps) {
  const name = row.title || 'показатель';
  const set = (patch: Partial<KpiDraftRow>) => onChange(row.id, patch);
  return (
    <tr className={row.ok ? undefined : 'is-off'}>
      <TitleCell name={name} value={row.title} error={error} onChange={(title) => set({ title })} />
      <td data-l="Цель">
        <TextCell
          className="kp-t"
          label={`Цель: ${name}`}
          value={row.target}
          chars={Math.max(row.target.length, 4)}
          max={120}
          onChange={(target) => set({ target })}
        />
      </td>
      <td data-l="Срок">
        <Select
          label={`Срок: ${name}`}
          value={row.horizon}
          options={HORIZON_OPTIONS}
          onChange={(value) => set({ horizon: value as KpiDraftRow['horizon'] })}
        />
      </td>
      <WeightCell name={name} value={row.weight} onChange={(weight) => set({ weight })} />
      <td data-l="Кто поставил">
        <Select
          label={`Кто поставил: ${name}`}
          value={row.setBy}
          options={SETTER_OPTIONS}
          onChange={(value) => set({ setBy: value as KpiDraftRow['setBy'] })}
        />
      </td>
      <td data-l="Проверка">
        <OkToggle ok={row.ok} onToggle={() => set({ ok: !row.ok })} />
      </td>
    </tr>
  );
}

interface TableProps {
  readonly rows: readonly KpiDraftRow[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (id: string, patch: Partial<KpiDraftRow>) => void;
}

/** Таблица проверки d02l: каждая строка правится на месте и отмечается «Верно». */
export function KpiTable({ rows, errors, onChange }: TableProps) {
  return (
    <table className="dn-tbl kp-tbl">
      <caption className="vh">Показатели из KPI</caption>
      <thead>
        <tr>
          <th scope="col">Показатель</th>
          <th scope="col">Цель</th>
          <th scope="col">Срок</th>
          <th scope="col">Важность</th>
          <th scope="col">Кто поставил</th>
          <th scope="col">
            <span className="vh">Проверка</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <KpiRow key={row.id} row={row} error={errors[row.id]} onChange={onChange} />
        ))}
      </tbody>
    </table>
  );
}
