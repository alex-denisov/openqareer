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
 * once: a repeat of the previous user question is hidden with its answers.
 */
function withoutRepeatedQuestions<T extends ConsultantHistoryMessage>(messages: readonly T[]): T[] {
  const visible: T[] = [];
  let lastQuestion: string | undefined;
  let hidingRepeat = false;
  for (const message of messages) {
    if (message.role === 'user') {
      const question = message.content.trim();
      hidingRepeat = question === lastQuestion;
      lastQuestion = question;
    }
    if (!hidingRepeat) visible.push(message);
  }
  return visible;
}
