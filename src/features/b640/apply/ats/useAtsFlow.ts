import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManualApplyItem, ManualApplyReason } from '../../../../../shared/manualApply';
import { isTauriEnvironment } from '../../../../services/desktop/desktopBridge';
import { hhVacancyIdFromUrl } from '../../../../../shared/hhCandidateSession';
import type { LetterScreenState } from '../../../vacancies/vacancyLetterController';
import type { QuestionnaireState } from '../FormStep';
import type { ApplyDestination, ApplyHead, ApplyStep, ApplyTarget } from '../model/applyModel';
import { isUnsent, type QueueManual } from '../useManualApply';
import { closeManualApply } from '../data/manualApplyApi';
import { markApplied } from '../SendStep';
import { atsAddressOf, ownSiteReason } from './atsTarget';
import { useAtsApply, type AtsApplyControls } from './useAtsApply';

export interface AtsFlowInput {
  readonly target: ApplyTarget;
  readonly destination: ApplyDestination | null;
  readonly head: ApplyHead;
  readonly sourceType: string;
  /** Отклик уже в очереди кандидата. */
  readonly manual: ManualApplyItem | null;
  readonly queue: QueueManual;
  /** «Не откликаюсь» без нового нажатия «Откликнуться». */
  readonly held: boolean;
  /** Экран открыт без нажатия: сам в очередь не ставит. */
  readonly declined: boolean;
  readonly step: ApplyStep;
  readonly setStep: (update: (now: ApplyStep) => ApplyStep) => void;
  readonly letter: LetterScreenState;
  readonly questionnaire: QuestionnaireState;
}

export interface AtsFlow {
  /** Форма сайта работодателя отправляется из приложения; `null` — обычный отклик. */
  readonly apply: AtsApplyControls | null;
  /** Отклик встаёт в очередь кандидата. */
  readonly queuing: boolean;
  readonly onSent: () => Promise<void>;
}

/** Сайт работодателя не из приложения: на шаге «Отправка» отклик встаёт в очередь один раз. */
function useOwnSiteQueue(
  open: boolean,
  reason: ManualApplyReason | null,
  host: string,
  queue: QueueManual,
): boolean {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const started = useRef(false);
  useEffect(() => {
    if (!open || !reason || started.current) return;
    started.current = true;
    setState('busy');
    void queue(reason, host).finally(() => setState('done'));
  }, [open, reason, host, queue]);
  return Boolean(open && reason) && state !== 'done';
}

/** После «Не откликаюсь» открытый адрес сам ничего не ставит, пока кандидат не сменил шаг. */
function useHeld(declined: boolean, step: ApplyStep): boolean {
  const [opened] = useState(step);
  const [moved, setMoved] = useState(false);
  if (!moved && step !== opened) setMoved(true);
  return declined && !moved && step === opened;
}

const hostOf = (url: string | null): string =>
  url && URL.canParse(url) ? new URL(url).hostname : '';

/** Адрес формы для приложения; вакансии hh.ru уходят своим путём. */
function useAddress(input: AtsFlowInput) {
  const { target, destination, head, manual } = input;
  // «Отправить на сайте» ставит и веб, где формы нет; приложение читает такую форму само.
  const queued = manual !== null && manual.reason !== 'other';
  const open =
    isTauriEnvironment() &&
    !queued &&
    isUnsent(target) &&
    !(head.url && hhVacancyIdFromUrl(head.url));
  return useMemo(
    () => (open ? atsAddressOf(destination, head.url) : null),
    [open, destination, head.url],
  );
}

/** Отклик на сайте работодателя (B787): форма внутри приложения или очередь кандидата. */
export function useAtsFlow(input: AtsFlowInput): AtsFlow {
  const { target, destination, head, sourceType, manual, queue, step, setStep } = input;
  const { vacancyId } = target;
  const { questionnaire } = input;
  const approved = input.letter.approval.saved;
  const held = useHeld(input.held, step);
  const onSend = step === 'send' && Boolean(approved) && !held;
  // Площадка, узнанная при открытии, не меняется: очередь выключает форму через её состояние.
  const address = useAddress(input);
  const onSent = async () => {
    if (questionnaire.form) questionnaire.markSubmitted();
    if (manual) {
      await closeManualApply(vacancyId, 'sent');
      return;
    }
    if (!approved) return;
    await markApplied({ vacancyId, head, sourceType, applicationId: approved.applicationId });
  };
  const apply = useAtsApply({
    vacancyId,
    address,
    wanted: (step === 'form' && !held) || onSend,
    employer: head.company,
    approved,
    letterText: input.letter.draft.text,
    questionnaire,
    onSent,
    onAsk: () => setStep((now) => (now === 'send' ? 'form' : now)),
    onManual: (reason, host) => {
      void queue(reason, host || hostOf(head.url));
      setStep((now) => (now === 'form' ? 'send' : now));
    },
  });
  const active = address !== null && apply.state.kind !== 'manual';
  const queuing = useOwnSiteQueue(
    onSend && !input.declined && !manual && isUnsent(target) && address === null,
    ownSiteReason(destination),
    hostOf(head.url),
    queue,
  );
  return { apply: active ? apply : null, queuing, onSent };
}
