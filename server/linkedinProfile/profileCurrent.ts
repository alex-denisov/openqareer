import type { LinkedinSection } from '../../shared/b640LinkedinProfile';
import type { ResumeDraft } from '../domain/resumeDraft';

/**
 * B645 (a03): «сейчас» по разделам — короткие строки из данных, которые платформа взяла импортом
 * LinkedIn. Ручной вставки нет: без импорта LinkedIn экран предлагает импортировать профиль.
 */
export type CurrentDraft = Pick<
  ResumeDraft,
  'candidate' | 'experience' | 'education' | 'skills' | 'languages'
> & { readonly courses?: ResumeDraft['courses'] };

export interface CurrentPlace {
  readonly id: string;
  readonly label: string;
  readonly current: string | null;
}
export interface ProfileCurrent {
  readonly lines: Readonly<Record<Exclude<LinkedinSection, 'experience'>, string | null>>;
  readonly places: readonly CurrentPlace[];
}

const SEP = ' · ';
const NATIVE = /native|bilingual|родн/iu;

const clean = (value: string | undefined | null) => value?.replace(/\s+/gu, ' ').trim() || null;
const join = (parts: readonly (string | null | undefined)[]) =>
  parts.map((part) => clean(part)).filter(Boolean).join(SEP) || null;
const more = (line: string | null, rest: number) => (line && rest > 0 ? `${line}${SEP}ещё ${rest}` : line);
const period = (start?: string, end?: string) => (start || end ? [start, end].filter(Boolean).join(' — ') : null);

/** Первое предложение: на экране «сейчас» — строка, а не весь текст места работы. */
function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const match = /^.*?[.!?…](?=\s|$)/u.exec(text);
  return match ? match[0] : text;
}

function placeCurrent(place: CurrentDraft['experience'][number], statements: ReadonlyMap<string, string>): string | null {
  const ids = [...(place.descriptionMemoryId ? [place.descriptionMemoryId] : []), ...place.bulletMemoryIds];
  const first = ids.map((id) => statements.get(id)).find((text) => clean(text));
  return firstSentence(clean(first));
}

function education(draft: CurrentDraft): string | null {
  const [first, ...rest] = draft.education;
  if (!first) return null;
  return more(join([first.institution, first.qualification, period(first.startDate, first.endDate)]), rest.length);
}

function courses(draft: CurrentDraft): string | null {
  const [first, ...rest] = draft.courses ?? [];
  if (!first) return null;
  return more(join([first.name, first.year === undefined ? null : String(first.year)]), rest.length);
}

function languages(draft: CurrentDraft): string | null {
  const lines = draft.languages.flatMap((language) => {
    const name = clean(language.name);
    if (!name) return [];
    const level = language.sourceLabel && NATIVE.test(language.sourceLabel) ? 'родной' : language.cefr;
    return [level ? `${name} — ${level}` : name];
  });
  return lines.join(SEP) || null;
}

export function profileCurrent(draft: CurrentDraft, statements: ReadonlyMap<string, string>): ProfileCurrent {
  const skills = [...new Set((draft.skills ?? []).map((skill) => clean(skill.name)).filter(Boolean))];
  return {
    lines: {
      headline: clean(draft.candidate.headline),
      about: clean(draft.candidate.about),
      education: education(draft),
      courses: courses(draft),
      skills: skills.join(SEP) || null,
      languages: languages(draft),
    },
    places: draft.experience.flatMap((place) => {
      const label = join([place.employer, place.title]);
      return label ? [{ id: place.id, label, current: placeCurrent(place, statements) }] : [];
    }),
  };
}
