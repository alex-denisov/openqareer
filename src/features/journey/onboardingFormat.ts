/** Work format controls shared by the role/region confirmation steps. */
export const ONBOARDING_FORMAT_OPTIONS = [
  'Полная занятость',
  'Контракт / interim',
  'Консультирование',
] as const;

export type OnboardingFormat = (typeof ONBOARDING_FORMAT_OPTIONS)[number];
