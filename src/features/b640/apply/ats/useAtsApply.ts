import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManualApplyReason } from '../../../../../shared/manualApply';
import type { ApprovedVacancyLetterResult } from '../../../vacancies/vacancyLetterApi';
import type { QuestionnaireState } from '../FormStep';
import { answerOf, type AnswerDraft } from '../model/formModel';
import { closeAtsForm } from './atsDesktop';
import { askedFields, atsFormInput, isOffList, missingAnswers, questionIdOf } from './atsQuestions';
import { allFields, isOffTarget, type AtsRunResult } from './atsRun';
import {
  holdWindow,
  mandateAccepted,
  openForm,
  priorAttempt,
  sendSession,
  type AtsApplyState,
  type AtsSession,
} from './atsSession';
import type { AtsAddress } from './atsTarget';

export type { AtsApplyState } from './atsSession';

const CAN_SEND: ReadonlySet<AtsApplyState['kind']> = new Set([
  'ready',
  'mandate',
  'refused',
  'failed',
]);

/** Нажатие ещё возможно. */
export const canSendAts = (kind: AtsApplyState['kind']): boolean => CAN_SEND.has(kind);

export interface AtsApplyInput {
  readonly vacancyId: string;
  /** `null` — форма этой вакансии не для приложения. */
  readonly address: AtsAddress | null;
  /** Открыт шаг, которому нужна форма. */
  readonly wanted: boolean;
  readonly employer: string;
  readonly approved: ApprovedVacancyLetterResult | null;
  readonly letterText: string;
  readonly questionnaire: QuestionnaireState;
  /** Отклик ушёл: отметить его и анкету. */
  readonly onSent: () => Promise<void>;
  readonly onAsk: () => void;
  readonly onManual: (reason: ManualApplyReason, host: string) => void;
}

export interface AtsApplyControls {
  readonly state: AtsApplyState;
  readonly host: string;
  /** Вопросы, на которые кандидат ещё не ответил. */
  readonly missing: number;
  readonly send: () => void;
  readonly retry: () => void;
  readonly cancel: () => void;
}

const closeWindow = (): void => {
  void closeAtsForm().catch(() => undefined);
};

interface Box<T> {
  current: T;
}

interface Core {
  readonly latest: Box<AtsApplyInput>;
  readonly alive: Box<boolean>;
  readonly inFlight: Box<boolean>;
  readonly session: AtsSession | null;
  readonly show: (next: AtsApplyState) => void;
  /** Вопросы формы встают в «Анкету»; ответ не из списка стирается. */
  readonly takeForm: (next: AtsSession) => Promise<boolean>;
  readonly dropSession: () => void;
  readonly toManual: (reason: ManualApplyReason, host: string) => void;
}

const offList = (form: AtsSession['form']) => (draft: AnswerDraft) =>
  askedFields(allFields(form))
    .map((field) => ({ field, id: questionIdOf(field) }))
    .filter(({ field, id }) => isOffList(field, answerOf(draft, id)))
    .map(({ id }) => id);

function useCore(input: AtsApplyInput, setState: (next: AtsApplyState) => void): Core {
  const [session, setSession] = useState<AtsSession | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const inFlight = useRef(false);
  const alive = useRef(true);
  const show = useCallback(
    (next: AtsApplyState) => {
      if (alive.current) setState(next);
    },
    [setState],
  );
  const takeForm = useCallback(async (next: AtsSession): Promise<boolean> => {
    const { questionnaire, address } = latest.current;
    if (!address) return false;
    const questions = atsFormInput(address.url, allFields(next.form), next.facts);
    const saved = await questionnaire.takeAtsForm(questions, offList(next.form));
    if (!saved || !alive.current) return false;
    setSession(next);
    return true;
  }, []);
  const toManual = useCallback(
    (reason: ManualApplyReason, host: string) => {
      show({ kind: 'manual' });
      latest.current.onManual(reason, host);
      closeWindow();
    },
    [show],
  );
  const dropSession = useCallback(() => setSession(null), []);
  return { latest, alive, inFlight, session, show, takeForm, dropSession, toManual };
}

/** Открыть форму; прежнее нажатие показывает свой итог вместо неё. */
function useOpen({ latest, alive, show, takeForm, toManual }: Core): () => Promise<void> {
  return useCallback(async () => {
    const { address, vacancyId } = latest.current;
    if (!address) return;
    show({ kind: 'reading' });
    try {
      const prior = await priorAttempt(vacancyId);
      if (prior) {
        if (prior.kind === 'sent') await latest.current.onSent().catch(() => undefined);
        show(prior);
        return;
      }
      const opened = await openForm(vacancyId, address);
      if (!alive.current) return;
      if (opened.kind === 'manual') {
        toManual(opened.reason, opened.host);
        return;
      }
      show({ kind: (await takeForm(opened)) ? 'ready' : 'read_failed' });
    } catch {
      show({ kind: 'read_failed' });
    }
  }, [latest, alive, show, takeForm, toManual]);
}

/** Форма читается один раз, когда открыт её шаг; уход с экрана закрывает окно. */
function useAutoOpen({ alive, inFlight }: Core, wanted: boolean, open: () => Promise<void>): void {
  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Идущую отправку закрытие окна оборвало бы.
      if (started.current && !inFlight.current) closeWindow();
    };
  }, [alive, inFlight]);
  useEffect(() => {
    if (!wanted || started.current) return;
    started.current = true;
    void open();
  }, [wanted, open]);
}

async function finish(core: Core, result: AtsRunResult, current: AtsSession): Promise<void> {
  const { show, latest, alive } = core;
  if (result.kind === 'manual') return core.toManual(result.reason, result.host);
  if (result.kind === 'ask') {
    const taken = await core.takeForm({ ...current, form: result.form });
    show({ kind: taken ? 'ready' : 'read_failed' });
    if (taken) latest.current.onAsk();
    return undefined;
  }
  if (result.kind === 'sent') {
    const { host, path, pressedAtMs } = result.receipt;
    show({ kind: 'sent', receipt: { host, path, pressedAtMs } });
    if (alive.current) closeWindow();
    return latest.current.onSent().catch(() => undefined);
  }
  // Страница уже видела нажатие или потеряна: следующая попытка открывает её заново.
  if (result.kind !== 'unconfirmed') core.dropSession();
  return show(result);
}

async function sendNow(core: Core, open: () => Promise<void>): Promise<void> {
  const { session: current, latest, show } = core;
  // Форма отказала или потеряна: она читается заново, дальше — снова по команде кандидата.
  if (!current) return open();
  show({ kind: 'sending', seconds: 0 });
  const { vacancyId, employer, approved, letterText, questionnaire } = latest.current;
  if (!approved) return show({ kind: 'failed' });
  let result: AtsRunResult = { kind: 'failed' };
  try {
    if (!(await mandateAccepted())) return show({ kind: 'mandate' });
    const { draft } = questionnaire;
    result = await holdWindow(
      sendSession(current, { vacancyId, employer, approved, letterText, draft }),
    );
  } catch (reason) {
    if (isOffTarget(reason)) result = { kind: 'manual', reason: 'other', host: current.form.host };
  }
  return finish(core, result, current);
}

/** Форма с сайта работодателя: чтение, вопросы «Анкеты», одно нажатие и его итог (B787). */
export function useAtsApply(input: AtsApplyInput): AtsApplyControls {
  const { address, wanted, questionnaire } = input;
  const [state, setState] = useState<AtsApplyState>({ kind: 'reading' });
  const core = useCore(input, setState);
  const { session, inFlight, alive } = core;
  const open = useOpen(core);
  useAutoOpen(core, wanted && address !== null, open);
  useSeconds(state.kind === 'sending', setState);

  const send = () => {
    if (!canSendAts(state.kind) || inFlight.current || !input.approved) return;
    inFlight.current = true;
    void sendNow(core, open).finally(() => {
      inFlight.current = false;
      if (!alive.current) closeWindow();
    });
  };
  const missing = useMemo(
    () => (session ? missingAnswers(allFields(session.form), questionnaire.draft) : 0),
    [session, questionnaire.draft],
  );
  return {
    state,
    host: session?.form.host ?? address?.host ?? '',
    missing,
    send,
    retry: () => void open(),
    cancel: () => setState((now) => (now.kind === 'mandate' ? { kind: 'ready' } : now)),
  };
}

/** Секунды ожидания ответа — как на экране hh.ru. */
function useSeconds(
  sending: boolean,
  setState: (update: (now: AtsApplyState) => AtsApplyState) => void,
): void {
  useEffect(() => {
    if (!sending) return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      setState((now) => (now.kind === 'sending' ? { kind: 'sending', seconds } : now));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sending, setState]);
}
