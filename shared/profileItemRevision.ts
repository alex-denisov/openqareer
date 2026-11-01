/**
 * Profile list sections a consultant proposal may target item by item
 * (owner, 01.11): rewrite a field, add an item or remove one. Every change
 * waits for the candidate's «Принять».
 */
export const PROFILE_ITEM_SECTIONS = [
  'education',
  'projects',
  'certifications',
  'languages',
  'courses',
  'achievements',
] as const;

export type ProfileItemSection = (typeof PROFILE_ITEM_SECTIONS)[number];

export const PROFILE_ITEM_OPERATIONS = ['update', 'add', 'remove'] as const;

export type ProfileItemOperation = (typeof PROFILE_ITEM_OPERATIONS)[number];

/** Text fields the consultant may write, per section; links and ids stay the candidate's. */
export const PROFILE_ITEM_FIELDS = {
  education: ['institution', 'qualification', 'description', 'startDate', 'endDate'],
  projects: ['name', 'description', 'employer', 'startDate', 'endDate'],
  certifications: ['name', 'issuer', 'issuedAt', 'expiresAt'],
  languages: ['name', 'cefr'],
  courses: ['name', 'provider', 'institution'],
  achievements: ['kind', 'title', 'issuer', 'role', 'description', 'date'],
} as const satisfies Record<ProfileItemSection, readonly string[]>;

export const ALL_PROFILE_ITEM_FIELDS = [
  ...new Set(Object.values(PROFILE_ITEM_FIELDS).flat()),
] as readonly string[];

/** A new item is useless without these fields. */
export const PROFILE_ITEM_REQUIRED_ON_ADD: Record<ProfileItemSection, readonly string[]> = {
  education: ['institution'],
  projects: ['name'],
  certifications: ['name'],
  languages: ['name'],
  courses: ['name'],
  achievements: ['kind', 'title'],
};

export const PROFILE_ITEM_SECTION_LABEL: Record<ProfileItemSection, string> = {
  education: 'Образование',
  projects: 'Проекты',
  certifications: 'Сертификаты',
  languages: 'Языки',
  courses: 'Курсы',
  achievements: 'Достижения',
};

export function isProfileItemSection(section: string): section is ProfileItemSection {
  return (PROFILE_ITEM_SECTIONS as readonly string[]).includes(section);
}
