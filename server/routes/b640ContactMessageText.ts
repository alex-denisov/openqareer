import type { FastifyRequest } from 'fastify';
import type { B640ContactMessageKind } from '../../shared/b640ContactMessage';
import {
  acceptModelMessage,
  contactMessageWish,
  fallbackContactMessage,
  type ContactMessageFacts,
} from '../domain/b640ContactMessage';
import { letterProfileText } from '../domain/letterProfile';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { filterUsablePitchFacts } from '../domain/vacancyPitchService';
import { candidateGenderFromName } from '../../shared/candidateGender';
import type { RouteDeps } from './deps';

export interface MessageRecipient {
  readonly contactId: string | null;
  readonly recruiterId: string | null;
  readonly name: string;
  readonly company: string;
  readonly linkedinUrl: string | null;
  readonly relationship: string | null;
}

interface TextInput {
  readonly candidateId: string;
  readonly kind: B640ContactMessageKind;
  readonly recipient: MessageRecipient;
  readonly vacancyId: string | null;
}

function vacancyOf(deps: RouteDeps, vacancyId: string | null): { title: string; company: string } | null {
  if (!vacancyId) return null;
  const cluster = deps.multiSourceEngine?.getActiveCluster?.(vacancyId);
  return cluster?.canonicalTitle ? { title: cluster.canonicalTitle, company: cluster.canonicalCompany ?? '' } : null;
}

/**
 * Текст сообщения: модель через тот же писатель, что и письмо получателю; при отказе, пустом ответе
 * или новых цифрах — шаблон на данных профиля. Реальный запрос B613 заменит `contactMessageWish`.
 */
export async function writeContactMessageText(
  deps: RouteDeps,
  request: FastifyRequest,
  input: TextInput,
): Promise<string> {
  const snapshot = deps.candidateStore.getSnapshot(input.candidateId);
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  const facts = snapshot.memory ?? [];
  const withheld = new Set(facts.filter((fact) => fact.sensitive === true).map((fact) => fact.id));
  const profile = letterProfileText({ draft, facts: filterUsablePitchFacts(facts), withheldEvidenceIds: withheld });
  const vacancy = vacancyOf(deps, input.vacancyId);
  const message: ContactMessageFacts = {
    kind: input.kind,
    recipientName: input.recipient.name,
    recipientCompany: input.recipient.company,
    targetRole: draft.targetRole ?? '',
    ...(vacancy ? { vacancyTitle: vacancy.title, vacancyCompany: vacancy.company } : {}),
    ...(input.recipient.relationship ? { relationship: input.recipient.relationship } : {}),
  };
  const fallback = fallbackContactMessage(message);
  if (!deps.coverLetterWriter || !profile.trim()) return fallback;
  try {
    const gender = candidateGenderFromName(draft.candidate?.fullName);
    const outcome = await deps.coverLetterWriter.writeCoverLetter({
      profile,
      vacancy: { title: vacancy?.title ?? 'Личное сообщение', ...(vacancy?.company ? { company: vacancy.company } : {}) },
      ...(gender ? { gender } : {}),
      resumeAttached: false,
      chosenLanguage: 'ru',
      wish: contactMessageWish(message),
    });
    const known = [profile, input.recipient.name, input.recipient.company, vacancy?.title ?? '', draft.targetRole ?? ''].join('\n');
    return acceptModelMessage(outcome.body, known) ?? fallback;
  } catch (error) {
    request.log.warn({ err: error }, 'contact-message-writer-failed');
    return fallback;
  }
}
