import type { ApplicationStage } from '../../shared/applicationStage';
import type { RejectionReviewChecks } from '../../shared/rejectionReview';

/** Отклик позже стольких дней после публикации вакансии считается поздним. */
export const LATE_APPLICATION_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** hh.ru пишет рубли как RUR. */
const CURRENCY_ALIASES: Readonly<Record<string, string>> = { RUR: 'RUB' };

export interface ReviewCheckApplication {
  readonly stage: ApplicationStage;
  readonly appliedAt: string | null;
  /** Дата публикации вакансии из пула; `null` — вакансии в пуле уже нет. */
  readonly publishedAt: string | null;
  /** Верх вилки вакансии; `null` — вилка не указана. */
  readonly salaryTo: number | null;
  readonly salaryCurrency: string | null;
}

export interface SalaryFloor {
  readonly amount: number;
  readonly currency: string;
}

function currencyOf(code: string | null): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return CURRENCY_ALIASES[upper] ?? upper;
}

function isLate(application: ReviewCheckApplication): boolean {
  if (!application.appliedAt || !application.publishedAt) return false;
  const gap = Date.parse(application.appliedAt) - Date.parse(application.publishedAt);
  return Number.isFinite(gap) && gap > LATE_APPLICATION_DAYS * DAY_MS;
}

function belowFloor(application: ReviewCheckApplication, floor: SalaryFloor): boolean {
  return (
    application.salaryTo !== null &&
    currencyOf(application.salaryCurrency) === currencyOf(floor.currency) &&
    application.salaryTo < floor.amount
  );
}

/**
 * B645: три проверки экрана «Мало данных» — им не нужен порог в 20 откликов.
 * Считаются по отправленным откликам; без ожиданий по деньгам проверки вилок нет.
 */
export function buildReviewChecks(
  applications: readonly ReviewCheckApplication[],
  floor: SalaryFloor | null,
): RejectionReviewChecks {
  const sent = applications.filter((application) => application.stage !== 'saved');
  const total = sent.length;
  const since = sent
    .flatMap((application) => (application.appliedAt ? [application.appliedAt] : []))
    .reduce<string | null>((min, at) => (min === null || at < min ? at : min), null);
  return {
    since,
    unfinished: {
      count: sent.filter((application) => application.stage === 'applied').length,
      total,
    },
    salaryBelow: floor
      ? {
          count: sent.filter((application) => belowFloor(application, floor)).length,
          total,
          floor: floor.amount,
          currency: currencyOf(floor.currency) ?? 'RUB',
        }
      : null,
    late: { count: sent.filter(isLate).length, total },
  };
}
