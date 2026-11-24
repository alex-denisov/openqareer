import { useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../../coach/apiClient';
import type { HhForm } from '../../../../../shared/hhCandidateSession';
import { runHhApplyInSession, type HhDesktopReport } from './hhDesktop';
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
  /** Название с экрана отклика: сервер сверяет его с вакансией hh.ru. */
  readonly vacancyTitle?: string;
  readonly letter: string;
  /** Заголовок выбранного резюме, если он у кандидата один. */
  readonly uniqueResumeTitle?: string;
  /** Отклик ушёл (в том числе с анкетой): отклик отмечается отправленным. */
  readonly onSent: () => Promise<void>;
  /** B641: анкета из окна hh.ru; `open` — отклик без неё не ушёл, нужен шаг «Анкета». */
  readonly onForm: (form: HhForm, open: boolean) => Promise<void>;
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
    ({ attemptId } = await startHhApply(input.vacancyId, resumeId, input.vacancyTitle));
  } catch (reason: unknown) {
    return { kind: 'error', text: refusalText(reason instanceof CoachApiError ? reason.code : undefined) };
  }
  // Отказ сервера прежнее чтение окна не обрывает; новая попытка уводит окно на свою вакансию.
  stopHhWindowWatch();
  const report: HhDesktopReport = await runHhApplyInSession({
    vacancyId: input.vacancyId,
    resumeId,
    letter: input.letter,
    uniqueResumeTitle: input.uniqueResumeTitle,
  }).catch(
    (reason: unknown) => ({ outcome: 'failed' as const, failureCode: desktopFailureCode(reason) }),
  );
  await finishHhApply(attemptId, report.outcome, report.failureCode ?? undefined).catch(() => undefined);
  const result = resultOf(report.outcome, report.failureCode, report.questionnaire);
  if (result.kind === 'sent' || result.kind === 'questionnaire') await input.onSent().catch(() => undefined);
  else {
    void watchHhWindow({
      attemptId,
      vacancyId: input.vacancyId,
      failureCode: report.failureCode,
      onSent: input.onSent,
    }).then((late) => late && onLateSent());
  }
  if (report.questionnaire) await input.onForm(report.questionnaire, result.kind === 'form').catch(() => undefined);
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
  // Двойное нажатие до перерисовки видит прежнее состояние: попытка всё равно одна.
  const inFlight = useRef(false);
  const shownVacancy = useRef(input.vacancyId);
  useEffect(() => {
    shownVacancy.current = input.vacancyId;
  }, [input.vacancyId]);

  return {
    state,
    ask: () => setState({ kind: 'confirm' }),
    cancel: () => setState({ kind: 'idle' }),
    confirm: () => {
      if (state.kind !== 'confirm' || !input.resumeId || inFlight.current) return;
      inFlight.current = true;
      setState({ kind: 'sending', seconds: 0 });
      const onLateSent = () => {
        if (shownVacancy.current === input.vacancyId) setState({ kind: 'sent' });
      };
      // Отклик из окна мог отметиться раньше, чем сервер отказал в повторе: «отправлен» не затираем.
      void sendOnce(input, input.resumeId, onLateSent)
        .then((result) => setState((shown) => (shown.kind === 'sent' ? shown : result)))
        .finally(() => {
          inFlight.current = false;
        });
    },
  };
}
