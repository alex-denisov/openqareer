import type { MatchedVacancyItem } from '../coach/cabinetTypes';

type VacancyRef = Pick<MatchedVacancyItem['cluster'], 'canonicalTitle' | 'canonicalCompany'>;

/** The question «Обсудить» hands to the consultant (mockup 4), passed the same
 *  way as the Today decision's `coachPrompt` (1adf5913). */
export function vacancyConsultantPrompt(cluster: VacancyRef): string {
  const company = cluster.canonicalCompany?.trim();
  const opener = company ? `Почему «${company}» подходит?` : 'Почему эта вакансия подходит?';
  return `${opener} Разбери вакансию «${cluster.canonicalTitle}»: роль, уровень, гео, деньги, неподтверждённые требования и круг связей.`;
}
