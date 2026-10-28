import type { CoachMessage } from '../../domain/coach';

/**
 * `dialogue` is what the candidate and the consultant said; `service` is a
 * `user` row the candidate never typed: a profile edit, an import or a source
 * connection («Подключено: LinkedIn»), stored there for schema reasons only.
 */
export type MessageKind = 'dialogue' | 'service';

/**
 * Every candidate line is written together with its turn, so a `user` row no
 * turn owns is a service record. The rule needs no column: old rows on prod
 * are marked by the same reading as new ones (block A recheck, 28.10).
 */
export function messageKind(
  message: Pick<CoachMessage, 'id' | 'role'>,
  turnMessageIds: ReadonlySet<string>,
): MessageKind {
  if (message.role === 'assistant') return 'dialogue';
  return turnMessageIds.has(message.id) ? 'dialogue' : 'service';
}

export function dialogueOnly<T extends Pick<CoachMessage, 'id' | 'role'>>(
  messages: readonly T[],
  turnMessageIds: ReadonlySet<string>,
): T[] {
  return messages.filter((message) => messageKind(message, turnMessageIds) === 'dialogue');
}
