import type { RejectionReviewChecks } from '../../../../../shared/rejectionReview';
import type { IconName } from '../../kit';
import { longDate, pluralRu } from './responseRow';

/** Проверка экрана «Мало данных» (O7c): что сделать и почему. */
export interface CheckCard {
  readonly key: 'unfinished' | 'salary' | 'late';
  readonly title: string;
  readonly why: string;
  readonly action: string;
  readonly icon: IconName;
  readonly node: 's07' | 'o01';
}

const CURRENCY_SIGNS: Readonly<Record<string, string>> = { RUB: '₽', USD: '$', EUR: '€' };

function money(amount: number, currency: string): string {
  return `${amount.toLocaleString('ru-RU').replace(/\s/gu, ' ')} ${CURRENCY_SIGNS[currency] ?? currency}`;
}

/** Три проверки, которым порог в 20 откликов не нужен; вилок нет без ожиданий по деньгам. */
export function checkCards(checks: RejectionReviewChecks): readonly CheckCard[] {
  const { unfinished, salaryBelow, late } = checks;
  const cards: CheckCard[] = [
    {
      key: 'unfinished',
      title: 'Обновить статусы откликов',
      why: `Незавершённых откликов — ${unfinished.count} из ${unfinished.total}.`,
      action: 'Обновить статусы',
      icon: 'refresh',
      node: 'o01',
    },
  ];
  if (salaryBelow) {
    cards.push({
      key: 'salary',
      title: 'Сверить ожидания по деньгам с вилкой',
      why: `В ${salaryBelow.count} из ${salaryBelow.total} ${pluralRu(salaryBelow.total, ['вакансии', 'вакансий', 'вакансий'])} верх вилки ниже ваших ${money(salaryBelow.floor, salaryBelow.currency)}.`,
      action: 'Открыть вилки',
      icon: 'wallet',
      node: 's07',
    });
  }
  cards.push({
    key: 'late',
    title: 'Откликаться на свежие вакансии',
    why: `${late.count} из ${late.total} ${pluralRu(late.total, ['отклика', 'откликов', 'откликов'])} — позже 10 дней после публикации.`,
    action: 'Показать свежие',
    icon: 'clock',
    node: 's07',
  });
  return cards;
}

const COUNT_WORDS: Readonly<Record<number, string>> = {
  1: 'Одна проверка',
  2: 'Две проверки',
  3: 'Три проверки',
};

/** Заголовок блока: «Три проверки…», а без проверки вилок — «Две проверки…». */
export function checksHeading(count: number): string {
  const which = count === 1 ? 'которой' : 'которым';
  return `${COUNT_WORDS[count] ?? `${count} проверки`}, ${which} данные не нужны`;
}

/** Основание чисел: «Отклики со 2 октября. Порог — 20 откликов, как в сводке воронки.» */
export function checksBasis(checks: RejectionReviewChecks, threshold: number): string {
  const date = longDate(checks.since);
  const preposition = date?.startsWith('2 ') ? 'со' : 'с';
  const since = date ? `Отклики ${preposition} ${date}. ` : '';
  return `${since}Порог — ${threshold} ${pluralRu(threshold, ['отклик', 'отклика', 'откликов'])}, как в сводке воронки.`;
}
