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
  return (messages ?? []).filter((message) => !isImportAnnouncement(message));
}
