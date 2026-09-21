import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

/**
 * Куда ведёт «Открыть»: на площадку по имени, если оно короткое, иначе просто
 * «на сайте». Голое «Открыть» владелец не понял (2026-09-20) — и в таблице
 * вакансий, и в очереди «Поиска» (B236).
 */
export function openTargetLabel(sources: MatchedVacancyItem['cluster']['sources']): string {
  // «hh.ru (страница поиска)» — площадка та же: уточнение в скобках в кнопку
  // не идёт, иначе прод показывал «Открыть на сайте» у каждой вакансии hh.ru.
  const name = vacancySourceLabels(sources)[0]?.replace(/\s*\(.*\)\s*$/u, '');
  return name && name.length <= 14 ? name : 'сайте';
}
