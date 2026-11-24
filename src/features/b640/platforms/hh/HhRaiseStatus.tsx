import { useCallback, useEffect, useState } from 'react';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { openHhSignIn } from '../../apply/hh/hhDesktop';
import { Button, StatusLine } from '../../kit';
import { getHhRaise, retryHhRaise, setHhRaiseEnabled } from './hhRaiseApi';
import { lineOf } from './hhRaiseText';

const SWITCH_ID = 'hh-up';
const RESUME_ID = 'hh-cv';

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

interface RaiseResumeProps {
  readonly resumes: B640HhRaiseState['resumes'];
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onChange: (resumeId: string) => void;
}

/** Поле макета a11 `.hh-cv`: резюме, которое поднимается. */
function RaiseResume({ resumes, value, disabled, onChange }: RaiseResumeProps) {
  return (
    <div className="pf-f hh-cv">
      <label htmlFor={RESUME_ID}>Резюме</label>
      <select
        id={RESUME_ID}
        value={value ?? undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {resumes.map((resume) => (
          <option key={resume.id} value={resume.id}>
            {resume.updatedLabel ? `${resume.title} · ${resume.updatedLabel}` : resume.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function useHhRaise() {
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
  return { view, failed, busy, change };
}

/**
 * B699: переключатель «Автоподнятие резюме» по макету a11 (`.hh-sw`) и тихая строка состояния
 * под ним. Монтируется в шапке экрана hh.ru (a11), когда hh.ru подключён.
 */
export function HhRaiseStatus() {
  const { view, failed, busy, change } = useHhRaise();
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
      <RaiseResume
        resumes={view.resumes}
        value={view.resumeId}
        disabled={busy}
        onChange={(resumeId) => void change(() => setHhRaiseEnabled(view.enabled, resumeId))}
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
