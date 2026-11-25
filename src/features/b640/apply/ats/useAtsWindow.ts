import { useEffect } from 'react';
import { showAtsForm } from './atsDesktop';
import type { AtsReceipt } from './atsFormTypes';
import { settleLater, windowOutcome, type AtsApplyState } from './atsSession';

const POLL_MS = 3000;

type Waiting = Extract<AtsApplyState, { readonly live: boolean }>;

export const isLive = (state: AtsApplyState): state is Waiting => 'live' in state && state.live;

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
    if (!seen) return { ...now, kind: 'unconfirmed', live: false };
    if (seen.outcome === now.kind || (seen.outcome !== 'code' && seen.outcome !== 'captcha'))
      return now;
    return { ...now, kind: seen.outcome };
  };

/** Пока окно формы ждёт кандидата, его итог перечитывается; сама форма не трогается. */
export function useAtsWindow({ vacancyId, state, setState, onConfirmed }: WindowInput) {
  const live = isLive(state);
  useEffect(() => {
    if (!live) return undefined;
    let stopped = false;
    let timer = 0;
    const look = async () => {
      const seen = await windowOutcome(vacancyId);
      if (stopped) return;
      if (seen?.outcome === 'confirmed') {
        await settleLater(vacancyId).catch(() => undefined);
        if (!stopped) onConfirmed({ ...seen, pressedAtMs: seen.pressedAtMs ?? Date.now() });
        return;
      }
      setState(follow(seen));
      timer = window.setTimeout(() => void look(), POLL_MS);
    };
    timer = window.setTimeout(() => void look(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // Итог читается заново только при другом окне, а не на каждой отрисовке.
  }, [live, vacancyId]);

  return () => {
    void showAtsForm(vacancyId)
      .catch(() => false)
      .then((shown) => {
        if (!shown) setState(follow(null));
      });
  };
}
