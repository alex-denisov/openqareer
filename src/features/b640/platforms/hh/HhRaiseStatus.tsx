import { useCallback, useEffect, useState } from 'react';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { openHhSignIn } from '../../apply/hh/hhDesktop';
import { Button, StatusLine } from '../../kit';
import { getHhRaise, retryHhRaise, setHhRaiseEnabled } from './hhRaiseApi';
import { lineOf } from './hhRaiseText';

const SWITCH_ID = 'hh-up';

interface RaiseSwitchProps {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (enabled: boolean) => void;
}

/** Строка макета a11 `.hh-sw`: подпись слева, переключатель справа. */
function RaiseSwitch({ checked, disabled, onChange }: RaiseSwitchProps) {
  return (
    <div className="hh-sw">
      <label htmlFor={SWITCH_ID}>Автоподнятие резюме</label>
      <input
        className="sw"
        id={SWITCH_ID}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </div>
  );
}

/**
 * B699: переключатель «Автоподнятие резюме» по макету a11 (`.hh-sw`) и тихая строка состояния
 * под ним. Монтируется в шапке экрана hh.ru (a11), когда hh.ru подключён.
 */
export function HhRaiseStatus() {
  const [view, setView] = useState<B640HhRaiseState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getHhRaise(controller.signal).then(setView, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  const change = useCallback(async (run: () => Promise<B640HhRaiseState>) => {
    setBusy(true);
    try {
      setView(await run());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  if (failed && !view) return <StatusLine state="err" text="Состояние поднятия не загрузилось" />;
  if (!view) return <StatusLine state="wait" text="Загружаем состояние поднятия" />;
  if (!view.connected) return null;
  const line = lineOf(view);
  const retry = <Button size="sm" busy={busy} onClick={() => change(() => retryHhRaise(view.resumeId ?? undefined))}>Повторить</Button>;
  const signIn = <Button size="sm" onClick={() => void openHhSignIn()}>Войти</Button>;
  return (
    <>
      <RaiseSwitch
        checked={view.enabled}
        disabled={busy}
        onChange={(enabled) => void change(() => setHhRaiseEnabled(enabled, view.resumeId ?? undefined))}
      />
      {line.state === 'off' ? null : (
        <StatusLine
          state={line.state}
          text={line.text}
          action={line.action === 'retry' ? retry : line.action === 'sign_in' ? signIn : undefined}
        />
      )}
      {failed ? <StatusLine state="err" text="Не получилось, попробуйте ещё раз" /> : null}
    </>
  );
}
