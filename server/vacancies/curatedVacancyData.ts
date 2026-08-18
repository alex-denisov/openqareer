import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { CURATED_PLATFORM_VACANCIES } from './curatedPlatformVacancies';
import { CURATED_TELEGRAM_VACANCIES } from './curatedTelegramVacancies';

export const CURATED_SOURCE_VACANCIES: Record<string, UnifiedVacancy[]> = {
  ...CURATED_PLATFORM_VACANCIES,
  ...CURATED_TELEGRAM_VACANCIES,
};
