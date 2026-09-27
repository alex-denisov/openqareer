import type { RecruiterContact } from '../../shared/recruiterContact';

/**
 * Кандидат получает контакт как услугу: квитанция источника (пул, метод,
 * ссылка) остаётся внутренней — решение владельца по C59/B263.
 */
export function toCandidateContact(contact: RecruiterContact): RecruiterContact {
  const { sourceReceipt: _internal, ...shown } = contact;
  return shown;
}
