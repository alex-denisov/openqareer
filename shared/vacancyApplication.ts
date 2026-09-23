/**
 * Ручной отклик кандидата (B165, срез 1, узлы 5, 6, 8, 9).
 *
 * Продукт не может увидеть отклик, отправленный на чужой площадке, — поэтому
 * он не изображает знание. Различаются ровно два состояния:
 *
 * - `opened` — кандидат ушёл на площадку по ссылке. Откликом это не считается
 *   ни в одном числе: открыть вакансию и откликнуться — разные события.
 * - `applied` — кандидат сам подтвердил, что откликнулся. Это его слово, и
 *   провенанс говорит это вслух (`confirmedBy: 'candidate'`), а не выдаёт
 *   подтверждение за наблюдение платформы.
 *
 * Снимок вакансии хранится вместе с откликом: запись выбывает из пула через
 * недели, а отклик и воронка обязаны пережить это выбывание.
 */

export type VacancyApplicationStatus = 'opened' | 'applied';

/** Кто подтвердил отклик. Пока только кандидат: автоматизации нет (узел 7). */
export type VacancyApplicationConfirmedBy = 'candidate';

export interface VacancyApplicationSnapshot {
  readonly title: string;
  readonly company: string;
  readonly url: string;
  readonly source: string;
  /**
   * B251, S2 — a manual card ("через рекрутера, компания скрыта") that
   * names no `company`: `true` says the field is deliberately empty, not
   * missing data.
   */
  readonly companyHidden?: boolean;
}

export interface VacancyApplication {
  readonly clusterId: string;
  readonly status: VacancyApplicationStatus;
  readonly vacancy: VacancyApplicationSnapshot;
  readonly openedAt: string | null;
  readonly appliedAt: string | null;
  /** `null`, пока отклик не подтверждён. */
  readonly confirmedBy: VacancyApplicationConfirmedBy | null;
}

/** Подтверждённые отклики — единственное, что имеет право считаться откликом. */
export function countConfirmedApplications(
  applications: readonly VacancyApplication[],
): number {
  return applications.filter((application) => application.status === 'applied').length;
}

/** Сколько вакансий кандидат открыл на площадке — отдельная ступень воронки. */
export function countOpenedApplications(
  applications: readonly VacancyApplication[],
): number {
  return applications.length;
}
