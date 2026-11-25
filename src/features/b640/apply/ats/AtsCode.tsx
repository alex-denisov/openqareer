import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Button, Icon } from '../../kit';
import type { AtsCodeError } from './atsSession';

const CODE_CHARS = 8;
const ERRORS: Readonly<Record<AtsCodeError, string>> = {
  wrong: 'Неверный код',
  failed: 'Код не отправлен. Повторите.',
};

interface AtsCodeProps {
  readonly sending: boolean;
  readonly error: AtsCodeError | undefined;
  readonly onSend: (code: string) => void;
  /** Остальные действия шага. */
  readonly children: ReactNode;
}

interface CodeFieldProps {
  readonly field: RefObject<HTMLInputElement>;
  readonly value: string;
  readonly readOnly: boolean;
  readonly error: AtsCodeError | undefined;
  readonly onChange: (value: string) => void;
}

const codeOf = (text: string): string => text.replace(/[^a-z0-9]/giu, '').slice(0, CODE_CHARS);

function CodeField({ field, value, readOnly, error, onChange }: CodeFieldProps) {
  const id = useId();
  return (
    <div className="field ap-code">
      <label htmlFor={id}>Код</label>
      <input
        ref={field}
        id={id}
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        value={value}
        readOnly={readOnly}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined}
        onChange={(event) => onChange(codeOf(event.target.value))}
      />
      {error ? (
        <small className="is-err" id={`${id}-e`} role="alert">
          <Icon name="warn" />
          {ERRORS[error]}
        </small>
      ) : null}
    </div>
  );
}

/** Код из письма: кандидат вводит его сам; регистр букв важен. */
export function AtsCode({ sending, error, onSend, children }: AtsCodeProps) {
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [edited, setEdited] = useState(false);
  const shown = edited || sending ? undefined : error;
  useEffect(() => {
    if (!sending) input.current?.focus();
  }, [sending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending || code.length !== CODE_CHARS) return;
    setEdited(false);
    onSend(code);
  };
  return (
    <form className="ap-code-form" noValidate autoComplete="off" onSubmit={submit}>
      <CodeField
        field={input}
        value={code}
        readOnly={sending}
        error={shown}
        onChange={(next) => {
          setCode(next);
          setEdited(true);
        }}
      />
      <div className="actions">
        <Button
          variant="primary"
          icon="send"
          type="submit"
          busy={sending}
          disabled={code.length !== CODE_CHARS}
        >
          Отправить отклик
        </Button>
        {children}
      </div>
    </form>
  );
}
