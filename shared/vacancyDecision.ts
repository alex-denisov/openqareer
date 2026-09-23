import type { VacancySkipReasonId } from './vacancySkipReasons';

/**
 * Решение кандидата по конкретной вакансии — «Сохранить» или «Пропустить с
 * причиной» (B248). Узкая таблица решений, отдельная от отклика (B165 /
 * `shared/vacancyApplication.ts`): решение «сохранить/пропустить» — это выбор
 * до отклика, а не факт о том, что кандидат ушёл на площадку. Архитектор
 * проектирует модель откликов с этапами (B251) на этих же кластерах, поэтому
 * решение живёт отдельной таблицей и не трогает `vacancy_applications`.
 */
export type VacancyDecisionStatus = 'saved' | 'skipped';

export interface VacancyDecision {
  readonly clusterId: string;
  readonly status: VacancyDecisionStatus;
  /** Заполнено только для `status: 'skipped'`. */
  readonly skipReasonId: VacancySkipReasonId | null;
  readonly decidedAt: string;
}
