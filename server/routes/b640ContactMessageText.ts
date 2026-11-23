import type { FastifyRequest } from 'fastify';
import type { B640ContactMessageKind } from '../../shared/b640ContactMessage';
import {
  acceptModelMessage,
  modelMessageRejection,
  shorteningCorrection,
  contactMessageWish,
  fallbackContactMessage,
  type ContactMessageFacts,
} from '../domain/b640ContactMessage';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { letterProfileText } from '../domain/letterProfile';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { filterUsablePitchFacts } from '../domain/vacancyPitchService';
import { candidateGenderFromName } from '../../shared/candidateGender';
import type { CoverLetterOutcome, CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
import { localizeRoles, roleTranslations, targetRolesRu } from '../vacancies/contactMessageRoles';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';

export interface MessageRecipient {
  readonly contactId: string | null;
  readonly recruiterId: string | null;
  readonly name: string;
  readonly company: string;
  readonly linkedinUrl: string | null;
  readonly relationship: string | null;
  /** Должность получателя из контакта; пусто — null. */
  readonly role: string | null;
}

interface TextInput {
  readonly candidateId: string;
  readonly kind: B640ContactMessageKind;
  readonly recipient: MessageRecipient;
  readonly vacancyId: string | null;
  /** B698: вторая вакансия той же компании из карточки компании — только для текста. */
  readonly alsoVacancyId?: string | null;
}

function vacancyOf(deps: RouteDeps, vacancyId: string | null): { title: string; company: string } | null {
  if (!vacancyId) return null;
  const cluster = deps.multiSourceEngine?.getActiveCluster?.(vacancyId);
  return cluster?.canonicalTitle ? { title: cluster.canonicalTitle, company: cluster.canonicalCompany ?? '' } : null;
}

/** B753: отказ ступени и непринятый текст — в журнал (без текста), иначе запасной текст не объяснить. */
/** B753: что проверяем в тексте модели — данные запроса, вид сообщения, английские названия целевых ролей. */
interface ContactCheck {
  readonly known: string;
  readonly kind: B640ContactMessageKind;
  readonly englishRoles: readonly string[];
}

const rejectionOf = (body: string | undefined, check: ContactCheck) =>
  modelMessageRejection(body, check.known, check.kind, check.englishRoles);

function logModelOutcome(request: FastifyRequest, outcome: CoverLetterOutcome, check: ContactCheck): void {
  if (outcome.failure) {
    request.log.warn({ ...outcome.failure, code: 'contact_message_stage_failed' }, 'contact-message-stage-failed');
  }
  const rejected = outcome.body || !outcome.failure ? rejectionOf(outcome.body, check) : null;
  if (!rejected) return;
  request.log.warn(
    { code: 'contact_message_model_rejected', reason: rejected, stage: outcome.stage ?? null, length: outcome.body?.length ?? 0 },
    'contact-message-model-rejected',
  );
}

/**
 * Вторая вакансия — только той же компании: у разных источников бывает один id кластера
 * (B698, prod: VK 55418 = Tata Capital), и чужая вакансия попадала в черновик знакомому.
 */
function sameCompany(
  vacancy: { title: string; company: string } | null,
  also: { title: string; company: string } | null,
): { title: string; company: string } | null {
  if (!vacancy || !also) return null;
  return candidateCompanyKey(also.company) === candidateCompanyKey(vacancy.company) ? also : null;
}

/** B753: отклонённый проверкой текст идёт следующей ступени цепочки, а не сразу в шаблон. */
function contactReview(check: ContactCheck, keepLong = false): (body: string) => readonly string[] {
  return (body) => {
    const reason = rejectionOf(body, check);
    return reason && !(keepLong && reason === 'too_long') ? [`contact_${reason}`] : [];
  };
}

/**
 * B753 (решение CPO 23.11): длинный текст сначала сокращает та же модель — свой текст с просьбой
 * и фактом; затем следующая ступень цепочки; шаблон — последним. По знакам мы не режем.
 */
async function askContactModel(
  writer: CoverLetterWriter,
  request: FastifyRequest,
  ask: CoverLetterWriteInput,
  check: ContactCheck,
): Promise<string | null> {
  const accept = (body: string | undefined) => acceptModelMessage(body, check.known, check.kind, check.englishRoles);
  const first = await writer.writeCoverLetter({ ...ask, review: contactReview(check, true) });
  logModelOutcome(request, first, check);
  if (!first.body || rejectionOf(first.body, check) !== 'too_long') return accept(first.body);
  const shorter = await writer.writeCoverLetter({
    ...ask, correction: shorteningCorrection(first.body), review: contactReview(check),
  });
  logModelOutcome(request, shorter, check);
  return accept(shorter.body);
}

/**
 * B753 (решение CPO 23.11): целевые роли — по-русски отдельной строкой запроса; профиль и прежние
 * должности идут к модели как есть. Английские названия — для проверки текста модели.
 */
function candidateRoles(deps: RouteDeps, candidateId: string, targetRole: string) {
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const titles = [...campaign.roles.value, ...campaign.autoRoles.map((role) => role.title)];
  const own = campaign.ownTitlesRu ?? {};
  const translations = roleTranslations(titles, own, targetRole);
  return {
    russian: targetRolesRu(titles, own, targetRole),
    english: Object.keys(translations),
    targetRole: localizeRoles(targetRole, translations),
  };
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
  const roles = candidateRoles(deps, input.candidateId, draft.targetRole ?? '');
  const profile = letterProfileText({ draft, facts: filterUsablePitchFacts(facts), withheldEvidenceIds: withheld });
  const vacancy = vacancyOf(deps, input.vacancyId);
  const also = sameCompany(vacancy, vacancyOf(deps, input.alsoVacancyId ?? null));
  const message: ContactMessageFacts = {
    kind: input.kind,
    recipientName: input.recipient.name,
    recipientCompany: input.recipient.company,
    targetRole: roles.targetRole,
    ...(roles.russian.length > 0 ? { targetRolesRu: roles.russian } : {}),
    ...(vacancy ? { vacancyTitle: vacancy.title, vacancyCompany: vacancy.company } : {}),
    ...(input.recipient.relationship ? { relationship: input.recipient.relationship } : {}),
    ...(input.recipient.role ? { recipientRole: input.recipient.role } : {}),
    ...(also && also.title !== vacancy?.title ? { alsoVacancyTitle: also.title } : {}),
  };
  const fallback = fallbackContactMessage(message);
  const writer = deps.contactMessageWriter ?? deps.coverLetterWriter; // B753: своя цепочка, GLM первым
  if (!writer || !profile.trim()) return fallback;
  const known = [
    profile, roles.targetRole, input.recipient.name, input.recipient.company, input.recipient.role ?? '',
    vacancy?.title ?? '', also?.title ?? '', draft.targetRole ?? '',
  ].join('\n');
  try {
    const gender = candidateGenderFromName(draft.candidate?.fullName);
    const ask: CoverLetterWriteInput = {
      profile,
      vacancy: { title: vacancy?.title ?? 'Личное сообщение', ...(vacancy?.company ? { company: vacancy.company } : {}) },
      ...(gender ? { gender } : {}),
      resumeAttached: false,
      chosenLanguage: 'ru',
      wish: contactMessageWish(message),
    };
    const check: ContactCheck = { known, kind: input.kind, englishRoles: roles.english };
    return (await askContactModel(writer, request, ask, check)) ?? fallback;
  } catch (error) {
    request.log.warn({ err: error }, 'contact-message-writer-failed');
    return fallback;
  }
}
