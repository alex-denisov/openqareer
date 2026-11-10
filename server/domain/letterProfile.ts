import type { ResumeDraft, ResumeExperienceInput } from './resumeDraft';
import { isStructuredRecordStatement } from './letterResults';
import { filterUsablePitchFacts, type VacancyPitchInputFact } from './vacancyPitchService';

/**
 * Весь мастер-профиль обычным текстом (B601). Письма, которые принял владелец, написаны по полному
 * профилю и резюме: выжимка из семи фактов таких писем не даёт. Контакты, имя кандидата и чужие
 * рекомендации в модель не идут: письму они не нужны, подпись ставит система. Контакты вычищаются и из
 * свободного текста; чужое имя внутри фразы кандидата так не распознать.
 */
export const MAX_LETTER_PROFILE_CHARS = 40_000;

export interface LetterProfileInput {
  readonly draft: ResumeDraft;
  readonly facts: readonly VacancyPitchInputFact[];
  /** Закрытые факты: всё, что на них опирается, в модель не идёт. */
  readonly withheldEvidenceIds?: ReadonlySet<string>;
}

const CONTACT_PATTERNS: readonly RegExp[] = [
  /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.\p{L}{2,}/gu,
  /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|wa\.me|linkedin\.com|vk\.com|instagram\.com|facebook\.com)\/[^\s,;)]+/giu,
  /(?<![\p{L}\d])@[\p{L}\d_.]{3,}/gu,
];
const PHONE = /(?<![\d.,])(?:\+\d[\d\s().-]{8,}\d|[78][\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})(?!\d)/gu;
const MIN_PHONE_DIGITS = 10;

function withoutContacts(text: string): string {
  const cleared = CONTACT_PATTERNS.reduce((rest, pattern) => rest.replace(pattern, ' '), text);
  return cleared.replace(PHONE, (match) => (match.replace(/\D/gu, '').length >= MIN_PHONE_DIGITS ? ' ' : match));
}

function visibleItems<T extends { readonly evidenceMemoryId?: string }>(
  items: readonly T[] | undefined,
  withheld: ReadonlySet<string>,
): readonly T[] {
  return (items ?? []).filter((item) => !item.evidenceMemoryId || !withheld.has(item.evidenceMemoryId));
}

function line(...parts: readonly (string | number | undefined)[]): string {
  return parts.flatMap((part) => (part === undefined || part === '' ? [] : [String(part)])).join(' | ');
}

function period(start?: string, end?: string, current?: boolean): string | undefined {
  const finish = current ? 'now' : end;
  if (!start) return finish;
  return finish ? `${start} — ${finish}` : start;
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length > 0 ? [title, ...lines, ''] : [];
}

/**
 * B639: маску для LinkedIn («Enterprise Energy IT Services») письмо не называет, если кандидат назвал
 * компанию сам. Название держится на подтверждённом факте: удалённый факт возвращает название профиля.
 */
function employerOf(
  place: ResumeExperienceInput,
  usable: ReadonlyMap<string, string>,
): string | undefined {
  const named = place.employerRealName?.trim();
  const fact = place.employerNameMemoryId ? usable.get(place.employerNameMemoryId) : undefined;
  // Кандидат сменил работодателя у места: ответ был о прежней маске и к новому названию не относится.
  const sameMask = Boolean(place.employer && fact?.includes(`«${place.employer.trim()}»`));
  return named && sameMask ? named : place.employer;
}

/**
 * B639: the mask the candidate named is replaced everywhere in the letter profile, not only in the
 * place heading. On 10.11 the projects, the about text and the notes still carried
 * «Corporate University of a Top-Tier …», and the letter to Sber lost the Sber background.
 */
function realEmployerNames(
  draft: ResumeDraft,
  usable: ReadonlyMap<string, string>,
): (line: string) => string {
  const names = new Map(
    draft.experience.flatMap((place) => {
      const mask = place.employer?.trim();
      const named = employerOf(place, usable);
      return mask && named && named !== place.employer ? [[mask, named] as const] : [];
    }),
  );
  const masks = [...names.keys()].sort((left, right) => right.length - left.length);
  return (line) => masks.reduce((text, mask) => text.split(mask).join(names.get(mask)!), line);
}

/** B639: названия мест кандидата для письма, настоящие вместо масок. */
export function letterEmployerNames<T extends VacancyPitchInputFact>(
  draft: ResumeDraft,
  facts: readonly T[],
): string[] {
  const usable = new Map(filterUsablePitchFacts(facts).map((fact) => [fact.id, fact.statement.trim()]));
  return draft.experience.flatMap((place) => {
    const name = employerOf(place, usable)?.trim();
    return name ? [name] : [];
  });
}

function experienceLines(
  place: ResumeExperienceInput,
  usable: ReadonlyMap<string, string>,
): string[] {
  const evidence = [place.descriptionMemoryId, ...place.bulletMemoryIds];
  const bullets = evidence.flatMap((id) => {
    const statement = id ? usable.get(id) : undefined;
    return statement ? [`- ${statement}`] : [];
  });
  return [
    `## ${line(place.title, employerOf(place, usable), place.location, period(place.startDate, place.endDate, place.current))}`,
    ...bullets,
    '',
  ];
}

function linkedIds(draft: ResumeDraft): Set<string> {
  const evidence = [
    ...draft.experience.flatMap((place) => [
      place.chronologyMemoryId,
      place.descriptionMemoryId,
      place.employerNameMemoryId,
      ...place.bulletMemoryIds,
    ]),
    ...[
      draft.projects,
      draft.skills,
      draft.education,
      draft.courses,
      draft.tests,
      draft.languages,
      draft.certifications,
      draft.achievements,
      draft.recommendations,
    ]
      .flatMap((items) => (items ?? []) as readonly { readonly evidenceMemoryId?: string }[])
      .map((item) => item.evidenceMemoryId),
    draft.candidate.aboutMemoryId,
  ];
  return new Set(evidence.flatMap((id) => (id ? [id] : [])));
}

/**
 * Заголовок уточнений говорит, что место работы у пунктов не указано. 10.11 на проде пункты без места
 * («операционный бюджет около 2 млрд ₽») модель приписывала соседней компании профиля в 4 письмах из 5.
 */
export const CANDIDATE_NOTES_TITLE =
  'УТОЧНЕНИЯ КАНДИДАТА К ПРОФИЛЮ (место работы у пунктов не указано: не приписывай пункт компании, если он сам её не называет)';

function normalized(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Импорт повторяет «о себе» и строку места работы («Директор, Россети Цифра · Москва») отдельными фактами. */
function repeatsProfile(statement: string, draft: ResumeDraft): boolean {
  const text = normalized(statement);
  if (draft.candidate.about && text === normalized(draft.candidate.about)) return true;
  return draft.experience.some((place) => {
    const record = normalized([place.title, place.employer, place.location].filter(Boolean).join(' '));
    return record.length > 0 && text === record;
  });
}

/**
 * Уточнение, которое письму не опора. 10.11 в профиль владельца шли 75 реплик беседы, среди них «Стало семь»,
 * «-», «Из семи сменились» без контекста и оговорки «цифра 80% была выдумана». Одобренные письма run-15
 * писались по девяти связным уточнениям: обрывок модель достраивает сама, а оговорка о том, чего не было,
 * подсказывает цифру, которой в профиле нет.
 */
const MIN_NOTE_WORDS = 4;
const NOT_A_BASIS_DOMAINS: ReadonlySet<string> = new Set(['gap']);

/** Короткая реплика с числом остаётся: «Команда 250+ человек» — факт, а «Стало семь» — нет. */
function isLetterBasis(fact: VacancyPitchInputFact): boolean {
  if (fact.domain && NOT_A_BASIS_DOMAINS.has(fact.domain)) return false;
  return /\d/u.test(fact.statement) || (fact.statement.match(/[\p{L}\p{N}]+/gu) ?? []).length >= MIN_NOTE_WORDS;
}

/** Факт вне мест работы: уточнение из беседы с консультантом, подтверждённые раньше импортированных. */
function noteFacts<T extends VacancyPitchInputFact>(draft: ResumeDraft, usable: readonly T[]): T[] {
  const linked = linkedIds(draft);
  const free = usable.filter((fact) =>
    !linked.has(fact.id) && isLetterBasis(fact) && !isStructuredRecordStatement(fact.statement) && !repeatsProfile(fact.statement, draft));
  const confirmed = free.filter((fact) => fact.status !== 'proposed');
  const imported = free.filter((fact) => fact.status === 'proposed');
  return [...confirmed, ...imported];
}

/** Уточнения письма в том порядке, в каком они идут в профиль: английскому письму их переводят (B639). */
export function letterNoteFacts<T extends VacancyPitchInputFact>(
  draft: ResumeDraft,
  facts: readonly T[],
): T[] {
  return noteFacts(draft, filterUsablePitchFacts(facts) as T[]);
}

/**
 * Английскому письму уточнения кандидата переводят: по-русски среди английского профиля модель их не
 * берёт и называет маску работодателя (B601, 10.11, LIYAN в одном прогоне из двух). Первые по порядку
 * профиля, не больше потолка: остальные остаются как есть.
 */
export const LETTER_NOTE_TRANSLATION_LIMIT = 30;

export function letterNotesToTranslate<T extends VacancyPitchInputFact>(
  draft: ResumeDraft,
  facts: readonly T[],
  language: string,
): T[] {
  if (language !== 'en') return [];
  return letterNoteFacts(draft, facts)
    .filter((fact) => /\p{Script=Cyrillic}/u.test(fact.statement))
    .slice(0, LETTER_NOTE_TRANSLATION_LIMIT);
}

function candidateNotes(draft: ResumeDraft, usable: readonly VacancyPitchInputFact[]): string[] {
  return noteFacts(draft, usable).map((fact) => `- ${fact.statement.trim()}`);
}

function draftSections(draft: ResumeDraft, withheld: ReadonlySet<string>): string[] {
  const projects = visibleItems(draft.projects, withheld);
  return [
    ...section('PROJECTS', projects.flatMap((item) => [
      `## ${line(item.name, item.employer, period(item.startDate, item.endDate, item.current))}`,
      ...(item.description ? [item.description] : []),
    ])),
    ...section('ACHIEVEMENTS', visibleItems(draft.achievements, withheld).map((item) =>
      line(item.title, item.issuer, item.date, item.description))),
    ...section('EDUCATION', visibleItems(draft.education, withheld).map((item) =>
      line(item.institution, item.qualification, period(item.startDate, item.endDate), item.description))),
    ...section('CERTIFICATIONS AND COURSES', [
      ...visibleItems(draft.certifications, withheld).map((item) => line(item.name, item.issuer, item.issuedAt)),
      ...visibleItems(draft.courses, withheld).map((item) => line(item.name, item.provider ?? item.institution, item.year)),
      ...visibleItems(draft.tests, withheld).map((item) => line(item.name, item.provider, item.score, item.year)),
    ]),
  ];
}

function joinedLine(title: string, values: readonly string[]): string[] {
  return values.length > 0 ? [`${title}: ${values.join(', ')}`, ''] : [];
}

/** Строки целиком: профиль не обрывается посреди факта, а хвост уточнений уходит первым. */
function withinLimit(lines: readonly string[]): string {
  const kept: string[] = [];
  let size = 0;
  for (const text of lines) {
    size += text.length + 1;
    if (size > MAX_LETTER_PROFILE_CHARS) break;
    kept.push(text);
  }
  return kept.join('\n').trim();
}

export function letterProfileText({
  draft,
  facts,
  withheldEvidenceIds = new Set<string>(),
}: LetterProfileInput): string {
  const { headline, about, aboutMemoryId, contact } = draft.candidate;
  const aboutVisible = about && !(aboutMemoryId && withheldEvidenceIds.has(aboutMemoryId));
  const usable = filterUsablePitchFacts(facts);
  const usableById = new Map(usable.map((fact) => [fact.id, fact.statement.trim()]));
  const notes = candidateNotes(draft, usable);
  return withinLimit([
    ...(headline ? [`HEADLINE: ${headline}`, ''] : []),
    ...(aboutVisible ? ['ABOUT:', about, ''] : []),
    ...(contact?.location ? [`LOCATION: ${contact.location}`, ''] : []),
    ...section('EXPERIENCE', draft.experience.flatMap((place) => experienceLines(place, usableById))),
    ...draftSections(draft, withheldEvidenceIds),
    ...joinedLine('LANGUAGES', visibleItems(draft.languages, withheldEvidenceIds).map((item) => [item.name, item.cefr ?? item.sourceLabel].filter(Boolean).join(' '))),
    ...joinedLine('SKILLS', visibleItems(draft.skills, withheldEvidenceIds).map((item) => item.name)),
    ...section(CANDIDATE_NOTES_TITLE, notes),
  ]
    .map(withoutContacts)
    .map(realEmployerNames(draft, usableById)));
}
