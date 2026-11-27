import { useEffect, useRef } from 'react';
import { sendAtsCode, showAtsForm } from './atsDesktop';
import type { AtsReceipt } from './atsFormTypes';
import { settleLater, windowOutcome, type AtsApplyState, type AtsCodeError } from './atsSession';

const POLL_MS = 3000;

type Waiting = Extract<AtsApplyState, { readonly live: boolean }>;

export const isLive = (state: AtsApplyState): state is Waiting => 'live' in state && state.live;

export interface AtsWindow {
  readonly showForm: () => void;
  readonly sendCode: (code: string) => void;
}

interface WindowInput {
  readonly vacancyId: string;
  readonly state: AtsApplyState;
  readonly setState: (update: (now: AtsApplyState) => AtsApplyState) => void;
  readonly onConfirmed: (receipt: AtsReceipt) => void;
}

const follow =
  (seen: AtsReceipt | null) =>
  (now: AtsApplyState): AtsApplyState => {
    if (!isLive(now)) return now;
    if (!seen) return { kind: 'unconfirmed', host: now.host, live: false };
    if (seen.outcome === now.kind || (seen.outcome !== 'code' && seen.outcome !== 'captcha'))
      return now;
    return { kind: seen.outcome, host: now.host, live: true };
  };

const codeFailed =
  (error: AtsCodeError) =>
  (now: AtsApplyState): AtsApplyState =>
    now.kind === 'code' ? { ...now, sending: false, error } : now;

/** Отказы команды до нажатия кнопки формы: код можно отправить ещё раз. */
const BEFORE_PRESS: ReadonlySet<string> = new Set([
  'code_invalid',
  'code_busy',
  'attempt_unrecorded',
]);

/** Итог введённого кода; без ответа доски — «не подтверждён», повтора сам по себе нет. */
function afterCode(seen: AtsReceipt): (now: AtsApplyState) => AtsApplyState {
  if (seen.outcome === 'code') return codeFailed('wrong');
  if (seen.outcome === 'not_submitted') return codeFailed('failed');
  return (now) =>
    now.kind === 'code'
      ? {
          kind: seen.outcome === 'captcha' ? 'captcha' : 'unconfirmed',
          host: now.host,
          live: seen.reason !== 'code_expired',
        }
      : now;
}

async function confirm(
  vacancyId: string,
  seen: AtsReceipt,
  onConfirmed: WindowInput['onConfirmed'],
): Promise<void> {
  await settleLater(vacancyId).catch(() => undefined);
  onConfirmed({ ...seen, pressedAtMs: seen.pressedAtMs ?? Date.now() });
}

/** Код из поля кандидата уходит в форму один раз на нажатие. */
function useCode({ vacancyId, setState, onConfirmed }: WindowInput): (code: string) => void {
  const inFlight = useRef(false);
  const run = async (code: string) => {
    setState((now) =>
      now.kind === 'code' ? { kind: 'code', host: now.host, live: true, sending: true } : now,
    );
    try {
      const seen = await sendAtsCode(vacancyId, code);
      if (!seen) return setState(codeFailed('failed'));
      if (seen.outcome === 'confirmed') return await confirm(vacancyId, seen, onConfirmed);
      setState(afterCode(seen));
      if (seen.outcome === 'unconfirmed') await settleLater(vacancyId).catch(() => undefined);
    } catch (reason) {
      if (typeof reason === 'string' && BEFORE_PRESS.has(reason))
        return setState(codeFailed('failed'));
      const now = await windowOutcome(vacancyId);
      if (now?.outcome === 'confirmed') return confirm(vacancyId, now, onConfirmed);
      setState((state) =>
        isLive(state) ? { kind: 'unconfirmed', host: state.host, live: now !== null } : state,
      );
    }
    return undefined;
  };
  return (code) => {
    if (inFlight.current) return;
    inFlight.current = true;
    void run(code).finally(() => {
      inFlight.current = false;
    });
  };
}

/** Пока окно формы ждёт кандидата, его итог перечитывается; сама форма не трогается. */
export function useAtsWindow(input: WindowInput): AtsWindow {
  const { vacancyId, state, setState, onConfirmed } = input;
  const sendCode = useCode(input);
  // Пока уходит код, итог приносит сама отправка.
  const live = isLive(state) && !(state.kind === 'code' && state.sending);
  useEffect(() => {
    if (!live) return undefined;
    let stopped = false;
    let timer = 0;
    const look = async () => {
      const seen = await windowOutcome(vacancyId);
      if (stopped) return;
      if (seen?.outcome === 'confirmed') {
        return confirm(vacancyId, seen, (shown) => {
          if (!stopped) onConfirmed(shown);
        });
      }
      setState(follow(seen));
      timer = window.setTimeout(() => void look(), POLL_MS);
      return undefined;
    };
    timer = window.setTimeout(() => void look(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // Итог читается заново только при другом окне, а не на каждой отрисовке.
  }, [live, vacancyId]);

  const showForm = () => {
    void showAtsForm(vacancyId)
      .catch(() => false)
      .then((shown) => {
        if (!shown) setState(follow(null));
      });
  };
  return { showForm, sendCode };
}
