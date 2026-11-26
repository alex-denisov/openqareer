import { rewriteSourceFacts, type RewriteMemory } from './experienceFactRewrite';
import type { ResumeDraft } from './resumeDraft';

/**
 * B786: кандидат прямо просит консультанта поправить резюме («Поправь в резюме формулировку
 * опыта в Россети Цифра»). Под ответом встаёт готовая правка K6 из факта беседы, который ещё
 * не стоит в резюме, — та же карточка, что открывает «Поправить резюме» в разборе отказов.
 */
export interface ResumeEditSource {
  readonly memory: readonly RewriteMemory[];
  readonly resume?: { readonly draft: ResumeDraft } | null;
}

export interface ResumeEditRequest {
  /** Факт беседы, из которого собирается пункт резюме. */
  readonly factId: string;
  /** Место работы, куда встанет пункт; пусто — место выберет сама правка. */
  readonly place: string;
}

const RESUME = /резюм|\bresume\b|\bcv\b/iu;
const EDIT =
  /поправ|исправ|перепиш|переформулир|формулировк|улучш|усил|измен|отредакт|rewrite|reword|improve|\bedit\b|\bfix\b/iu;

/** Просьба о правке резюме, а не вопрос о нём. */
export function asksResumeEdit(message: string): boolean {
  return RESUME.test(message) && EDIT.test(message);
}

const normalize = (text: string) => text.toLowerCase().replace(/ё/gu, 'е');

/** Слово названия без окончания: «Цифра» узнаётся в «Цифре», «Сбербанка» — в «Сбербанке». */
function stem(word: string): string {
  return word.length >= 5 ? word.slice(0, -1) : word;
}

function nameMatches(name: string, text: string): boolean {
  const words = normalize(name)
    .replace(/\([^)]*\)/gu, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return false;
  const tokens = normalize(text).split(/[^\p{L}\p{N}]+/u);
  return words.every((word) => tokens.some((token) => token.startsWith(stem(word))));
}

type Entry = ResumeDraft['experience'][number];

/** Места работы, названные в просьбе. */
function namedPlaces(draft: ResumeDraft, message: string): readonly Entry[] {
  return draft.experience.filter((entry) => entry.employer && nameMatches(entry.employer, message));
}

/** Факт из уже готового предложения консультанта для этого места. */
function proposedFact(
  draft: ResumeDraft,
  placeIds: ReadonlySet<string> | null,
  open: ReadonlySet<string>,
): string | null {
  const places = draft.factRewriteProposal?.proposal.places ?? [];
  for (const place of places) {
    if (placeIds && !placeIds.has(place.experienceId)) continue;
    for (const bullet of place.bullets) {
      const id = bullet.sourceFactIds.find((factId) => open.has(factId));
      if (id) return id;
    }
  }
  return null;
}

/** Готовая правка K6 по просьбе кандидата; `null` — просьбы нет или ставить в резюме нечего. */
export function resumeEditRequest(
  source: ResumeEditSource,
  message: string,
): ResumeEditRequest | null {
  const draft = source.resume?.draft;
  if (!draft || !asksResumeEdit(message)) return null;
  const facts = rewriteSourceFacts(draft, source.memory);
  if (facts.length === 0) return null;
  const open = new Set(facts.map(({ id }) => id));
  const named = namedPlaces(draft, message);
  if (named.length === 0) {
    const factId = proposedFact(draft, null, open);
    return factId ? { factId, place: '' } : null;
  }
  const place = named[0]?.employer ?? '';
  const fromProposal = proposedFact(draft, new Set(named.map(({ id }) => id)), open);
  if (fromProposal) return { factId: fromProposal, place };
  const said = facts.find(({ statement }) =>
    named.some(({ employer }) => nameMatches(employer ?? '', statement)),
  );
  return said ? { factId: said.id, place } : null;
}
