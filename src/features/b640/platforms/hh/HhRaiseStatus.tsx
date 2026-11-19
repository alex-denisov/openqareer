import { useCallback, useEffect, useState } from 'react';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { openHhSignIn } from '../../apply/hh/hhDesktop';
import { Button, StatusLine, Switch } from '../../kit';
import { getHhRaise, retryHhRaise, setHhRaiseEnabled } from './hhRaiseApi';
import { lineOf } from './hhRaiseText';

const TITLE_ID = 'hh-raise-title';

/**
 * B699: состояние автоподнятия резюме hh.ru и переключатель. Монтируется на экране
 * платформы hh.ru (раздел «Платформы»); пока там заглушка, подключается при его сборке.
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
    <div>
      <div className="set-row">
        <span className="set-t" id={TITLE_ID}>Поднимать резюме в поиске hh.ru</span>
        <Switch
          labelledBy={TITLE_ID}
          checked={view.enabled}
          disabled={busy}
          onChange={(enabled) => void change(() => setHhRaiseEnabled(enabled, view.resumeId ?? undefined))}
        />
      </div>
      {line.state === 'off' ? null : (
        <StatusLine
          state={line.state}
          text={line.text}
          action={line.action === 'retry' ? retry : line.action === 'sign_in' ? signIn : undefined}
        />
      )}
      {failed ? <StatusLine state="err" text="Не получилось, попробуйте ещё раз" /> : null}
    </div>
  );
}
