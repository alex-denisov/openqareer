import type {
  LinkedinCurrentSource,
  LinkedinSection,
  LinkedinSectionCurrent,
} from '../../../../../shared/b640LinkedinProfile';
import { formatDay } from '../format';

export const PROFILE_SECTIONS: readonly { readonly id: LinkedinSection; readonly title: string }[] = [
  { id: 'headline', title: 'Заголовок' },
  { id: 'about', title: 'О себе' },
  { id: 'experience', title: 'Опыт' },
  { id: 'skills', title: 'Навыки' },
];

export const LINKEDIN_OWN_PROFILE_URL = 'https://www.linkedin.com/in/me/';

const SOURCE_TEXT: Readonly<Record<LinkedinCurrentSource, string>> = {
  paste: 'вставлено вами',
  archive: 'из архива LinkedIn от',
  pdf: 'из PDF от',
};

/** «Сейчас · вставлено вами 19 ноября»: откуда текст и когда его получили. */
export function currentCaption(current: LinkedinSectionCurrent): string {
  const day = formatDay(current.capturedAt);
  return ['Сейчас', [SOURCE_TEXT[current.source], day].filter(Boolean).join(' ')].join(' · ');
}
