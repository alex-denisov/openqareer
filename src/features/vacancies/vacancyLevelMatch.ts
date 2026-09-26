import type { VacancyLevelMatch } from '../../../shared/vacancyMatchOrder';

export function vacancyLevelMatchLabel(match: VacancyLevelMatch): string {
  if (match === 'match') return 'Уровень совпадает';
  if (match === 'below') return 'Вакансия ниже целевого уровня';
  if (match === 'above') return 'Вакансия выше целевого уровня';
  return 'Уровень не распознан';
}
