import { vacancySourceLabels } from '../../../shared/vacancySourceLabel';
import type { MatchedVacancyItem } from '../coach/cabinetTypes';

/**
 * Куда ведёт «Открыть»: на площадку по имени, если оно короткое, иначе просто
 * «на сайте». Голое «Открыть» владелец не понял (2026-09-20) — и в таблице
 * вакансий, и в очереди «Поиска» (B236).
 */
export function openTargetLabel(sources: MatchedVacancyItem['cluster']['sources']): string {
  const name = vacancySourceLabels(sources)[0];
  return name && name.length <= 14 ? name : 'сайте';
}
