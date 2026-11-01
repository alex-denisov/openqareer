/**
 * The language the consultant writes experience bullets in (owner, 01.11):
 * the profile's own language, never the interface's and never the
 * conversation's. An English LinkedIn profile gets English bullets even when
 * the facts came from a Russian conversation.
 *
 * Decided by code from the letters of the profile's own text: the summary and
 * every experience entry. A profile with a clear language writes every place
 * in it; a mixed one follows each entry; a profile with no text of its own
 * stays Russian, as before.
 */
import type { ResumeDraft } from './resumeDraft';

export type ProfileLanguage = 'en' | 'ru';

const MIN_LETTERS = 12;
/** Share of one alphabet that makes a text that language: Latin terms in Russian text stay Russian. */
const CLEAR_SHARE = 0.75;
const DEFAULT_LANGUAGE: ProfileLanguage = 'ru';

export function textLanguage(text: string): ProfileLanguage | undefined {
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const letters = cyrillic + latin;
  if (letters < MIN_LETTERS) return undefined;
  if (latin / letters >= CLEAR_SHARE) return 'en';
  if (cyrillic / letters >= CLEAR_SHARE) return 'ru';
  return undefined;
}

function entryText(
  entry: ResumeDraft['experience'][number],
  statements: ReadonlyMap<string, string>,
): string {
  return [
    entry.title,
    entry.descriptionMemoryId ? statements.get(entry.descriptionMemoryId) : undefined,
    ...entry.bulletMemoryIds.map((id) => statements.get(id)),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Experience id → the language its new bullets are written in. */
export function placeLanguages(
  draft: ResumeDraft,
  statements: ReadonlyMap<string, string>,
): Map<string, ProfileLanguage> {
  const entries = draft.experience.map((entry) => ({
    id: entry.id,
    text: entryText(entry, statements),
  }));
  const profile = textLanguage(
    [draft.candidate.headline, draft.candidate.about, ...entries.map((entry) => entry.text)]
      .filter(Boolean)
      .join('\n'),
  );
  return new Map(
    entries.map((entry) => [entry.id, profile ?? textLanguage(entry.text) ?? DEFAULT_LANGUAGE]),
  );
}
