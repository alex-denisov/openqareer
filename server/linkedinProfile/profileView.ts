import {
  LINKEDIN_SECTIONS,
  LINKEDIN_VARIANTS_MAX,
  type LinkedinOffer,
  type LinkedinPlace,
  type LinkedinSectionView,
} from '../../shared/b640LinkedinProfile';
import type { ProfileCurrent } from './profileCurrent';
import type { SectionSuggestions } from './sectionSuggestions';

export interface OfferMarks {
  readonly done: ReadonlyMap<string, string>;
  readonly variants: ReadonlyMap<string, readonly string[]>;
}

/** Предложение по ключу: первый текст и варианты «Предложить заново», всего не больше трёх. */
export function offerOf(key: string, base: string | null | undefined, marks: OfferMarks): LinkedinOffer | null {
  const variants = [...(base ? [base] : []), ...(marks.variants.get(key) ?? [])].slice(0, LINKEDIN_VARIANTS_MAX);
  if (variants.length === 0) return null;
  return { key, variants, doneAt: marks.done.get(key) ?? null };
}

function places(current: ProfileCurrent, suggestions: SectionSuggestions, marks: OfferMarks): LinkedinPlace[] {
  const items = new Map((suggestions.experience?.items ?? []).map((item) => [item.id, item.text]));
  return current.places.map((place) => ({
    ...place,
    offer: offerOf(`experience:${place.id}`, items.get(place.id), marks),
  }));
}

/** Семь разделов макета a03 по порядку; предложения только у заголовка, «О себе», опыта и навыков. */
export function profileSections(
  current: ProfileCurrent,
  suggestions: SectionSuggestions,
  marks: OfferMarks,
): LinkedinSectionView[] {
  return LINKEDIN_SECTIONS.map((id): LinkedinSectionView => {
    if (id === 'experience') return { id, current: null, offer: null, places: places(current, suggestions, marks) };
    const suggested = id === 'headline' || id === 'about' || id === 'skills';
    return { id, current: current.lines[id], offer: suggested ? offerOf(id, suggestions[id]?.text, marks) : null };
  });
}

/** Тексты, которые кандидат уже видел по ключу: новый вариант их не повторяет. */
export function shownTexts(key: string, suggestions: SectionSuggestions, marks: OfferMarks): string[] {
  const placeId = key.startsWith('experience:') ? key.slice('experience:'.length) : null;
  const base = placeId
    ? suggestions.experience?.items?.find((item) => item.id === placeId)?.text
    : suggestions[key as 'headline' | 'about' | 'skills']?.text;
  return [...(base ? [base] : []), ...(marks.variants.get(key) ?? [])];
}
