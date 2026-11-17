import { useState } from 'react';
import { Button, Dialog } from '../kit';
import { monthLabel } from './experienceForm';

const MONTHS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, '0');
  return { value, label: monthLabel(`2000-${value}`).replace(/\s*2000$/u, '') };
});
const MIN_YEAR = 1950;

interface MonthDialogProps {
  readonly id: string;
  readonly title: string;
  readonly open: boolean;
  readonly month: string;
  readonly year: string;
  readonly onMonth: (month: string) => void;
  readonly onYear: (year: string) => void;
  readonly onClose: () => void;
  readonly onDone: () => void;
}

function MonthDialog(props: MonthDialogProps) {
  const { id, title, open, month, year, onMonth, onYear, onClose, onDone } = props;
  const yearNumber = Number(year);
  const yearValid =
    /^\d{4}$/u.test(year) && yearNumber >= MIN_YEAR && yearNumber <= new Date().getFullYear();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button variant="primary" icon="check" disabled={!yearValid} onClick={onDone}>
          Готово
        </Button>
      }
    >
      <div className="pf-two">
        <div className="pf-f">
          <label htmlFor={`${id}-month`}>Месяц</label>
          <select
            id={`${id}-month`}
            value={month}
            onChange={(event) => onMonth(event.target.value)}
          >
            {MONTHS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pf-f">
          <label htmlFor={`${id}-year`}>Год</label>
          <input
            id={`${id}-year`}
            type="text"
            inputMode="numeric"
            maxLength={4}
            value={year}
            aria-invalid={!yearValid || undefined}
            onChange={(event) => onYear(event.target.value.replace(/\D/gu, ''))}
          />
        </div>
      </div>
    </Dialog>
  );
}

export interface MonthFieldProps {
  readonly id: string;
  readonly label: string;
  /** `ГГГГ-ММ` или пусто. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  readonly describedBy?: string;
}

/** Месяц и год одной строкой: поле открывает окно выбора (на 390 — лист). */
export function MonthField(props: MonthFieldProps) {
  const { id, label, value, onChange, disabled, invalid, describedBy } = props;
  const thisYear = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('01');
  const [year, setYear] = useState(String(thisYear));

  function show() {
    setMonth(value.slice(5, 7) || '01');
    setYear(value.slice(0, 4) || String(thisYear));
    setOpen(true);
  }

  return (
    <div className="pf-f">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        className="pf-pick"
        readOnly
        aria-haspopup="dialog"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        value={monthLabel(value)}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            show();
          }
        }}
      />
      <MonthDialog
        id={id}
        title={label}
        open={open}
        month={month}
        year={year}
        onMonth={setMonth}
        onYear={setYear}
        onClose={() => setOpen(false)}
        onDone={() => {
          onChange(`${year}-${month}`);
          setOpen(false);
        }}
      />
    </div>
  );
}
