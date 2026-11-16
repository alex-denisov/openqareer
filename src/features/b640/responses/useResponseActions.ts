import { useRef, useState, type MutableRefObject } from 'react';
import type { ApplicationStage } from '../../../../shared/applicationStage';
import {
  patchApplication,
  recordFollowUpSent,
  restoreApplicationFromArchive,
  type ApplicationView,
} from '../../applications/applicationsApi';
import { apiErrorMessage } from '../../coach/apiClient';
import { useToast } from '../kit';

export type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string; readonly retry: () => void };

export interface Mark {
  readonly stage: ApplicationStage;
  readonly label: string;
  readonly done: string;
}

const MARKS: readonly Mark[] = [
  { stage: 'responded', label: 'Ответили', done: 'Отмечено: ответили' },
  { stage: 'interview', label: 'Пригласили на интервью', done: 'Отмечено: интервью' },
  { stage: 'offer', label: 'Прислали оффер', done: 'Отмечено: оффер' },
  { stage: 'rejected', label: 'Отказали', done: 'Отмечено: отказ' },
  { stage: 'archived', label: 'В архив', done: 'Отклик в архиве' },
];

const STAGE_ORDER: readonly ApplicationStage[] = [
  'saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived',
];

/** Что можно отметить дальше: только стадии после текущей. */
export function marksFor(stage: ApplicationStage): readonly Mark[] {
  if (stage === 'rejected' || stage === 'archived') return [];
  if (stage === 'saved') return MARKS.filter((mark) => mark.stage === 'archived');
  const at = STAGE_ORDER.indexOf(stage);
  return MARKS.filter((mark) => STAGE_ORDER.indexOf(mark.stage) > at);
}

type Change = (current: ApplicationView) => Promise<ApplicationView>;

/**
 * Очередь правок одного отклика. Правки идут по одной и каждая берёт свежую версию
 * записи: заметка и отметка стадии, нажатые подряд, не сталкиваются по версии.
 */
export interface ResponseWriter {
  readonly write: (change: Change) => Promise<ApplicationView>;
}

export function useResponseWriter(
  application: ApplicationView,
  onChanged: (next: ApplicationView) => void,
): ResponseWriter {
  const latest = useRef(application);
  if (latest.current.id !== application.id || application.version > latest.current.version) {
    latest.current = application;
  }
  const queue: MutableRefObject<Promise<unknown>> = useRef(Promise.resolve());
  const notify = useRef(onChanged);
  notify.current = onChanged;
  const writer = useRef<ResponseWriter>({
    write: (change) => {
      const next = queue.current
        .catch(() => undefined)
        .then(() => change(latest.current))
        .then((saved) => {
          latest.current = saved;
          notify.current(saved);
          return saved;
        });
      queue.current = next;
      return next;
    },
  });
  return writer.current;
}

export interface ResponseActions {
  readonly outcome: Outcome;
  readonly mark: (target: Mark) => void;
  readonly remindSent: () => void;
  readonly restore: () => void;
}

const stageChange =
  (stage: ApplicationStage): Change =>
  (current) =>
    patchApplication(current.id, { expectedVersion: current.version, stage });

/** Действия раскрытого отклика: результат и ошибка остаются на месте действия. */
export function useResponseActions(
  application: ApplicationView,
  writer: ResponseWriter,
): ResponseActions {
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  function run(change: Change, done: string, fail: string, undo?: () => void) {
    setOutcome({ kind: 'busy' });
    writer
      .write(change)
      .then(() => {
        setOutcome(done ? { kind: 'done', text: done } : { kind: 'idle' });
        if (undo) toast.show({ text: done, undo: { label: 'Отменить', onUndo: undo } });
      })
      .catch((reason: unknown) =>
        setOutcome({
          kind: 'error',
          text: apiErrorMessage(reason, fail),
          retry: () => run(change, done, fail, undo),
        }),
      );
  }

  const save = 'Не получилось сохранить. Повторите.';
  return {
    outcome,
    mark: (target) => {
      const previous = application.stage;
      run(stageChange(target.stage), target.done, save, () =>
        run(stageChange(previous), '', 'Не получилось отменить. Повторите.'),
      );
    },
    remindSent: () =>
      run((current) => recordFollowUpSent(current.id), 'Отмечено: вы напомнили о себе', save),
    restore: () =>
      run(
        (current) => restoreApplicationFromArchive(current.id, current.version),
        'Отклик возвращён из архива',
        save,
      ),
  };
}

export interface NoteState {
  readonly note: string;
  readonly setNote: (value: string) => void;
  readonly outcome: Outcome;
  readonly save: () => void;
}

/** Заметка к отклику: сохраняется при уходе из поля. Экран отклика создаётся заново на каждый отклик. */
export function useResponseNote(application: ApplicationView, writer: ResponseWriter): NoteState {
  const [note, setNote] = useState(application.notes ?? '');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  function save() {
    const value = note.trim();
    if (value === (application.notes ?? '').trim()) return;
    setOutcome({ kind: 'busy' });
    writer
      .write((current) =>
        patchApplication(current.id, { expectedVersion: current.version, notes: value || null }),
      )
      .then(() => setOutcome({ kind: 'done', text: 'Заметка сохранена' }))
      .catch((reason: unknown) =>
        setOutcome({
          kind: 'error',
          text: apiErrorMessage(reason, 'Заметка не сохранилась.'),
          retry: save,
        }),
      );
  }

  return { note, setNote, outcome, save };
}
