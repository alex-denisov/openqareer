import { useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { Icon } from '../kit/Icon';
import { ErrorLine, useLoad, type Load } from './parts';
import {
  listPasskeys,
  registerPasskey,
  requestPasskeyOptions,
  type PasskeySummary,
} from './passkeyApi';
import { CodeField, failureText } from './TwoFactorParts';

export interface PasskeyState {
  readonly load: Load<readonly PasskeySummary[]>;
  readonly adding: boolean;
  readonly setAdding: (adding: boolean) => void;
}

export function usePasskeys(): PasskeyState {
  const load = useLoad(listPasskeys);
  const [adding, setAdding] = useState(false);
  return { load, adding, setAdding };
}

const PLATFORM_WORDS: Readonly<Record<string, string>> = {
  MacBook: 'Mac',
  iPhone: 'iPhone',
  iPad: 'iPad',
};

/**
 * «включено на этом Mac», если у этого устройства (по названию, как в «Устройствах») есть ключ;
 * иначе «выключено»: ключи других устройств здесь не помогают войти.
 */
export function passkeyStatus(
  keys: readonly PasskeySummary[],
  currentLabel: string | null,
): string {
  if (!currentLabel || !keys.some((key) => key.deviceLabel === currentLabel)) return 'выключено';
  const word = PLATFORM_WORDS[currentLabel.split(' · ')[0] ?? ''];
  return `включено на этом ${word ?? 'устройстве'}`;
}

/** Отмена в системном окне (`NotAllowedError`, `AbortError`) — не ошибка: ничего не меняется и ничего не пишется. */
export function isCancelled(reason: unknown): boolean {
  return (
    reason instanceof Error && (reason.name === 'NotAllowedError' || reason.name === 'AbortError')
  );
}

function addFailure(reason: unknown): string {
  if (reason instanceof Error && reason.name === 'InvalidStateError')
    return 'Это устройство уже добавлено.';
  return failureText(reason, 'Не удалось добавить устройство');
}

/** Строка «Вход» (n04): состояние ключа на этом устройстве и «Добавить устройство». */
export function PasskeyRow({
  state,
  currentLabel,
}: {
  readonly state: PasskeyState;
  readonly currentLabel: string | null;
}) {
  const { load, adding, setAdding } = state;
  if (load.state !== 'ready' || !browserSupportsWebAuthn()) return null;
  return (
    <li className="set-row">
      <div className="set-l">
        <span className="set-t">Вход по Touch ID / Face ID</span>
        <span className="set-v">{passkeyStatus(load.data, currentLabel)}</span>
      </div>
      {adding ? null : (
        <div className="set-r">
          <button className="btn is-sm" type="button" onClick={() => setAdding(true)}>
            Добавить устройство
          </button>
        </div>
      )}
    </li>
  );
}

interface FormProps {
  readonly state: PasskeyState;
  readonly needsCode: boolean;
}

/** Подтверждение → параметры → системное окно → сохранение; отмена в окне ничего не пишет. */
function useAddPasskey({ state, needsCode }: FormProps) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length > 0 && (!needsCode || code.trim().length > 0) && !busy;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { options, token } = await requestPasskeyOptions({ password, code });
      await registerPasskey(token, await startRegistration({ optionsJSON: options }));
      state.setAdding(false);
      state.load.retry();
    } catch (reason) {
      if (!isCancelled(reason)) setError(addFailure(reason));
    } finally {
      setBusy(false);
    }
  }
  return { password, setPassword, code, setCode, busy, error, ready, submit };
}

/** Подтверждение паролем (и кодом при 2FA), затем системное окно Touch ID / Face ID. */
export function PasskeyForm(props: FormProps) {
  return props.state.adding ? <AddForm {...props} /> : null;
}

function AddForm(props: FormProps) {
  const form = useAddPasskey(props);
  return (
    <li className="set-row is-block is-next">
      <form className="c5-form" onSubmit={(event) => void form.submit(event)}>
        <div className="fa-fields">
          <CodeField
            label="Текущий пароль"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={form.setPassword}
          />
          {props.needsCode ? (
            <CodeField
              label="Код из приложения-аутентификатора"
              numeric
              value={form.code}
              onChange={form.setCode}
            />
          ) : null}
        </div>
        {form.error ? <ErrorLine text={form.error} /> : null}
        <div className="actions fa-act">
          <div className="actions m-commit">
            <button
              className="btn is-primary"
              type="submit"
              disabled={!form.ready}
              aria-busy={form.busy || undefined}
            >
              <Icon name="check" />
              Добавить
            </button>
          </div>
          <button className="row-act" type="button" onClick={() => props.state.setAdding(false)}>
            Отмена
          </button>
        </div>
      </form>
    </li>
  );
}
