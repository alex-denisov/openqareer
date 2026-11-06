import type { ResumeDraft, ResumeExperienceInput, ResumeProjectInput } from './resumeDraft';
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
  /** Уже без фактов, которые кандидат снял с письма. */
  readonly facts: readonly VacancyPitchInputFact[];
  readonly includedWorkplaceIds: readonly string[];
  /** Факты, снятые с письма или закрытые: всё, что на них опирается, в модель не идёт. */
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

const employerKey = (name: string | undefined): string => (name ?? '').trim().toLocaleLowerCase();

/** Проект снятого места работы; у имени работодателя с оставшимся местом он остаётся. */
function isFromRemovedPlace(project: ResumeProjectInput, places: readonly ResumeExperienceInput[], included: ReadonlySet<string>): boolean {
  const same = places.filter((place) => employerKey(place.employer) === employerKey(project.employer));
  return same.length > 0 && same.every((place) => !included.has(place.id));
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

function experienceLines(place: ResumeExperienceInput, usable: ReadonlyMap<string, string>): string[] {
  const evidence = [place.descriptionMemoryId, ...place.bulletMemoryIds];
  const bullets = evidence.flatMap((id) => {
    const statement = id ? usable.get(id) : undefined;
    return statement ? [`- ${statement}`] : [];
  });
  return [
    `## ${line(place.title, place.employer, place.location, period(place.startDate, place.endDate, place.current))}`,
    ...bullets,
    '',
  ];
}

function linkedIds(draft: ResumeDraft): Set<string> {
  const evidence = [
    ...draft.experience.flatMap((place) => [place.chronologyMemoryId, place.descriptionMemoryId, ...place.bulletMemoryIds]),
    ...[draft.projects, draft.skills, draft.education, draft.courses, draft.tests, draft.languages, draft.certifications, draft.achievements, draft.recommendations]
      .flatMap((items) => (items ?? []) as readonly { readonly evidenceMemoryId?: string }[])
      .map((item) => item.evidenceMemoryId),
    draft.candidate.aboutMemoryId,
  ];
  return new Set(evidence.flatMap((id) => (id ? [id] : [])));
}

/** Факт вне мест работы: уточнение из беседы с консультантом, подтверждённые раньше импортированных. */
function candidateNotes(draft: ResumeDraft, usable: readonly VacancyPitchInputFact[]): string[] {
  const linked = linkedIds(draft);
  const free = usable.filter((fact) => !linked.has(fact.id) && !isStructuredRecordStatement(fact.statement));
  const confirmed = free.filter((fact) => fact.status !== 'proposed');
  const imported = free.filter((fact) => fact.status === 'proposed');
  return [...confirmed, ...imported].map((fact) => `- ${fact.statement.trim()}`);
}

function draftSections(draft: ResumeDraft, included: ReadonlySet<string>, withheld: ReadonlySet<string>): string[] {
  const projects = visibleItems(draft.projects, withheld).filter((item) => !isFromRemovedPlace(item, draft.experience, included));
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
  includedWorkplaceIds,
  withheldEvidenceIds = new Set<string>(),
}: LetterProfileInput): string {
  const { headline, about, aboutMemoryId, contact } = draft.candidate;
  const aboutVisible = about && !(aboutMemoryId && withheldEvidenceIds.has(aboutMemoryId));
  const usable = filterUsablePitchFacts(facts);
  const usableById = new Map(usable.map((fact) => [fact.id, fact.statement.trim()]));
  const included = new Set(includedWorkplaceIds);
  const places = draft.experience.filter((place) => included.has(place.id));
  const notes = candidateNotes(draft, usable);
  return withinLimit([
    ...(headline ? [`HEADLINE: ${headline}`, ''] : []),
    ...(aboutVisible ? ['ABOUT:', about, ''] : []),
    ...(contact?.location ? [`LOCATION: ${contact.location}`, ''] : []),
    ...section('EXPERIENCE', places.flatMap((place) => experienceLines(place, usableById))),
    ...draftSections(draft, included, withheldEvidenceIds),
    ...joinedLine('LANGUAGES', visibleItems(draft.languages, withheldEvidenceIds).map((item) => [item.name, item.cefr ?? item.sourceLabel].filter(Boolean).join(' '))),
    ...joinedLine('SKILLS', visibleItems(draft.skills, withheldEvidenceIds).map((item) => item.name)),
    ...section('УТОЧНЕНИЯ КАНДИДАТА К ПРОФИЛЮ', notes),
  ].map(withoutContacts));
}
