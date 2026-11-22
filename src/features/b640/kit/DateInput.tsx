import { useEffect, useRef, useState } from 'react';
import { formatDateTyping, isoToRuDate, readRuDate } from './dateText';

export interface DateInputProps {
  readonly id: string;
  /** ISO-день «гггг-мм-дд» или `''`. */
  readonly value: string;
  /** Получает ISO-день; `''` — поле пустое или дата не читается. */
  readonly onChange: (iso: string) => void;
  readonly className?: string;
  readonly required?: boolean;
  /** ISO-день, позже которого дата не принимается. */
  readonly max?: string;
  /** Ошибка формы (например, «Укажите день выхода»); ошибка формата важнее. */
  readonly error?: string;
}

/** Набранный текст, отданное наружу ISO-значение и ошибка формата после ухода с поля. */
function useDateText(value: string, onChange: (iso: string) => void, max?: string) {
  const [text, setText] = useState(() => isoToRuDate(value));
  const [touched, setTouched] = useState(false);
  const emitted = useRef(value);
  // Значение, поставленное снаружи (подстановка, сброс формы), заменяет набранный текст.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setText(isoToRuDate(value));
  }, [value]);
  function change(raw: string) {
    const next = formatDateTyping(raw);
    setText(next);
    const iso = readRuDate(next, max).iso;
    if (iso === emitted.current) return;
    emitted.current = iso;
    onChange(iso);
  }
  const formatError = touched ? readRuDate(text, max).error : undefined;
  return { text, change, formatError, touch: () => setTouched(true) };
}

/**
 * B733: дата «дд.мм.гггг» независимо от региона системы. Нативное поле даты в .app
 * с английским регионом показывало «мм/дд/гггг»; значение для API остаётся ISO.
 */
export function DateInput({
  id,
  value,
  onChange,
  className,
  required,
  max,
  error,
}: DateInputProps) {
  const { text, change, formatError, touch } = useDateText(value, onChange, max);
  const shown = formatError ?? error;
  const errorId = `${id}-err`;
  return (
    <>
      <input
        id={id}
        className={className}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="дд.мм.гггг"
        maxLength={10}
        value={text}
        required={required}
        aria-invalid={shown ? true : undefined}
        aria-describedby={shown ? errorId : undefined}
        onChange={(event) => change(event.currentTarget.value)}
        onBlur={touch}
      />
      {shown ? (
        <p className="va-err" id={errorId} role="alert">
          {shown}
        </p>
      ) : null}
    </>
  );
}
