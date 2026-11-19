/** B692: разделы профиля LinkedIn «сейчас» и предложения по ним. На LinkedIn ничего не отправляется. */
export const LINKEDIN_SECTIONS = ['headline', 'about', 'experience', 'skills'] as const;
export type LinkedinSection = (typeof LINKEDIN_SECTIONS)[number];

export const LINKEDIN_CURRENT_SOURCES = ['archive', 'pdf', 'paste'] as const;
export type LinkedinCurrentSource = (typeof LINKEDIN_CURRENT_SOURCES)[number];

/** Заголовок и «О себе» — лимиты LinkedIn; опыт и навыки — разумный потолок на весь раздел. */
export const LINKEDIN_SECTION_LIMITS: Readonly<Record<LinkedinSection, number>> = {
  headline: 220,
  about: 2600,
  experience: 8000,
  skills: 2000,
};
export const LINKEDIN_SKILLS_MAX = 50;

export interface LinkedinSectionFact {
  readonly id: string;
  readonly text: string;
}
export interface LinkedinSectionCurrent {
  readonly text: string;
  readonly source: LinkedinCurrentSource;
  readonly capturedAt: string;
}
export interface LinkedinSectionSuggestion {
  readonly text: string;
  readonly facts: readonly LinkedinSectionFact[];
}
export interface LinkedinSectionView {
  readonly current: LinkedinSectionCurrent | null;
  readonly suggestion: LinkedinSectionSuggestion | null;
  readonly copiedAt: string | null;
  readonly pastedAt: string | null;
}
export type LinkedinProfileView = Readonly<Record<LinkedinSection, LinkedinSectionView>>;
