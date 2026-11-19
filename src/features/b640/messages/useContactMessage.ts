import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../../coach/apiClient';
import {
  approveB640ContactMessage,
  createB640ContactMessage,
  editB640ContactMessage,
  markB640ContactMessageSent,
  type B640ContactMessage,
  type B640ContactMessageKind,
  type B640MessageTarget,
} from './contactMessageApi';

/** Сколько других вариантов можно попросить после первого черновика (счётчик на кнопке макета). */
export const MESSAGE_VARIANTS_MAX = 3;

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
  readonly replaceLast: (message: B640ContactMessage) => void;
  readonly onSent: (sentAt: string) => void;
}

/** «Одобрить и отправить» и «Отправил»: платформа сама ничего не шлёт. */
function useMessageActions({ message, text, runner, replaceLast, onSent }: ActionsInput) {
  const [step, setStep] = useState<MessageStep>('draft');
  const [notice, setNotice] = useState<string | null>(null);
  const { alive, run } = runner;

  const approve = () => {
    if (!message) return;
    void run(async () => {
      const draft = text.trim();
      if (draft !== message.text) {
        const edited = await editB640ContactMessage(message.id, draft);
        if (alive.current) replaceLast(edited);
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
  const [variants, setVariants] = useState<readonly B640ContactMessage[]>([]);
  const [text, setText] = useState('');
  const runner = useRunner(`Не получилось подготовить сообщение: ${recipientName}.`);
  const { alive, run } = runner;
  const message = variants.at(-1) ?? null;
  const targetKey = JSON.stringify(target);
  const started = useRef<string | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  const addVariant = useCallback(
    () =>
      run(async () => {
        const created = await createB640ContactMessage(targetRef.current, kind);
        if (!alive.current) return;
        setVariants((before) => [...before, created]);
        setText(created.text);
      }),
    [kind, run, alive],
  );

  useEffect(() => {
    // Новый объект с тем же получателем не просит второй черновик.
    if (started.current === targetKey) return;
    started.current = targetKey;
    void addVariant();
  }, [targetKey, addVariant]);

  const replaceLast = useCallback(
    (next: B640ContactMessage) => setVariants((before) => [...before.slice(0, -1), next]),
    [],
  );
  const actions = useMessageActions({ message, text, runner, replaceLast, onSent });
  const left = Math.max(0, MESSAGE_VARIANTS_MAX - Math.max(0, variants.length - 1));
  return {
    ...actions,
    message,
    text,
    setText,
    pending: runner.pending,
    failure: runner.failure,
    addVariant,
    left,
  };
}
