/**
 * Facts the candidate told the consultant land in the workplace they belong
 * to (C10, mockup 2: «Консультант предлагает правки блока «Опыт»»). Nothing
 * here writes: matching only proposes, and the candidate's «Принять» puts the
 * fact's id into the workplace bullets, so the fact keeps its own provenance.
 */
import type { CandidateMemory } from '../coach/coachApi';
import type { ResumeDraft, ResumeExperienceInput } from './resumeTypes';

export interface FactProposal {
  readonly experienceId: string;
  readonly fact: CandidateMemory;
}

export interface FactPlacement {
  readonly proposals: readonly FactProposal[];
  /** Facts no workplace could be chosen for: the candidate picks one or declines. */
  readonly pending: readonly CandidateMemory[];
}

/** What a workplace bullet can be; a gap or a preference is not resume material. */
const PLACEABLE_DOMAINS: ReadonlySet<CandidateMemory['domain']> = new Set([
  'responsibility',
  'outcome',
  'role-evidence',
  'skill',
]);
const CONVERSATION_ORIGINS = new Set(['candidate', 'consultant']);

/** Words that name a kind of company, not the company: they never place a fact. */
const GENERIC_EMPLOYER_WORDS = new Set(
  (
    'enterprise services service group company platform solutions technologies technology ' +
    'systems digital international holding berhad limited ltd llc inc corp corporation ' +
    'university corporate institution financial public cloud energy iaas paas saas labs lab ' +
    'top-tier tier consulting partners global ооо пао группа компания холдинг'
  ).split(' '),
);
const MIN_TOKEN_LETTERS = 4;

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/gu, 'е');
}

function wordsOf(text: string): string[] {
  return normalized(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Russian declines names («Россетях Цифры»): a token matches by its stem. */
function stemOf(token: string): string {
  return token.slice(0, Math.max(MIN_TOKEN_LETTERS, token.length - 2));
}

function distinctiveTokens(employer: string): string[] {
  return wordsOf(employer).filter(
    (token) => token.length >= MIN_TOKEN_LETTERS && !GENERIC_EMPLOYER_WORDS.has(token),
  );
}

/**
 * The name's head («Россети» of «Россети Цифра») is enough; a later word
 * alone is not, because «цифра» is also an ordinary word.
 */
function mentionsEmployer(statementWords: readonly string[], employer: string): boolean {
  const [head, ...rest] = distinctiveTokens(employer);
  if (!head) return false;
  const has = (token: string) => statementWords.some((word) => word.startsWith(stemOf(token)));
  return has(head) || (rest.length > 0 && rest.every(has));
}

function yearOf(value: string | undefined): number | undefined {
  const match = /(?:19|20)\d{2}/u.exec(value ?? '');
  return match ? Number(match[0]) : undefined;
}

function coversYear(entry: ResumeExperienceInput, year: number, currentYear: number): boolean {
  const start = yearOf(entry.startDate);
  const end = entry.current ? currentYear : (yearOf(entry.endDate) ?? start);
  return start !== undefined && end !== undefined && start <= year && year <= end;
}

function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Capitalised words past the first one: «ВКТех», «Россети» in «Когда я пришёл в Россети». */
function properNames(statement: string): string[] {
  const words = statement
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return words
    .slice(1)
    .filter((word) => /^\p{Lu}/u.test(word))
    .map(normalized)
    .filter((word) => word.length >= MIN_TOKEN_LETTERS && !GENERIC_EMPLOYER_WORDS.has(word));
}

/**
 * LinkedIn may call a place «Enterprise Public Cloud Platform» while the
 * candidate says «ВКТех». Names from the facts the candidate already put into
 * a place point the next facts there; a name two places share points nowhere.
 */
function learnedPlaceNames(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): ReadonlyMap<string, readonly string[]> {
  const statements = new Map(
    memory
      .filter((item) => CONVERSATION_ORIGINS.has(item.provenance?.kind ?? ''))
      .map((item) => [item.id, item.statement]),
  );
  const namesByPlace = draft.experience.map((entry) => ({
    id: entry.id,
    names: new Set(entry.bulletMemoryIds.flatMap((id) => properNames(statements.get(id) ?? ''))),
  }));
  const placesOf = (name: string) => namesByPlace.filter((place) => place.names.has(name)).length;
  return new Map(
    namesByPlace.map((place) => [
      place.id,
      [...place.names].filter((name) => placesOf(name) === 1),
    ]),
  );
}

function namedByLearnedName(
  words: readonly string[],
  learned: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  const places = [...learned].filter(([, names]) =>
    names.some((name) => words.some((word) => word.startsWith(stemOf(name)))),
  );
  return onlyOne(places)?.[0];
}

function directMatch(
  fact: CandidateMemory,
  experience: readonly ResumeExperienceInput[],
  currentYear: number,
  learned: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  const words = wordsOf(fact.statement);
  const named = experience.filter((entry) => mentionsEmployer(words, entry.employer ?? ''));
  if (named.length > 0) return onlyOne(named)?.id;
  const byLearnedName = namedByLearnedName(words, learned);
  if (byLearnedName) return byLearnedName;
  const years = [...normalized(fact.statement).matchAll(/\b(?:19|20)\d{2}\b/gu)].map(Number);
  if (years.length === 0) return undefined;
  const covering = experience.filter((entry) =>
    years.every((year) => coversYear(entry, year, currentYear)),
  );
  return onlyOne(covering)?.id;
}

function linkedMemoryIds(draft: ResumeDraft): Set<string> {
  const lists = [
    draft.skills,
    draft.education,
    draft.courses,
    draft.tests,
    draft.recommendations,
    draft.languages,
    draft.certifications,
    draft.projects,
    draft.achievements,
  ];
  return new Set(
    [
      draft.candidate.aboutMemoryId,
      ...draft.experience.flatMap((entry) => [
        entry.chronologyMemoryId,
        entry.descriptionMemoryId,
        ...entry.bulletMemoryIds,
      ]),
      ...lists.flatMap((list) => (list ?? []).map((entry) => entry.evidenceMemoryId)),
    ].filter((id): id is string => Boolean(id)),
  );
}

/** Confirmed conversation facts that are not in the resume and were not declined. */
export function unplacedConversationFacts(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
): CandidateMemory[] {
  const linked = linkedMemoryIds(draft);
  const declined = new Set(draft.declinedFactIds ?? []);
  return memory.filter(
    (item) =>
      item.kind === 'fact' &&
      (item.status === 'confirmed' || item.status === 'corrected') &&
      CONVERSATION_ORIGINS.has(item.provenance?.kind ?? '') &&
      PLACEABLE_DOMAINS.has(item.domain) &&
      !linked.has(item.id) &&
      !declined.has(item.id),
  );
}

/**
 * Matches by the employer the fact names, or a name the candidate's own placed
 * facts gave the place, else by a year that falls into one workplace only. Nothing else: a fact's message is no guide, because one
 * pasted answer often covers several companies (29.10, the owner's facts).
 */
export function placeExperienceFacts(
  draft: ResumeDraft,
  memory: readonly CandidateMemory[],
  now: Date = new Date(),
): FactPlacement {
  const learned = learnedPlaceNames(draft, memory);
  const placed = unplacedConversationFacts(draft, memory).map((item) => ({
    item,
    experienceId: directMatch(item, draft.experience, now.getFullYear(), learned),
  }));
  return {
    proposals: placed.flatMap(({ item, experienceId }) =>
      experienceId ? [{ experienceId, fact: item }] : [],
    ),
    pending: placed.filter(({ experienceId }) => !experienceId).map(({ item }) => item),
  };
}

/**
 * Appends each accepted fact to its workplace bullets. A fact already listed
 * under another workplace moves, so it is never claimed twice.
 */
export function acceptFactPlacements(
  draft: ResumeDraft,
  placements: readonly { readonly experienceId: string; readonly factId: string }[],
): ResumeDraft {
  const target = new Map(placements.map((placement) => [placement.factId, placement.experienceId]));
  const experience = draft.experience.map((entry) => {
    const kept = entry.bulletMemoryIds.filter((id) => (target.get(id) ?? entry.id) === entry.id);
    const added = placements
      .filter(
        (placement) => placement.experienceId === entry.id && !kept.includes(placement.factId),
      )
      .map((placement) => placement.factId);
    return kept.length === entry.bulletMemoryIds.length && added.length === 0
      ? entry
      : { ...entry, bulletMemoryIds: [...new Set([...kept, ...added])] };
  });
  return { ...draft, experience };
}

/** Records the candidate's «Отклонить»: the fact stays in memory, it is only not offered again. */
export function declineFacts(draft: ResumeDraft, factIds: readonly string[]): ResumeDraft {
  return {
    ...draft,
    declinedFactIds: [...new Set([...(draft.declinedFactIds ?? []), ...factIds])],
  };
}
