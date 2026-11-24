import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_TEXT_VARIANTS,
  type TextVariantList,
  type VariantWish,
} from '../../../../shared/textVariants';
import { apiErrorMessage } from '../../coach/apiClient';
import { useTextVariants } from '../apply/useTextVariants';
import {
  approveB640ContactMessage,
  createB640ContactMessage,
  createB640ContactMessageVariant,
  editB640ContactMessage,
  markB640ContactMessageSent,
  type B640ContactMessage,
  type B640ContactMessageKind,
  type B640MessageTarget,
} from './contactMessageApi';

/** Панель открывает новый черновик: сохранённых вариантов у него ещё нет. */
const noVariants = async (): Promise<TextVariantList> => ({
  variants: [],
  remaining: MAX_TEXT_VARIANTS,
});

export type MessageStep = 'draft' | 'approved';
export interface MessageFailure {
  readonly text: string;
  readonly retry: () => void;
}

export interface UseContactMessageInput {
  readonly target: B640MessageTarget;
  readonly kind: B640ContactMessageKind;
  /** Имя получателя — для текста ошибки. */
  readonly recipientName: string;
  readonly onSent: (sentAt: string) => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Профиль получателя открываем только по https-адресу, который вернул сервер. */
function openProfile(url: string | null): void {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

/** Шаг с ожиданием и ошибкой на месте; «Повторить» повторяет упавший шаг. */
function useRunner(failText: string) {
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<MessageFailure | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(
    async (action: () => Promise<void>) => {
      setPending(true);
      setFailure(null);
      try {
        await action();
      } catch (reason) {
        if (alive.current) {
          setFailure({ text: apiErrorMessage(reason, failText), retry: () => void run(action) });
        }
      } finally {
        if (alive.current) setPending(false);
      }
    },
    [failText],
  );
  return { pending, failure, alive, run };
}

/** Что сказать после «Одобрить и отправить»: всё вышло или чего-то не хватило. */
export const noticeOf = (copied: boolean, opened: boolean): string =>
  [
    copied
      ? 'Текст скопирован — отправьте в LinkedIn.'
      : 'Текст не скопировался — выделите и скопируйте его.',
    opened ? null : 'Адреса профиля нет.',
  ]
    .filter(Boolean)
    .join(' ');

type Runner = ReturnType<typeof useRunner>;

interface ActionsInput {
  readonly message: B640ContactMessage | null;
  readonly text: string;
  readonly runner: Runner;
  readonly replace: (message: B640ContactMessage) => void;
  readonly onSent: (sentAt: string) => void;
}

/** «Одобрить и отправить» и «Отправил»: платформа сама ничего не шлёт. */
function useMessageActions({ message, text, runner, replace, onSent }: ActionsInput) {
  const [step, setStep] = useState<MessageStep>('draft');
  const [notice, setNotice] = useState<string | null>(null);
  const { alive, run } = runner;

  const approve = () => {
    if (!message) return;
    void run(async () => {
      const draft = text.trim();
      if (draft !== message.text) {
        const edited = await editB640ContactMessage(message.id, draft);
        if (alive.current) replace(edited);
      }
      const approval = await approveB640ContactMessage(message.id);
      const copied = await copyText(draft);
      openProfile(approval.openUrl);
      if (!alive.current) return;
      setStep('approved');
      setNotice(noticeOf(copied, Boolean(approval.openUrl)));
    });
  };

  const markSent = () => {
    if (!message) return;
    void run(async () => {
      const sent = await markB640ContactMessageSent(message.id);
      if (alive.current) onSent(sent.sentAt);
    });
  };
  return { step, notice, approve, markSent };
}

/**
 * Сообщение: черновик → правка → «Одобрить и отправить» (копия текста и профиль получателя) → «Отправил».
 * Ошибка и ожидание остаются на месте; «Повторить» повторяет упавший шаг.
 */
export function useContactMessage({ target, kind, recipientName, onSent }: UseContactMessageInput) {
  const [message, setMessage] = useState<B640ContactMessage | null>(null);
  const [draftText, setDraftText] = useState('');
  const [text, setText] = useState('');
  const runner = useRunner(`Не получилось подготовить сообщение: ${recipientName}.`);
  const { alive, run } = runner;
  const started = useRef(false);

  useEffect(() => {
    // Перерисовка с новым объектом того же получателя не просит второй черновик.
    if (started.current) return;
    started.current = true;
    void run(async () => {
      const created = await createB640ContactMessage(target, kind);
      if (!alive.current) return;
      setMessage(created);
      setDraftText(created.text);
      setText(created.text);
    });
  }, [target, kind, run, alive]);

  const create = (wish: VariantWish): Promise<TextVariantList> => {
    if (!message) return Promise.reject(new Error('message_not_ready'));
    const also = 'alsoVacancyId' in target ? target.alsoVacancyId : undefined;
    return createB640ContactMessageVariant(message.id, wish, also);
  };
  const variants = useTextVariants({ load: noVariants, create }, { draftText, text, setText });
  const actions = useMessageActions({ message, text, runner, replace: setMessage, onSent });
  const locked = variants.locked || runner.pending;
  return {
    ...actions,
    message,
    text,
    setText,
    pending: runner.pending,
    failure: runner.failure,
    variants: { ...variants, locked },
  };
}
