import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManualApplyReason } from '../../../../../shared/manualApply';
import { getAccountCapabilityConsents } from '../../../account/accountCapabilityConsentApi';
import type { ApprovedVacancyLetterResult } from '../../../vacancies/vacancyLetterApi';
import type { QuestionnaireState } from '../FormStep';
import { serverConsentJournal } from './atsConsentJournal';
import * as desktop from './atsDesktop';
import { loadAtsFacts, loadAtsResume } from './atsFacts';
import { isResumeFile } from './atsFieldPlan';
import type { AtsConfirmation } from './atsFormTypes';
import type { IdentityFacts } from './atsIdentity';
import { hasApplyMandate } from './atsMandate';
import { askedFields, atsFormInput, isOffList, missingAnswers, questionIdOf } from './atsQuestions';
import {
  allFields,
  formOf,
  isOffTarget,
  isUnknownForm,
  runAtsForm,
  type AtsForm,
  type AtsRunResult,
} from './atsRun';
import { settleAtsConsents } from './atsSend';
import type { AtsAddress } from './atsTarget';
import { answerOf, type AnswerDraft } from '../model/formModel';

export type AtsApplyState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read_failed' }
  | { readonly kind: 'ready' }
  /** Поручение ещё не дано: спрашивают один раз, отклик уходит сразу после согласия. */
  | { readonly kind: 'mandate' }
  | { readonly kind: 'sending'; readonly seconds: number }
  | { readonly kind: 'sent'; readonly receipt: AtsConfirmation }
  | { readonly kind: 'unconfirmed'; readonly host: string }
  | { readonly kind: 'refused'; readonly host: string }
  | { readonly kind: 'failed' }
  /** Отклик уходит в очередь кандидата. */
  | { readonly kind: 'manual' };

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

const DEPS = {
  desktop,
  journal: serverConsentJournal,
  newId: () => crypto.randomUUID(),
};

/** Окно формы одно на приложение: новая форма ждёт конца идущей отправки. */
let running: Promise<unknown> = Promise.resolve();

type Opened =
  | { readonly kind: 'form'; readonly form: AtsForm; readonly facts: IdentityFacts }
  | { readonly kind: 'manual'; readonly reason: ManualApplyReason; readonly host: string };

async function openForm(vacancyId: string, address: AtsAddress): Promise<Opened> {
  await running.catch(() => undefined);
  const facts = await loadAtsFacts();
  try {
    const report = await desktop.openAtsForm(vacancyId, address.url, address.board);
    if (!report) throw new Error('ats_no_answer');
    const form = formOf(report, address.host);
    return 'kind' in form ? form : { kind: 'form', form, facts };
  } catch (reason) {
    if (isUnknownForm(reason)) return { kind: 'manual', reason: 'other', host: address.host };
    throw reason;
  }
}

/** Прежнее нажатие: его итог показывается, второго не будет. */
async function priorAttempt(vacancyId: string): Promise<AtsApplyState | null> {
  const attempt = await desktop.readAtsAttempt(vacancyId);
  if (!attempt) return null;
  await settleAtsConsents(attempt, serverConsentJournal);
  if (attempt.result === 'failed') return null;
  const host = URL.canParse(attempt.entryUrl) ? new URL(attempt.entryUrl).hostname : '';
  if (attempt.result !== 'sent') return { kind: 'unconfirmed', host };
  const pressedAtMs = attempt.startedAtMs;
  return { kind: 'sent', receipt: attempt.confirmation ?? { host, path: '', pressedAtMs } };
}

async function mandateAccepted(): Promise<boolean> {
  const consents = await getAccountCapabilityConsents();
  return hasApplyMandate(
    consents.filter((item) => item.revokedAt === null).map((item) => item.versionId),
  );
}

interface Session {
  readonly form: AtsForm;
  readonly facts: IdentityFacts;
}

/** Форма с сайта работодателя: чтение, вопросы «Анкеты», одно нажатие и его итог (B787). */
export function useAtsApply(input: AtsApplyInput): AtsApplyControls {
  const { vacancyId, address, wanted, questionnaire } = input;
  const [state, setState] = useState<AtsApplyState>({ kind: 'reading' });
  const [session, setSession] = useState<Session | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const inFlight = useRef(false);
  const alive = useRef(true);
  const show = useCallback((next: AtsApplyState) => {
    if (alive.current) setState(next);
  }, []);

  /** Вопросы формы встают в «Анкету»; ответ не из списка стирается. */
  const takeForm = useCallback(
    async (next: Session, url: string): Promise<boolean> => {
      const { questionnaire: form } = latest.current;
      const fields = allFields(next.form);
      const offList = (draft: AnswerDraft) =>
        askedFields(fields)
          .map((field) => ({ field, id: questionIdOf(field) }))
          .filter(({ field, id }) => isOffList(field, answerOf(draft, id)))
          .map(({ id }) => id);
      const saved = await form.takeAtsForm(atsFormInput(url, fields, next.facts), offList);
      if (!saved || !alive.current) return false;
      setSession(next);
      return true;
    },
    [],
  );

  const toManual = useCallback(
    (reason: ManualApplyReason, host: string) => {
      show({ kind: 'manual' });
      latest.current.onManual(reason, host);
      void desktop.closeAtsForm().catch(() => undefined);
    },
    [show],
  );

  const open = useCallback(async (): Promise<void> => {
    if (!address) return;
    show({ kind: 'reading' });
    try {
      const prior = await priorAttempt(vacancyId);
      if (prior) {
        if (prior.kind === 'sent') await latest.current.onSent().catch(() => undefined);
        return show(prior);
      }
      const opened = await openForm(vacancyId, address);
      if (!alive.current) return undefined;
      if (opened.kind === 'manual') return toManual(opened.reason, opened.host);
      const taken = await takeForm(opened, address.url);
      return show({ kind: taken ? 'ready' : 'read_failed' });
    } catch {
      return show({ kind: 'read_failed' });
    }
  }, [address, vacancyId, show, takeForm, toManual]);

  const started = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Идущую отправку закрытие окна оборвало бы.
      if (started.current && !inFlight.current) void desktop.closeAtsForm().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    if (!wanted || !address || started.current) return;
    started.current = true;
    void open();
  }, [wanted, address, open]);

  const finish = async (result: AtsRunResult, current: Session): Promise<void> => {
    if (result.kind === 'manual') return toManual(result.reason, result.host);
    if (result.kind === 'ask') {
      const taken = await takeForm({ ...current, form: result.form }, address!.url);
      show({ kind: taken ? 'ready' : 'read_failed' });
      if (taken) latest.current.onAsk();
      return undefined;
    }
    if (result.kind === 'sent') {
      const { host, path, pressedAtMs } = result.receipt;
      show({ kind: 'sent', receipt: { host, path, pressedAtMs } });
      if (alive.current) await desktop.closeAtsForm().catch(() => undefined);
      await latest.current.onSent().catch(() => undefined);
      return undefined;
    }
    // Страница уже видела нажатие или потеряна: следующая попытка открывает её заново.
    if (result.kind !== 'unconfirmed') setSession(null);
    return show(result);
  };

  const run = async (current: Session): Promise<AtsRunResult> => {
    const { approved, letterText, employer, questionnaire: form } = latest.current;
    const needsFile = allFields(current.form).some((field) => isResumeFile(field));
    const fullName = current.facts.fullName ?? '';
    const resume = needsFile ? await loadAtsResume(vacancyId, approved?.resume, fullName) : null;
    return runAtsForm(
      current.form,
      {
        vacancyId,
        applicationId: approved!.applicationId,
        employer,
        letter: letterText,
        facts: current.facts,
        resume,
        draft: form.draft,
        now: () => new Date(),
      },
      DEPS,
    );
  };

  /** Форма отказала или потеряна: она читается заново, дальше — снова по команде кандидата. */
  const ensureSession = async (): Promise<Session | null> => {
    if (session) return session;
    await open();
    return null;
  };

  const sendNow = async (): Promise<void> => {
    const current = await ensureSession();
    if (!current) return undefined;
    show({ kind: 'sending', seconds: 0 });
    let result: AtsRunResult = { kind: 'failed' };
    try {
      if (!(await mandateAccepted())) return show({ kind: 'mandate' });
      const job = run(current);
      running = job;
      result = await job;
    } catch (reason) {
      result = isOffTarget(reason)
        ? { kind: 'manual', reason: 'other', host: current.form.host }
        : { kind: 'failed' };
    }
    return finish(result, current);
  };

  const send = () => {
    const { kind } = state;
    const can = kind === 'ready' || kind === 'mandate' || kind === 'refused' || kind === 'failed';
    if (!can || inFlight.current || !latest.current.approved) return;
    inFlight.current = true;
    void sendNow().finally(() => {
      inFlight.current = false;
      if (!alive.current) void desktop.closeAtsForm().catch(() => undefined);
    });
  };

  useSeconds(state.kind === 'sending', setState);
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
