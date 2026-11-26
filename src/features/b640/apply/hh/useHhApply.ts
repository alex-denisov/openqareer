import { useEffect, useRef, useState } from 'react';
import { CoachApiError } from '../../../coach/apiClient';
import type { HhForm, HhFormAnswer } from '../../../../../shared/hhCandidateSession';
import { runHhApplyInSession, type HhDesktopReport } from './hhDesktop';
import { desktopFailureCode, refusalOf, resultOf, type HhSendQuestion, type HhSendResult } from './hhSendModel';
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
  /** Карточка платформы, с которой уходит отклик. */
  readonly cardId: string;
  /** Название с экрана отклика: сервер сверяет его с вакансией hh.ru. */
  readonly vacancyTitle?: string;
  readonly letter: string;
  /** Заголовок выбранного резюме, если он у кандидата один. */
  readonly uniqueResumeTitle?: string;
  /** Ответы анкеты, если её вопросы прочитаны. */
  readonly answers?: readonly HhFormAnswer[];
  /** Чей отклик записать в журнал согласий. */
  readonly employer: string;
  readonly applicationId: string;
  /** Ответ кандидата в анкете на вопрос hh.ru о показе резюме. */
  readonly visibilityAgreed?: boolean;
  /** hh.ru спросил о показе резюме: вопрос встаёт в анкету. */
  readonly onVisibility?: () => void;
  /** Отклик ушёл вместе с анкетой. */
  readonly onFormSent?: () => void;
  /** Отклик ушёл (в том числе с анкетой): отклик отмечается отправленным. */
  readonly onSent: () => Promise<void>;
  /** B641: анкета из окна hh.ru; `open` — отклик без неё не ушёл, нужен шаг «Анкета». */
  readonly onForm: (form: HhForm, open: boolean) => Promise<void>;
}

export interface HhApplyControls {
  readonly state: HhApplyState;
  readonly ask: () => void;
  readonly cancel: () => void;
  /** Только из окна подтверждения или сразу после принятого поручения. */
  readonly confirm: () => void;
  /** «Да» на вопрос hh.ru: отклик отправляется снова с этим ответом. */
  readonly agree: () => void;
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

type Agreed = ReadonlySet<HhSendQuestion>;

/** Исход отклика и поставленные при нём галочки согласия. */
function recordOutcome(input: HhApplyInput, attemptId: string, report: HhDesktopReport): Promise<void> {
  const failure = report.failureCode ?? undefined;
  if (!report.consents?.length) return finishHhApply(attemptId, report.outcome, failure);
  const { employer, applicationId } = input;
  return finishHhApply(attemptId, report.outcome, failure, undefined, { consents: report.consents, employer, applicationId });
}

async function sendOnce(
  input: HhApplyInput,
  resumeId: string,
  agreed: Agreed,
  onLateSent: () => void,
): Promise<HhSendResult> {
  let attemptId: string;
  let mandate: boolean | undefined;
  try {
    ({ attemptId, consent: mandate } = await startHhApply(input.vacancyId, resumeId, input.vacancyTitle, input.cardId));
  } catch (reason: unknown) {
    const refused = refusalOf(reason instanceof CoachApiError ? reason.code : undefined);
    if (refused.kind === 'already') await input.onSent().catch(() => undefined);
    return refused;
  }
  // Отказ сервера прежнее чтение окна не обрывает; новая попытка уводит окно на свою вакансию.
  stopHhWindowWatch();
  const report: HhDesktopReport = await runHhApplyInSession({
    vacancyId: input.vacancyId,
    resumeId,
    letter: input.letter,
    uniqueResumeTitle: input.uniqueResumeTitle,
    ...(input.answers?.length ? { answers: input.answers } : {}),
    ...(mandate || agreed.has('consent') ? { consent: true } : {}),
    ...(agreed.has('relocation') ? { agreedRelocation: true } : {}),
    ...(agreed.has('visibility') || input.visibilityAgreed ? { agreedVisibility: true } : {}),
  }).catch(
    (reason: unknown) => ({ outcome: 'failed' as const, failureCode: desktopFailureCode(reason) }),
  );
  await recordOutcome(input, attemptId, report).catch(() => undefined);
  const result = resultOf(report.outcome, report.failureCode);
  if (result.kind === 'question' && result.about === 'visibility') input.onVisibility?.();
  if (result.kind === 'sent' && input.answers?.length) input.onFormSent?.();
  if (result.kind === 'sent' || result.kind === 'questionnaire' || result.kind === 'already') await input.onSent().catch(() => undefined);
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

  // Ответы на вопросы hh.ru действуют только для этой вакансии.
  const agreed = useRef<{ readonly vacancyId: string; readonly set: Agreed }>({ vacancyId: '', set: new Set() });
  const agreedNow = (): Agreed => (agreed.current.vacancyId === input.vacancyId ? agreed.current.set : new Set());

  const send = () => {
    if (!input.resumeId || inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'sending', seconds: 0 });
    const onLateSent = () => {
      if (shownVacancy.current === input.vacancyId) setState({ kind: 'sent' });
    };
    // Отклик из окна мог отметиться раньше, чем сервер отказал в повторе: «отправлен» не затираем.
    void sendOnce(input, input.resumeId, agreedNow(), onLateSent)
      .then((result) => setState((shown) => (shown.kind === 'sent' ? shown : result)))
      .finally(() => {
        inFlight.current = false;
      });
  };

  return {
    state,
    ask: () => setState({ kind: 'confirm' }),
    cancel: () => setState({ kind: 'idle' }),
    confirm: () => {
      if (state.kind === 'confirm' || state.kind === 'mandate') send();
    },
    agree: () => {
      if (state.kind !== 'question' || inFlight.current) return;
      agreed.current = { vacancyId: input.vacancyId, set: new Set([...agreedNow(), state.about]) };
      send();
    },
  };
}
