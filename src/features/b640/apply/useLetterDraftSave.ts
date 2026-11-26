import { useCallback, useEffect, useRef, useState } from 'react';
import {
  removeLetterDraft,
  saveLetterDraft,
  type LetterDraftInput,
} from '../../vacancies/vacancyLetterApi';

const SAVE_DELAY_MS = 700;

export interface LetterDraftSave {
  /** Правка набрана: сохраняется после паузы, а при уходе с экрана — сразу. */
  readonly edit: (input: LetterDraftInput) => void;
  /** Правка больше не нужна: отменить сохранение и убрать её с сервера. */
  readonly discard: () => Promise<void>;
  /** Досохранить правку и дождаться ответа: потом письмо одобряется, и сервер её уберёт. */
  readonly settle: () => Promise<void>;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** Уход с экрана или со страницы сохраняет правку сразу. */
function useFlushOnLeave(flush: () => Promise<void>): void {
  useEffect(() => {
    const leave = () => void flush();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [flush]);
}

/** Правка письма на сервере. Запросы идут по одному: поздний ответ не возвращает убранную правку. */
export function useLetterDraftSave(vacancyId: string, hasDraft: boolean): LetterDraftSave {
  const [failed, setFailed] = useState(false);
  const pending = useRef<LetterDraftInput | null>(null);
  const last = useRef<LetterDraftInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** На сервере может лежать правка: иначе убирать нечего. */
  const stored = useRef(false);
  useEffect(() => {
    if (hasDraft) stored.current = true;
  }, [hasDraft]);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const enqueue = useCallback((task: () => Promise<void>) => {
    chain.current = chain.current.then(task).then(
      () => setFailed(false),
      () => setFailed(true),
    );
    return chain.current;
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const input = pending.current;
    pending.current = null;
    if (!input) return chain.current;
    stored.current = true;
    return enqueue(() =>
      input.body ? saveLetterDraft(vacancyId, input) : removeLetterDraft(vacancyId),
    );
  }, [enqueue, vacancyId]);

  const edit = useCallback(
    (input: LetterDraftInput) => {
      pending.current = input;
      last.current = input;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const discard = useCallback(async () => {
    clearTimeout(timer.current);
    pending.current = null;
    await enqueue(() => (stored.current ? removeLetterDraft(vacancyId) : Promise.resolve()));
    stored.current = false;
  }, [enqueue, vacancyId]);

  const retry = useCallback(() => {
    pending.current ??= last.current;
    void flush();
  }, [flush]);

  useFlushOnLeave(flush);

  return { edit, discard, settle: flush, failed, retry };
}
