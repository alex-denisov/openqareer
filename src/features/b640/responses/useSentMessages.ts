import { useEffect, useState } from 'react';
import {
  listB640SentMessages,
  type B640SentContactMessage,
} from '../messages/contactMessageApi';

const NONE: readonly B640SentContactMessage[] = [];

/**
 * B698: сообщения знакомым и рекрутёрам по вакансии отклика, отмеченные «Отправил».
 * Это дополнение к «Что было»: при сбое чтения история показывает свои события без них.
 */
export function useSentMessages(vacancyId: string | null | undefined): readonly B640SentContactMessage[] {
  const [messages, setMessages] = useState<readonly B640SentContactMessage[]>(NONE);
  useEffect(() => {
    if (!vacancyId) return undefined;
    const controller = new AbortController();
    listB640SentMessages(vacancyId, controller.signal).then(
      (items) => setMessages(items),
      // Сбой чтения не прячет историю: она остаётся со своими событиями, без сообщений.
      () => setMessages(NONE),
    );
    return () => controller.abort();
  }, [vacancyId]);
  return vacancyId ? messages : NONE;
}
