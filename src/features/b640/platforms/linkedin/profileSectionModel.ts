import type { LinkedinOffer, LinkedinSection, LinkedinSectionView } from '../../../../../shared/b640LinkedinProfile';
import { pluralRu } from '../../../../../shared/pluralRu';

export const SECTION_TITLES: Readonly<Record<LinkedinSection, string>> = {
  headline: 'Заголовок',
  about: 'О себе',
  experience: 'Опыт',
  education: 'Образование',
  courses: 'Курсы и сертификаты',
  skills: 'Навыки',
  languages: 'Языки',
};

/** Предложения раздела: у «Опыта» — по местам работы. */
export function sectionOffers(section: LinkedinSectionView): LinkedinOffer[] {
  const own = section.offer ? [section.offer] : [];
  return [...own, ...(section.places ?? []).flatMap((place) => (place.offer ? [place.offer] : []))];
}

/** Ключи предложений, ещё не отмеченных «Выполнено». */
export function pendingKeys(sections: readonly LinkedinSectionView[]): string[] {
  return sections.flatMap(sectionOffers).filter((offer) => !offer.doneAt).map((offer) => offer.key);
}

/** «Изменить 4 раздела из 7»: раздел считается, пока в нём есть невыполненное предложение. */
export function changeTitle(sections: readonly LinkedinSectionView[]): string {
  const pending = sections.filter((section) => sectionOffers(section).some((offer) => !offer.doneAt)).length;
  // Предложений нет вовсе (модель не ответила) — это не «всё выполнено».
  if (!sections.some((section) => sectionOffers(section).length > 0)) return 'Предложений пока нет';
  if (pending === 0) return 'Все предложения выполнены';
  return `Изменить ${pluralRu(pending, ['раздел', 'раздела', 'разделов'])} из ${sections.length}`;
}

/** Отметки «Выполнено» сервера поверх разделов; данные не меняются на месте. */
export function withDone(
  sections: readonly LinkedinSectionView[],
  done: Readonly<Record<string, string>>,
): LinkedinSectionView[] {
  const mark = (offer: LinkedinOffer | null) => (offer && done[offer.key] ? { ...offer, doneAt: done[offer.key]! } : offer);
  return sections.map((section) => ({
    ...section,
    offer: mark(section.offer),
    ...(section.places ? { places: section.places.map((place) => ({ ...place, offer: mark(place.offer) })) } : {}),
  }));
}

/** Новый вариант на месте прежнего предложения. */
export function withOffer(sections: readonly LinkedinSectionView[], next: LinkedinOffer): LinkedinSectionView[] {
  const swap = (offer: LinkedinOffer | null) => (offer?.key === next.key ? next : offer);
  return sections.map((section) => ({
    ...section,
    offer: swap(section.offer),
    ...(section.places ? { places: section.places.map((place) => ({ ...place, offer: swap(place.offer) })) } : {}),
  }));
}
