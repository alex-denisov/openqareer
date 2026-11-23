import { describe, expect, it } from 'vitest';
import type { RejectionReviewChecks } from '../../../../../shared/rejectionReview';
import { checkCards, checksBasis, checksHeading } from './reviewChecks';

const CHECKS: RejectionReviewChecks = {
  since: '2026-10-02T10:00:00.000Z',
  unfinished: { count: 3, total: 6 },
  salaryBelow: { count: 2, total: 6, floor: 500_000, currency: 'RUB' },
  late: { count: 4, total: 6 },
};

describe('B645: три проверки «Мало данных»', () => {
  it('называет каждую проверку числами из откликов, как в макете o07c', () => {
    const cards = checkCards(CHECKS);
    expect(cards.map((card) => card.title)).toEqual([
      'Обновить статусы откликов',
      'Сверить ожидания по деньгам с вилкой',
      'Откликаться на свежие вакансии',
    ]);
    expect(cards.map((card) => card.why)).toEqual([
      'Незавершённых откликов — 3 из 6.',
      'В 2 из 6 вакансий верх вилки ниже ваших 500 000 ₽.',
      '4 из 6 откликов — позже 10 дней после публикации.',
    ]);
    expect(cards.map((card) => card.action)).toEqual([
      'Обновить статусы',
      'Открыть вилки',
      'Показать свежие',
    ]);
  });

  it('без ожиданий по деньгам проверки вилок нет', () => {
    expect(checkCards({ ...CHECKS, salaryBelow: null }).map((card) => card.action)).toEqual([
      'Обновить статусы',
      'Показать свежие',
    ]);
  });

  // B645-2: при двух карточках заголовок «Три проверки» врал.
  it('заголовок называет столько проверок, сколько карточек', () => {
    expect(checksHeading(checkCards(CHECKS).length)).toBe('Три проверки, которым данные не нужны');
    expect(checksHeading(checkCards({ ...CHECKS, salaryBelow: null }).length)).toBe(
      'Две проверки, которым данные не нужны',
    );
  });

  it('основание: с какого дня отклики и порог', () => {
    expect(checksBasis(CHECKS, 20)).toBe(
      'Отклики со 2 октября. Порог — 20 откликов, как в сводке воронки.',
    );
    expect(checksBasis({ ...CHECKS, since: null }, 20)).toBe(
      'Порог — 20 откликов, как в сводке воронки.',
    );
  });
});
