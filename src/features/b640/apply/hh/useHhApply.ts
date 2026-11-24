import { useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../../coach/apiClient';
import { runHhApplyInSession } from './hhDesktop';
import { desktopFailureCode, refusalText, resultOf, type HhSendResult } from './hhSendModel';
import { finishHhApply, startHhApply } from './hhSessionApi';
import { stopHhWindowWatch, watchHhWindow } from './hhWindowWatch';

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

async function sendOnce(input: HhApplyInput, resumeId: string, onLateSent: () => void): Promise<HhSendResult> {
  let attemptId: string;
  try {
    ({ attemptId } = await startHhApply(input.vacancyId, resumeId));
  } catch (reason: unknown) {
    return { kind: 'error', text: refusalText(reason instanceof CoachApiError ? reason.code : undefined) };
  }
  // Отказ сервера прежнее чтение окна не обрывает; новая попытка уводит окно на свою вакансию.
  stopHhWindowWatch();
  const report = await runHhApplyInSession({ vacancyId: input.vacancyId, resumeId, letter: input.letter }).catch(
    (reason: unknown) => ({ outcome: 'failed' as const, failureCode: desktopFailureCode(reason) }),
  );
  await finishHhApply(attemptId, report.outcome, report.failureCode ?? undefined).catch(() => undefined);
  const result = resultOf(report.outcome, report.failureCode);
  if (result.kind === 'sent' || result.kind === 'questionnaire') await input.onSent().catch(() => undefined);
  else {
    void watchHhWindow({
      attemptId,
      vacancyId: input.vacancyId,
      failureCode: report.failureCode,
      onSent: input.onSent,
    }).then((late) => late && onLateSent());
  }
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
  const shownVacancy = useRef(input.vacancyId);
  useEffect(() => {
    shownVacancy.current = input.vacancyId;
  }, [input.vacancyId]);

  return {
    state,
    ask: () => setState({ kind: 'confirm' }),
    cancel: () => setState({ kind: 'idle' }),
    confirm: () => {
      if (state.kind !== 'confirm' || !input.resumeId) return;
      setState({ kind: 'sending', seconds: 0 });
      const onLateSent = () => {
        if (shownVacancy.current === input.vacancyId) setState({ kind: 'sent' });
      };
      // Отклик из окна мог отметиться раньше, чем сервер отказал в повторе: «отправлен» не затираем.
      void sendOnce(input, input.resumeId, onLateSent).then((result) =>
        setState((shown) => (shown.kind === 'sent' ? shown : result)),
      );
    },
  };
}
