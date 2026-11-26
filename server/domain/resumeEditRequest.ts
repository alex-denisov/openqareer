import {
  buildFactRewriteRequest,
  factRewriteDigest,
  rewriteSourceFacts,
  type RewriteMemory,
} from './experienceFactRewrite';
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

/**
 * Какую правку K6 поставить под ответом: пункт из нового факта беседы или, когда новых фактов
 * для места нет, новую формулировку первой строки места. `place` — место работы; пусто — выберет правка.
 */
export type ResumeEditRequest =
  | { readonly kind: 'fact'; readonly factId: string; readonly place: string }
  | { readonly kind: 'reword'; readonly experienceId: string; readonly place: string };

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

export function nameMatches(name: string, text: string): boolean {
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

/** Факт из готового и ещё действующего предложения консультанта: правку не надо ждать от модели. */
function proposedFact(
  source: ResumeEditSource,
  draft: ResumeDraft,
  placeIds: ReadonlySet<string> | null,
): string | null {
  const pending = draft.factRewriteProposal;
  if (!pending) return null;
  const request = buildFactRewriteRequest(draft, source.memory);
  if (pending.digest !== factRewriteDigest(request)) return null;
  const open = new Set(rewriteSourceFacts(draft, source.memory).map(({ id }) => id));
  const places = pending.proposal.places;
  for (const place of places) {
    if (placeIds && !placeIds.has(place.experienceId)) continue;
    for (const bullet of place.bullets) {
      const id = bullet.sourceFactIds.find((factId) => open.has(factId));
      if (id) return id;
    }
  }
  return null;
}

/** Готовая правка K6 по просьбе кандидата; `null` — просьбы нет или поправить нечего. */
export function resumeEditRequest(
  source: ResumeEditSource,
  message: string,
): ResumeEditRequest | null {
  const draft = source.resume?.draft;
  if (!draft || !asksResumeEdit(message)) return null;
  const named = namedPlaces(draft, message);
  const ids = named.length > 0 ? new Set(named.map(({ id }) => id)) : null;
  const place = named[0]?.employer ?? '';
  const factId = proposedFact(source, draft, ids);
  if (factId) return { kind: 'fact', factId, place };
  const lined = named.find((entry) => entry.bulletMemoryIds.length > 0);
  return lined ? { kind: 'reword', experienceId: lined.id, place: lined.employer ?? '' } : null;
}
