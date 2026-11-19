import { useCallback, useEffect, useRef, useState } from 'react';
import type { B640Contact } from '../../../../../shared/b640Contacts';
import { apiErrorMessage } from '../../../coach/apiClient';
import {
  approveB640ContactMessage,
  createB640ContactMessage,
  editB640ContactMessage,
  markB640ContactMessageSent,
  type B640ContactMessage,
} from './contactMessageApi';

export type MessageStep = 'draft' | 'approved';
export interface MessageFailure {
  readonly text: string;
  readonly retry: () => void;
}
export interface MessageSent {
  readonly sentAt: string;
}

/** Черновик по связи: через знакомого — просьба представить, иначе — прямое сообщение. */
export const messageKind = (contact: Pick<B640Contact, 'link'>) =>
  contact.link === 'intro' ? 'ask_introduction' : 'known_contact';

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
function useRunner() {
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<MessageFailure | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setFailure(null);
    try {
      await action();
    } catch (reason) {
      if (alive.current) {
        setFailure({
          text: apiErrorMessage(reason, 'Не получилось. Повторите.'),
          retry: () => void run(action),
        });
      }
    } finally {
      if (alive.current) setPending(false);
    }
  }, []);
  return { pending, failure, alive, run };
}

/** Что сказать после «Скопировать и открыть», если что-то не вышло. */
const noticeOf = (copied: boolean, opened: boolean): string | null =>
  [
    copied ? null : 'Текст не скопировался — выделите и скопируйте его.',
    opened ? null : 'Адреса профиля нет.',
  ]
    .filter(Boolean)
    .join(' ') || null;

/**
 * Письмо контакту: черновик → правка → «Скопировать и открыть» → «Отправил».
 * Ошибка и ожидание остаются на месте; «Повторить» повторяет упавший шаг.
 */
export function useContactMessage(contact: B640Contact, onSent: (sentAt: string) => void) {
  const [message, setMessage] = useState<B640ContactMessage | null>(null);
  const [text, setText] = useState('');
  const [step, setStep] = useState<MessageStep>('draft');
  const [notice, setNotice] = useState<string | null>(null);
  const { pending, failure, alive, run } = useRunner();

  useEffect(() => {
    void run(async () => {
      const created = await createB640ContactMessage(contact.id, messageKind(contact));
      if (!alive.current) return;
      setMessage(created);
      setText(created.text);
    });
  }, [contact, run, alive]);

  const approve = () => {
    if (!message) return;
    void run(async () => {
      const draft = text.trim();
      if (draft !== message.text) setMessage(await editB640ContactMessage(message.id, draft));
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

  return { message, text, setText, step, pending, failure, notice, approve, markSent };
}
