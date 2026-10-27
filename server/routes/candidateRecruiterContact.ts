import type { CandidateRecruiterChannel } from '../../shared/recruiterChannel';
import { candidateChannels } from '../../shared/recruiterChannel';
import { personNameFromTitle } from '../../shared/personName';
import type { RecruiterContact } from '../../shared/recruiterContact';

/**
 * Кандидат получает контакт как услугу: квитанция источника (пул, метод,
 * ссылка) остаётся внутренней — решение владельца по C59/B263.
 */
export function toCandidateContact(
  contact: RecruiterContact,
): Omit<RecruiterContact, 'channels'> & { channels: CandidateRecruiterChannel[] } {
  const { sourceReceipt: _internal, channels, ...shown } = contact;
  return { ...shown, fullName: personNameFromTitle(shown.fullName), channels: candidateChannels(channels ?? []) };
}
