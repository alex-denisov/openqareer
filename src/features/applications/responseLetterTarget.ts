import type { VacancyLetterTarget } from '../vacancies/VacancyLetterScreen';
import type { ApplicationView } from './applicationsApi';

/**
 * B631: «Прикрепить» in a response card prepares the letter for the vacancy of that response.
 * The approval finds the same card by vacancy and links the letter and the resume to it.
 */
export function responseLetterTarget(application: ApplicationView): VacancyLetterTarget | null {
  if (!application.clusterId) return null;
  const vacancy = application.vacancy;
  return {
    id: application.clusterId,
    canonicalTitle: vacancy?.title ?? 'Вакансия без названия',
    canonicalCompany: vacancy?.companyHidden ? '' : (vacancy?.company ?? ''),
    sources: vacancy?.source ? [{ sourceName: vacancy.source }] : [],
    descriptionSummary: '',
    primaryUrl: vacancy?.url ?? '',
  };
}
