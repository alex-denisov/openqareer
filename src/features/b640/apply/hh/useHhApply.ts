import { useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../../coach/apiClient';
import { runHhApplyInSession } from './hhDesktop';
import { desktopFailureCode, refusalText, resultOf, type HhSendResult } from './hhSendModel';
import { finishHhApply, startHhApply } from './hhSessionApi';

export type HhApplyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm' }
  | { readonly kind: 'sending'; readonly seconds: number }
  | HhSendResult;

export interface HhApplyInput {
  readonly vacancyId: string;
  readonly resumeId: string | null;
  readonly letter: string;
  /** Отклик ушёл (в том числе с анкетой): отклик отмечается отправленным. */
  readonly onSent: () => Promise<void>;
}

export interface HhApplyControls {
  readonly state: HhApplyState;
  readonly ask: () => void;
  readonly cancel: () => void;
  /** Только из окна подтверждения: отклик уходит после «Отправить». */
  readonly confirm: () => void;
}

/** Секунды ожидания ответа hh.ru: макет a01d показывает их рядом со строкой. */
function useSendingClock(sending: boolean, tick: (seconds: number) => void): void {
  const started = useRef(0);
  useEffect(() => {
    if (!sending) return undefined;
    started.current = Date.now();
    const timer = window.setInterval(() => tick(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [sending, tick]);
}

async function sendOnce(input: HhApplyInput, resumeId: string): Promise<HhSendResult> {
  let attemptId: string;
  try {
    ({ attemptId } = await startHhApply(input.vacancyId, resumeId));
  } catch (reason: unknown) {
    return { kind: 'error', text: refusalText(reason instanceof CoachApiError ? reason.code : undefined) };
  }
  const report = await runHhApplyInSession({ vacancyId: input.vacancyId, resumeId, letter: input.letter }).catch(
    (reason: unknown) => ({ outcome: 'failed' as const, failureCode: desktopFailureCode(reason) }),
  );
  await finishHhApply(attemptId, report.outcome, report.failureCode ?? undefined).catch(() => undefined);
  const result = resultOf(report.outcome, report.failureCode);
  if (result.kind === 'sent' || result.kind === 'questionnaire') await input.onSent().catch(() => undefined);
  return result;
}

/** Отклик через hh.ru от имени кандидата: подтверждение → отклик в его окне hh.ru → исход на месте. */
export function useHhApply(input: HhApplyInput): HhApplyControls {
  const [state, setState] = useState<HhApplyState>({ kind: 'idle' });
  const sending = state.kind === 'sending';
  const tickRef = useRef((seconds: number) =>
    setState((current) => (current.kind === 'sending' ? { kind: 'sending', seconds } : current)),
  );
  useSendingClock(sending, tickRef.current);

  return {
    state,
    ask: () => setState({ kind: 'confirm' }),
    cancel: () => setState({ kind: 'idle' }),
    confirm: () => {
      if (state.kind !== 'confirm' || !input.resumeId) return;
      setState({ kind: 'sending', seconds: 0 });
      void sendOnce(input, input.resumeId).then(setState);
    },
  };
}
