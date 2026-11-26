import { describe, expect, it } from 'vitest';
import type { RejectionReviewChecks } from '../../../../../shared/rejectionReview';
import { checkCards, checksBasis } from './reviewChecks';

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

  // Оркестратор 23.11: третья карточка остаётся и без ожиданий — просит указать «Зарплату от».
  it('без ожиданий по деньгам карточка вилок просит указать сумму в условиях поиска', () => {
    const salary = checkCards({ ...CHECKS, salaryBelow: null })[1];
    expect(salary).toMatchObject({
      key: 'salary',
      title: 'Сверить ожидания по деньгам с вилкой',
      why: 'Сколько хотите получать? Зарплата от — не указана.',
      action: 'Указать',
      to: '/app/career?view=conditions',
    });
    expect(checkCards(CHECKS)[1]?.to).toBe('/app/vacancies');
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
