import type { FastifyRequest } from 'fastify';
import type { B640ContactMessageKind } from '../../shared/b640ContactMessage';
import {
  acceptModelMessage,
  modelMessageRejection,
  namesAnyCompany,
  shorteningCorrection,
  contactMessageWish,
  fallbackContactMessage,
  type ContactCheckOptions,
  type ContactMessageFacts,
} from '../domain/b640ContactMessage';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { headlineEmployers, shortRoleTitle } from '../domain/contactDisplay';
import { englishFallbackMessage } from '../domain/contactMessageStyle';
import { letterProfileText } from '../domain/letterProfile';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { filterUsablePitchFacts } from '../domain/vacancyPitchService';
import { candidateGenderFromName } from '../../shared/candidateGender';
import type { CoverLetterOutcome, CoverLetterWriteInput, CoverLetterWriter } from '../providers/coverLetterWriter';
import { contactMessageLanguage } from '../vacancies/contactMessageLanguage';
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
  /** B682: «Другой вариант» — пожелание и прежний текст к запросу модели. */
  readonly variantWish?: string;
}

interface MessageVacancy {
  readonly title: string;
  readonly company: string;
  /** B753: выжимка текста и место — только для выбора языка черновика. */
  readonly summary: string;
  readonly location: string;
}

function vacancyOf(deps: RouteDeps, vacancyId: string | null): MessageVacancy | null {
  if (!vacancyId) return null;
  const cluster = deps.multiSourceEngine?.getActiveCluster?.(vacancyId);
  if (!cluster?.canonicalTitle) return null;
  return {
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany ?? '',
    summary: cluster.descriptionSummary ?? '',
    location: cluster.canonicalLocation ?? '',
  };
}

/** B753: отказ ступени и непринятый текст — в журнал (без текста), иначе запасной текст не объяснить. */
/** B753: что проверяем в тексте модели — данные запроса, вид сообщения, английские названия целевых ролей. */
interface ContactCheck {
  readonly known: string;
  readonly kind: B640ContactMessageKind;
  readonly englishRoles: readonly string[];
  readonly options: ContactCheckOptions;
}

const rejectionOf = (body: string | undefined, check: ContactCheck) =>
  modelMessageRejection(body, check.known, check.kind, check.englishRoles, check.options);

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
function sameCompany(vacancy: MessageVacancy | null, also: MessageVacancy | null): MessageVacancy | null {
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
  const accept = (body: string | undefined) =>
    acceptModelMessage(body, check.known, check.kind, check.englishRoles, check.options);
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
function candidateRoles(deps: RouteDeps, candidateId: string, targetRole: string, language: 'en' | 'ru') {
  const campaign = readCampaign(deps.candidateStore, candidateId);
  const titles = [...campaign.roles.value, ...campaign.autoRoles.map((role) => role.title)];
  const own = campaign.ownTitlesRu ?? {};
  const translations = roleTranslations(titles, own, targetRole);
  const english = Object.keys(translations);
  if (language === 'en') return { named: english.slice(0, 3), english, targetRole };
  return {
    named: targetRolesRu(titles, own, targetRole),
    english,
    targetRole: localizeRoles(targetRole, translations),
  };
}

interface MessageContext {
  readonly vacancy: MessageVacancy | null;
  readonly also: MessageVacancy | null;
  readonly language: 'en' | 'ru';
  readonly roles: ReturnType<typeof candidateRoles>;
}

function messageFacts(input: TextInput, context: MessageContext): ContactMessageFacts {
  const { vacancy, also, roles } = context;
  return {
    kind: input.kind,
    recipientName: input.recipient.name,
    recipientCompany: input.recipient.company,
    targetRole: roles.targetRole,
    language: context.language,
    ...(roles.named.length > 0 ? { targetRoles: roles.named } : {}),
    ...(vacancy ? { vacancyTitle: vacancy.title, vacancyCompany: vacancy.company } : {}),
    ...(input.recipient.relationship ? { relationship: input.recipient.relationship } : {}),
    ...(input.recipient.role ? { recipientRole: shortRoleTitle(input.recipient.role) } : {}),
    ...(also && also.title !== vacancy?.title ? { alsoVacancyTitle: also.title } : {}),
  };
}

/** B753: компании из должности знакомого, кроме той, о которой сообщение. Рекрутёру не нужны. */
function otherCompanies(input: Pick<TextInput, 'kind' | 'recipient'>, vacancy: MessageVacancy | null): string[] {
  if (input.kind === 'recruiter') return [];
  const own = candidateCompanyKey(vacancy?.company || input.recipient.company);
  return headlineEmployers(input.recipient.role ?? '').filter((name) => candidateCompanyKey(name) !== own);
}

/** B753: сохранённый до правки черновик знакомому спрашивает о другой компании — продолжать его нельзя. */
export function draftNamesOtherCompany(
  deps: RouteDeps,
  input: Pick<TextInput, 'kind' | 'recipient' | 'vacancyId'>,
  text: string,
): boolean {
  return namesAnyCompany(text, otherCompanies(input, vacancyOf(deps, input.vacancyId)));
}

/** B753: язык черновика по контакту и вакансии; английскому черновику — английский шаблон. */
function messageContext(deps: RouteDeps, input: TextInput, targetRole: string): MessageContext {
  const vacancy = vacancyOf(deps, input.vacancyId);
  const also = sameCompany(vacancy, vacancyOf(deps, input.alsoVacancyId ?? null));
  const language = contactMessageLanguage(input.recipient.name, vacancy);
  return { vacancy, also, language, roles: candidateRoles(deps, input.candidateId, targetRole, language) };
}

/** Текст модели (`null` — не ответила или не принята) и шаблон на данных профиля. */
interface WrittenMessage {
  readonly model: string | null;
  readonly fallback: string;
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
  const { model, fallback } = await writeMessage(deps, request, input);
  return model ?? fallback;
}

/** B682: другой вариант пишет только модель — шаблон дал бы тот же текст. */
export async function writeContactMessageVariant(
  deps: RouteDeps,
  request: FastifyRequest,
  input: TextInput & { readonly variantWish: string },
): Promise<string | null> {
  return (await writeMessage(deps, request, input)).model;
}

async function writeMessage(
  deps: RouteDeps,
  request: FastifyRequest,
  input: TextInput,
): Promise<WrittenMessage> {
  const snapshot = deps.candidateStore.getSnapshot(input.candidateId);
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  const facts = snapshot.memory ?? [];
  const withheld = new Set(facts.filter((fact) => fact.sensitive === true).map((fact) => fact.id));
  const profile = letterProfileText({ draft, facts: filterUsablePitchFacts(facts), withheldEvidenceIds: withheld });
  const context = messageContext(deps, input, draft.targetRole ?? '');
  const { vacancy, also, roles, language } = context;
  const message = messageFacts(input, context);
  const fallback = language === 'en' ? englishFallbackMessage(message) : fallbackContactMessage(message);
  const writer = deps.contactMessageWriter ?? deps.coverLetterWriter; // B753: своя цепочка, GLM первым
  if (!writer || !profile.trim()) return { model: null, fallback };
  const known = [
    profile, roles.targetRole, input.recipient.name, input.recipient.company, message.recipientRole ?? '',
    vacancy?.title ?? '', vacancy?.company ?? '', also?.title ?? '', draft.targetRole ?? '',
  ].join('\n');
  try {
    const gender = candidateGenderFromName(draft.candidate?.fullName);
    const ask: CoverLetterWriteInput = {
      profile,
      vacancy: { title: vacancy?.title ?? 'Личное сообщение', ...(vacancy?.company ? { company: vacancy.company } : {}) },
      ...(gender ? { gender } : {}),
      resumeAttached: false,
      chosenLanguage: language,
      wish: [contactMessageWish(message), input.variantWish].filter(Boolean).join('\n'),
    };
    const options: ContactCheckOptions = {
      withoutVacancy: !vacancy, language, recipientName: input.recipient.name, relationship: input.recipient.relationship,
      otherCompanies: otherCompanies(input, vacancy),
    };
    const check: ContactCheck = { known, kind: input.kind, englishRoles: roles.english, options };
    return { model: await askContactModel(writer, request, ask, check), fallback };
  } catch (error) {
    request.log.warn({ err: error }, 'contact-message-writer-failed');
    return { model: null, fallback };
  }
}
