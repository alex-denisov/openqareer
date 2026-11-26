import { useId, useState } from 'react';
import type { CareerDiaryKpiImport } from '../../../../shared/careerDiaryKpi';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { Icon } from '../kit/Icon';
import { InfoTip } from '../kit/InfoTip';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { plural } from './goalsModel';
import { HORIZON_OPTIONS, SETTER_OPTIONS } from './KpiTable';
import { rowSummary, sourceLine, weightNote, type KpiDraftRow } from './kpiModel';

type Change = (id: string, patch: Partial<KpiDraftRow>) => void;

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly max: number;
  readonly onChange: (value: string) => void;
}

function TextField({ id, label, value, max, onChange }: FieldProps) {
  return (
    <div className="gb-f">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChange: (value: string) => void;
}

function SelectField({ id, label, value, options, onChange }: SelectFieldProps) {
  return (
    <div className="gb-f">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

interface RowFieldsProps {
  readonly row: KpiDraftRow;
  readonly onChange: Change;
}

function RowFields({ row, onChange }: RowFieldsProps) {
  const id = useId();
  const set = (patch: Partial<KpiDraftRow>) => onChange(row.id, patch);
  return (
    <div className="kp-sh-f">
      <TextField
        id={`${id}-n`}
        label="Название"
        value={row.title}
        max={240}
        onChange={(title) => set({ title })}
      />
      <div className="kp-two">
        <TextField
          id={`${id}-g`}
          label="Цель"
          value={row.target}
          max={120}
          onChange={(target) => set({ target })}
        />
        <SelectField
          id={`${id}-h`}
          label="Срок"
          value={row.horizon}
          options={HORIZON_OPTIONS}
          onChange={(value) => set({ horizon: value as KpiDraftRow['horizon'] })}
        />
      </div>
      <div className="kp-two">
        <TextField
          id={`${id}-w`}
          label="Важность, %"
          value={row.weight}
          max={6}
          onChange={(weight) => set({ weight })}
        />
        <SelectField
          id={`${id}-s`}
          label="Кто поставил"
          value={row.setBy}
          options={SETTER_OPTIONS}
          onChange={(value) => set({ setBy: value as KpiDraftRow['setBy'] })}
        />
      </div>
    </div>
  );
}

interface SheetProps {
  readonly row: KpiDraftRow | null;
  readonly onChange: Change;
  readonly onClose: () => void;
}

/** Лист правки строки (макет d02l на 390): название, цель, срок, важность, кто поставил. */
function RowSheet({ row, onChange, onClose }: SheetProps) {
  if (!row) return null;
  const footer = (
    <Button variant="primary" onClick={onClose}>
      Готово
    </Button>
  );
  return (
    <Dialog open onClose={onClose} title="Показатель" footer={footer}>
      <RowFields row={row} onChange={onChange} />
    </Dialog>
  );
}

function HeadMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lk-menu">
      <button
        className="icon-btn"
        type="button"
        aria-label="Ещё действия: показатели"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <ul className="lk-menu-l" role="menu" hidden={!open}>
        <li role="none">
          <Link role="menuitem" to={buildNodePath('d02k')}>
            Загрузить заново
          </Link>
        </li>
      </ul>
    </div>
  );
}

interface ItemProps {
  readonly row: KpiDraftRow;
  readonly error?: string;
  readonly onOpen: () => void;
  readonly onChange: Change;
}

function KpiItem({ row, error, onOpen, onChange }: ItemProps) {
  const name = row.title || 'показатель';
  const summary = rowSummary(row);
  return (
    <li className="kp-row">
      <button className="kp-main" type="button" onClick={onOpen}>
        <span className="kp-t">{name}</span>
        <span className="kp-v num">{row.target}</span>
        {summary ? <span className="kp-s">{summary}</span> : null}
        {error ? (
          <span className="kp-s va-err" role="alert">
            {error}
          </span>
        ) : null}
      </button>
      <span className="sw-cell kp-ok">
        <input
          className="sw"
          type="checkbox"
          role="switch"
          aria-label={`Верно: ${name}`}
          checked={row.ok}
          onChange={() => onChange(row.id, { ok: !row.ok })}
        />
      </span>
    </li>
  );
}

interface ListProps {
  readonly draft: CareerDiaryKpiImport;
  readonly rows: readonly KpiDraftRow[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: Change;
}

/** d02l на 390: показатели списком, «Верно» переключателем, правка в нижнем листе. */
export function KpiMobileList({ draft, rows, errors, onChange }: ListProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const count = `${rows.length} ${plural(rows.length, 'показатель', 'показателя', 'показателей')}`;
  return (
    <section className="kp only-mob" aria-labelledby="kp-t">
      <div className="kp-head">
        <h2 className="kp-h" id="kp-t">
          {`Проверьте ${count}`}
        </h2>
        <InfoTip label="Откуда показатели" text={sourceLine(draft)} />
        <InfoTip label="Как считается вес" text={weightNote(rows)} />
        <HeadMenu />
      </div>
      <ul className="kp-list">
        {rows.map((row) => (
          <KpiItem
            key={row.id}
            row={row}
            error={errors[row.id]}
            onOpen={() => setEditing(row.id)}
            onChange={onChange}
          />
        ))}
      </ul>
      <RowSheet
        row={rows.find((row) => row.id === editing) ?? null}
        onChange={onChange}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}
