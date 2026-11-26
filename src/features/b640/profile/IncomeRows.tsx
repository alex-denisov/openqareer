import { useState, type FormEvent } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button, Dialog, Icon, StatusLine } from '../kit';
import { incomeAmount, incomeLabel, saveIncome, type ProfileIncome } from './profileExtrasApi';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (value: string) => void;
}

function AmountField({ id, label, placeholder, value, invalid, onChange }: FieldProps) {
  return (
    <div className="pf-f">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-e` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <small className="is-err" id={`${id}-e`}>
          <Icon name="warn" />
          Только число
        </small>
      ) : null}
    </div>
  );
}

interface DialogProps {
  readonly income: ProfileIncome;
  readonly onClose: () => void;
  readonly onSaved: (income: ProfileIncome) => void;
}

const text = (value: number | null) => (value === null ? '' : String(value));

/**
 * Поле окна, проверка и сохранение. Ожидания здесь не правятся — они в «Условиях поиска»
 * (B645 s01); сохранённое значение уходит без изменений.
 */
function useIncomeForm(income: ProfileIncome, onSaved: (income: ProfileIncome) => void) {
  const [current, setCurrent] = useState(text(income.current));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = incomeAmount(current);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (busy || amount === 'invalid') return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveIncome({ current: amount, expected: income.expected }));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить. Нажмите ещё раз.'));
      setBusy(false);
    }
  }

  const invalid = checked && amount === 'invalid';
  return { current, invalid, busy, error, setCurrent, submit };
}

function IncomeDialog({ income, onClose, onSaved }: DialogProps) {
  const form = useIncomeForm(income, onSaved);
  const { busy, error, submit } = form;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Доход сейчас"
      footer={
        <>
          <Button variant="quiet" icon="close" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="income-form" variant="primary" icon="check" busy={busy}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        id="income-form"
        className="pf-form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <AmountField
          id="inc-now"
          label="Доход сейчас, ₽ в месяц на руки"
          placeholder="Например: 440 000"
          value={form.current}
          invalid={form.invalid}
          onChange={form.setCurrent}
        />
        {error ? <StatusLine state="err" text={error} /> : null}
      </form>
    </Dialog>
  );
}

function Amount({ value }: { readonly value: number | null }) {
  const label = incomeLabel(value);
  return label ? (
    <span className="rec-text num">{label}</span>
  ) : (
    <span className="rec-text dim">Не указано</span>
  );
}

/**
 * Строка «Доход сейчас» у нынешнего места работы (B673). «Ожидания» — в «Условиях поиска»
 * (B645 s01), в карточке работы их нет.
 * Числа видит только кандидат; правка — в окне, результат сразу в строке.
 */
export function IncomeRows({ initial }: { readonly initial: ProfileIncome }) {
  const [income, setIncome] = useState(initial);
  const [open, setOpen] = useState(false);
  return (
    <>
      <dt>Доход сейчас</dt>
      <dd className="rec">
        <Amount value={income.current} />
        <span className="rec-meta">
          <span className="from">
            <Icon name="lock" />
            видно только вам
          </span>
          <button className="row-act" type="button" onClick={() => setOpen(true)}>
            Изменить
          </button>
        </span>
      </dd>
      {open ? (
        <IncomeDialog
          income={income}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setIncome(next);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
