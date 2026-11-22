import { useId, useState, type FormEvent } from 'react';
import { CoachApiError } from '../../coach/apiClient';
import { triggerFileDownload } from '../../resume/resumeExport';
import { Icon } from '../kit/Icon';
import { ResultLine } from '../kit/ResultLine';
import { ErrorLine } from './parts';
import { enableTwoFactor, type TwoFactorSetup } from './twoFactorApi';
import { TwoFactorQr } from './TwoFactorQr';

export function failureText(error: unknown, fallback: string): string {
  return error instanceof CoachApiError ? error.message : fallback;
}

interface CodeFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'password';
  readonly autoComplete?: string;
  /** Только код из приложения (шесть цифр); резервные коды с буквами и дефисом. */
  readonly numeric?: boolean;
}

/** `div.cn-f`: подпись и поле, без пояснений под ним. */
export function CodeField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete = 'one-time-code',
  numeric = false,
}: CodeFieldProps) {
  const id = useId();
  return (
    <div className="cn-f is-wide">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={numeric ? 'numeric' : undefined}
        autoCapitalize="off"
        spellCheck={false}
        maxLength={type === 'text' ? 11 : 256}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Ключ группами по четыре — так его проще перепечатать в приложение. */
export function groupedKey(secret: string): string {
  return secret.replace(/(.{4})/gu, '$1 ').trim();
}

const GROUPS_PER_LINE = 4;

/** Ключ строками по четыре группы: 32 символа в одну строку не влезали на 390 (B645, 22.11). */
export function keyLines(secret: string): string[] {
  const groups = groupedKey(secret).split(' ');
  const lines: string[] = [];
  for (let start = 0; start < groups.length; start += GROUPS_PER_LINE) {
    lines.push(groups.slice(start, start + GROUPS_PER_LINE).join(' '));
  }
  return lines;
}

/** Ключ для ввода вручную, сгруппированный по четыре, с копированием. */
function ManualKey({ secret }: { readonly secret: string }) {
  const keyId = useId();
  const [copied, setCopied] = useState(false);
  async function copyKey() {
    await navigator.clipboard?.writeText(secret).then(
      () => setCopied(true),
      () => undefined,
    );
  }
  return (
    <div className="cn-f">
      <span className="fa-l" id={keyId}>
        Ключ для ввода вручную
      </span>
      <div className="fa-key">
        <code aria-labelledby={keyId}>
          {keyLines(secret).map((line) => (
            <span className="fa-key-line" key={line}>
              {line}
            </span>
          ))}
        </code>
        <button
          className="icon-btn"
          type="button"
          aria-label="Скопировать ключ"
          onClick={() => void copyKey()}
        >
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
      </div>
    </div>
  );
}

interface SetupFieldsProps {
  readonly setup: TwoFactorSetup;
  readonly code: string;
  readonly password: string;
  readonly onCode: (value: string) => void;
  readonly onPassword: (value: string) => void;
}

function SetupFields({ setup, code, password, onCode, onPassword }: SetupFieldsProps) {
  return (
    <div className="fa-setup">
      <TwoFactorQr value={setup.otpauthUrl} />
      <div className="fa-fields">
        <ManualKey secret={setup.secret} />
        <CodeField
          label="Код из приложения-аутентификатора"
          numeric
          value={code}
          onChange={onCode}
        />
        <CodeField
          label="Текущий пароль"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={onPassword}
        />
      </div>
    </div>
  );
}

/** Два ряда действий: на 390 «Готово» уходит под копирование и скачивание, верх кнопок в ряду общий. */
function BackupActions({
  text,
  onCopied,
  onDone,
}: {
  readonly text: string;
  readonly onCopied: () => void;
  readonly onDone: () => void;
}) {
  return (
    <div className="fa-bar">
      <div className="actions">
        <button
          className="btn is-primary"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(text).then(onCopied, () => undefined)}
        >
          <Icon name="copy" />
          Скопировать коды
        </button>
        <button
          className="row-act"
          type="button"
          onClick={() =>
            void triggerFileDownload('openqareer-reserve-codes.txt', `${text}\n`, 'text/plain')
          }
        >
          <Icon name="download" />
          Скачать
        </button>
      </div>
      <div className="actions">
        <button className="row-act" type="button" onClick={onDone}>
          Готово
        </button>
      </div>
    </div>
  );
}

interface SetupFormProps {
  readonly setup: TwoFactorSetup;
  readonly onEnabled: (codes: readonly string[]) => void;
  readonly onCancel: () => void;
}

/** n04d: QR, ключ для ввода вручную, код из приложения и текущий пароль. */
export function SetupForm({ setup, onEnabled, onCancel }: SetupFormProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !code.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      onEnabled(await enableTwoFactor(code, password));
    } catch (reason) {
      setError(failureText(reason, 'Защита не включилась'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="set-row is-block is-next">
      <form className="c5-form" onSubmit={(event) => void submit(event)}>
        <SetupFields
          setup={setup}
          code={code}
          password={password}
          onCode={setCode}
          onPassword={setPassword}
        />
        {error ? <ErrorLine text={error} /> : null}
        <div className="actions m-commit">
          <button
            className="btn is-primary"
            type="submit"
            disabled={busy || !code.trim() || !password}
            aria-busy={busy || undefined}
          >
            <Icon name="check" />
            Включить
          </button>
          <button className="row-act" type="button" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </form>
    </li>
  );
}

/** n04e: восемь резервных кодов показаны один раз; «Готово» убирает их с экрана и из памяти. */
export function BackupCodes({
  codes,
  onDone,
}: {
  readonly codes: readonly string[];
  readonly onDone: () => void;
}) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  return (
    <li className="set-row is-block is-next">
      <div className="c5-form fa-done">
        <p className="set-t" id={titleId}>
          Резервные коды · {codes.length}
        </p>
        <ul className="fa-codes" aria-labelledby={titleId}>
          {codes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        {copied ? <ResultLine text="Коды скопированы" /> : null}
        <BackupActions text={text} onCopied={() => setCopied(true)} onDone={onDone} />
      </div>
    </li>
  );
}
