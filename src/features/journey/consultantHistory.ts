/**
 * Import announcements («Импорт: профиль LinkedIn») are stored as `user` rows
 * but the candidate never typed them (B266 S3): the consultant's history shows
 * only real turns. Older rows have random ids, so the text is checked too.
 */
const IMPORT_MESSAGE_ID_PREFIX = 'resume-import:';
const IMPORT_ANNOUNCEMENT_TEXT = /^Импорт: /u;

export interface ConsultantHistoryMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
}

export function isImportAnnouncement(message: ConsultantHistoryMessage): boolean {
  if (message.id.startsWith(IMPORT_MESSAGE_ID_PREFIX)) return true;
  return message.role === 'user' && IMPORT_ANNOUNCEMENT_TEXT.test(message.content);
}

export function consultantTurns<T extends ConsultantHistoryMessage>(
  messages: readonly T[] | undefined,
): T[] {
  return withoutRepeatedQuestions(
    (messages ?? []).filter((message) => !isImportAnnouncement(message)),
  );
}

/**
 * A question resent in a row (B563: one vacancy question stored 10+ times) shows
 * once with one answer: repeats are hidden, and so are their answers once the
 * shown question already has one.
 */
function withoutRepeatedQuestions<T extends ConsultantHistoryMessage>(messages: readonly T[]): T[] {
  const visible: T[] = [];
  let lastQuestion: string | undefined;
  let repeating = false;
  let answered = false;
  for (const message of messages) {
    if (message.role === 'user') {
      const question = message.content.trim();
      repeating = question === lastQuestion;
      if (repeating) continue;
      lastQuestion = question;
      answered = false;
      visible.push(message);
      continue;
    }
    if (repeating && answered) continue;
    visible.push(message);
    if (message.role === 'assistant') answered = true;
  }
  return visible;
}
