import type { RejectionReviewChecks } from '../../../../../shared/rejectionReview';
import type { IconName } from '../../kit';
import { conditionsPath } from '../../career/careerPaths';
import { buildNodePath } from '../../routes';
import { longDate, pluralRu } from './responseRow';

/** Проверка экрана «Мало данных» (O7c): что сделать и почему. */
export interface CheckCard {
  readonly key: 'unfinished' | 'salary' | 'late';
  readonly title: string;
  readonly why: string;
  readonly action: string;
  readonly icon: IconName;
  /** Куда ведёт кнопка. */
  readonly to: string;
}

const CURRENCY_SIGNS: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€' };

function money(amount: number, currency: string): string {
  return `${amount.toLocaleString('ru-RU').replace(/\s/gu, ' ')} ${CURRENCY_SIGNS[currency] ?? currency}`;
}

/** Вилки: с «Зарплатой от» — сколько вакансий ниже неё; без неё — просьба указать сумму (c10b). */
function salaryCard(salaryBelow: RejectionReviewChecks['salaryBelow']): CheckCard {
  const base = {
    key: 'salary',
    title: 'Сверить ожидания по деньгам с вилкой',
    icon: 'wallet',
  } as const;
  if (!salaryBelow) {
    return {
      ...base,
      why: 'Сколько хотите получать? Зарплата от — не указана.',
      action: 'Указать',
      to: conditionsPath(),
    };
  }
  return {
    ...base,
    why: `В ${salaryBelow.count} из ${salaryBelow.total} ${pluralRu(salaryBelow.total, ['вакансии', 'вакансий', 'вакансий'])} верх вилки ниже ваших ${money(salaryBelow.floor, salaryBelow.currency)}.`,
    action: 'Открыть вилки',
    to: buildNodePath('s07'),
  };
}

/** Три проверки, которым порог в 20 откликов не нужен (макет o07c). */
export function checkCards(checks: RejectionReviewChecks): readonly CheckCard[] {
  const { unfinished, salaryBelow, late } = checks;
  return [
    {
      key: 'unfinished',
      title: 'Обновить статусы откликов',
      why: `Незавершённых откликов — ${unfinished.count} из ${unfinished.total}.`,
      action: 'Обновить статусы',
      icon: 'refresh',
      to: buildNodePath('o01'),
    },
    salaryCard(salaryBelow),
    {
      key: 'late',
      title: 'Откликаться на свежие вакансии',
      why: `${late.count} из ${late.total} ${pluralRu(late.total, ['отклика', 'откликов', 'откликов'])} — позже 10 дней после публикации.`,
      action: 'Показать свежие',
      icon: 'clock',
      to: buildNodePath('s07'),
    },
  ];
}

/** Основание чисел: «Отклики со 2 октября. Порог — 20 откликов, как в сводке воронки.» */
export function checksBasis(checks: RejectionReviewChecks, threshold: number): string {
  const date = longDate(checks.since);
  const preposition = date?.startsWith('2 ') ? 'со' : 'с';
  const since = date ? `Отклики ${preposition} ${date}. ` : '';
  return `${since}Порог — ${threshold} ${pluralRu(threshold, ['отклик', 'отклика', 'откликов'])}, как в сводке воронки.`;
}
