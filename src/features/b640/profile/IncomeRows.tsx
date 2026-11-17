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

interface IncomeFieldsProps {
  readonly current: string;
  readonly expected: string;
  readonly invalid: { readonly current: boolean; readonly expected: boolean };
  readonly onCurrent: (value: string) => void;
  readonly onExpected: (value: string) => void;
}

function IncomeFields({ current, expected, invalid, onCurrent, onExpected }: IncomeFieldsProps) {
  return (
    <>
      <AmountField
        id="inc-now"
        label="Доход сейчас, ₽ в месяц на руки"
        placeholder="Например: 440 000"
        value={current}
        invalid={invalid.current}
        onChange={onCurrent}
      />
      <AmountField
        id="inc-want"
        label="Ожидания, ₽ в месяц на руки"
        placeholder="Например: 500 000"
        value={expected}
        invalid={invalid.expected}
        onChange={onExpected}
      />
    </>
  );
}

interface DialogProps {
  readonly income: ProfileIncome;
  readonly onClose: () => void;
  readonly onSaved: (income: ProfileIncome) => void;
}

const text = (value: number | null) => (value === null ? '' : String(value));

/** Поля окна, их проверка и сохранение. */
function useIncomeForm(income: ProfileIncome, onSaved: (income: ProfileIncome) => void) {
  const [current, setCurrent] = useState(text(income.current));
  const [expected, setExpected] = useState(text(income.expected));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amounts = { current: incomeAmount(current), expected: incomeAmount(expected) };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (busy || amounts.current === 'invalid' || amounts.expected === 'invalid') return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await saveIncome({ current: amounts.current, expected: amounts.expected }));
    } catch (reason) {
      setError(apiErrorMessage(reason, 'Не удалось сохранить. Нажмите ещё раз.'));
      setBusy(false);
    }
  }

  const invalid = {
    current: checked && amounts.current === 'invalid',
    expected: checked && amounts.expected === 'invalid',
  };
  return { current, expected, invalid, busy, error, setCurrent, setExpected, submit };
}

function IncomeDialog({ income, onClose, onSaved }: DialogProps) {
  const form = useIncomeForm(income, onSaved);
  const { busy, error, submit } = form;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Доход и ожидания"
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
        <IncomeFields
          current={form.current}
          expected={form.expected}
          invalid={form.invalid}
          onCurrent={form.setCurrent}
          onExpected={form.setExpected}
        />
        {error ? <StatusLine state="err" text={error} /> : null}
      </form>
    </Dialog>
  );
}

function Amount({
  value,
  prefix = '',
}: {
  readonly value: number | null;
  readonly prefix?: string;
}) {
  const label = incomeLabel(value);
  return label ? (
    <span className="rec-text num">{`${prefix}${label}`}</span>
  ) : (
    <span className="rec-text dim">Не указано</span>
  );
}

/**
 * Строки «Доход сейчас» и «Ожидания» у нынешнего места работы (B673).
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
      <dt>Ожидания</dt>
      <dd className="rec">
        <Amount value={income.expected} prefix="от " />
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
