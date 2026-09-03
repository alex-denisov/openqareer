import { describe, expect, it } from 'vitest';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import { mergeApplication, optimisticApplication } from './vacancyApplicationState';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/1',
  source: 'himalayas',
};

const NOW = '2026-09-04T10:00:00.000Z';

describe('vacancyApplicationState', () => {
  it('открытие не проставляет ни даты отклика, ни провенанса', () => {
    const application = optimisticApplication('c1', 'opened', vacancy, NOW);

    expect(application.openedAt).toBe(NOW);
    expect(application.appliedAt).toBeNull();
    expect(application.confirmedBy).toBeNull();
  });

  it('подтверждение называет кандидата источником подтверждения', () => {
    const application = optimisticApplication('c1', 'applied', vacancy, NOW);

    expect(application.appliedAt).toBe(NOW);
    expect(application.confirmedBy).toBe('candidate');
  });

  it('повторное открытие не откатывает отклик и не переписывает его дату', () => {
    const applied: VacancyApplication = optimisticApplication(
      'c1',
      'applied',
      vacancy,
      '2026-09-02T09:00:00.000Z',
    );

    const merged = mergeApplication(
      [applied],
      optimisticApplication('c1', 'opened', vacancy, NOW),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('applied');
    expect(merged[0].appliedAt).toBe('2026-09-02T09:00:00.000Z');
  });

  it('отклик по другой вакансии добавляется, а не заменяет прежний', () => {
    const first = optimisticApplication('c1', 'applied', vacancy, NOW);

    const merged = mergeApplication([first], optimisticApplication('c2', 'opened', vacancy, NOW));

    expect(merged.map((application) => application.clusterId)).toEqual(['c2', 'c1']);
  });
});
